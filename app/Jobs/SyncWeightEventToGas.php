<?php

namespace App\Jobs;

use App\Models\ProductionWeightEvent;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Dual-write a weight event to Google Apps Script (GAS) asynchronously.
 *
 * If GAS is unavailable the job will retry with exponential back-off up to
 * MAX_ATTEMPTS times, then mark the event as 'failed' so a repair script
 * can retry it later.
 */
class SyncWeightEventToGas implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries   = 5;
    public int $timeout = 30;

    public function __construct(
        private readonly int    $weightEventId,
        private readonly string $gasUrl,
    ) {}

    public function backoff(): array
    {
        return [10, 30, 60, 120, 300]; // seconds between attempts
    }

    public function handle(): void
    {
        $ev = ProductionWeightEvent::find($this->weightEventId);

        if (!$ev) {
            Log::warning("[SyncWeightEventToGas] event #{$this->weightEventId} not found — skipping");
            return;
        }

        if ($ev->gas_sync_status === 'synced') {
            return; // already synced (concurrent dispatch dedup)
        }

        $payload = [
            'action'     => 'logWeightEvent',
            'machineId'  => $ev->machine_id,
            'sheetName'  => $ev->sheet_name,
            'orderId'    => $ev->order_id,
            'type'       => $ev->type,
            'weight'     => $ev->weight,
            'seq'        => $ev->seq,
            'employeeId' => $ev->employee_id,
            'shift'      => $ev->shift,
            'pressedAt'  => $ev->pressed_at?->toISOString(),
        ];

        $ev->increment('gas_sync_attempts');

        try {
            $response = Http::timeout(25)
                ->retry(1, 5000)
                ->post($this->gasUrl, $payload);

            if ($response->successful()) {
                $ev->update([
                    'gas_sync_status' => 'synced',
                    'gas_synced_at'   => now(),
                ]);
                return;
            }

            $this->fail(new \RuntimeException(
                "GAS returned HTTP {$response->status()}: " . substr($response->body(), 0, 200)
            ));
        } catch (\Throwable $e) {
            Log::warning("[SyncWeightEventToGas] attempt {$ev->gas_sync_attempts}: " . $e->getMessage());

            if ($this->attempts() >= $this->tries) {
                $ev->update(['gas_sync_status' => 'failed']);
            }

            throw $e; // let Laravel re-queue with back-off
        }
    }
}
