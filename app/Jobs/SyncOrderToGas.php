<?php

namespace App\Jobs;

use App\Models\ProductionOrder;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Dual-write a finished production order summary to GAS (create-order / close-order).
 */
class SyncOrderToGas implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries   = 5;
    public int $timeout = 30;

    public function __construct(
        private readonly int    $orderId,
        private readonly string $action,   // 'createOrder' | 'closeOrder'
        private readonly string $gasUrl,
    ) {}

    public function backoff(): array
    {
        return [10, 30, 60, 120, 300];
    }

    public function handle(): void
    {
        $order = ProductionOrder::find($this->orderId);

        if (!$order) {
            Log::warning("[SyncOrderToGas] order #{$this->orderId} not found — skipping");
            return;
        }

        if ($order->gas_sync_status === 'synced') {
            return;
        }

        $payload = [
            'action'      => $this->action,
            'machineId'   => $order->machine_id,
            'sheetName'   => $order->sheet_name,
            'orderId'     => $order->order_id,
            'productCode' => $order->product_code,
            'productName' => $order->product_name,
            'targetQty'   => $order->target_qty,
            'shift'       => $order->shift,
            'employeeId'  => $order->employee_id,
            'goodCount'   => $order->good_count,
            'ngCount'     => $order->ng_count,
            'totalGoodWeight' => $order->total_good_weight,
            'totalNgWeight'   => $order->total_ng_weight,
            'startedAt'   => $order->started_at?->toISOString(),
            'finishedAt'  => $order->finished_at?->toISOString(),
        ];

        $order->increment('gas_sync_attempts');

        try {
            $response = Http::timeout(25)
                ->retry(1, 5000)
                ->post($this->gasUrl, $payload);

            if ($response->successful()) {
                $order->update([
                    'gas_sync_status' => 'synced',
                    'gas_synced_at'   => now(),
                ]);
                return;
            }

            $this->fail(new \RuntimeException(
                "GAS returned HTTP {$response->status()}: " . substr($response->body(), 0, 200)
            ));
        } catch (\Throwable $e) {
            Log::warning("[SyncOrderToGas] attempt {$order->gas_sync_attempts}: " . $e->getMessage());

            if ($this->attempts() >= $this->tries) {
                $order->update(['gas_sync_status' => 'failed']);
            }

            throw $e;
        }
    }
}
