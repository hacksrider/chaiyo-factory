<?php

namespace App\Console\Commands;

use App\Models\ProductionSession;
use App\Models\ProductionQueueItem;
use App\Models\ProductionWeightEvent;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Carbon\Carbon;

/**
 * production:housekeeping
 *
 * ควรรันทุก 5 นาที ผ่าน Plesk Scheduled Tasks:
 *   php /path/to/artisan production:housekeeping
 *
 * สิ่งที่ทำ:
 *  1. Auto-cancel session ที่ค้างใน awaiting_scale นานเกิน STUCK_MINUTES
 *  2. ลบ production_weight_events ที่เก่าเกิน RETAIN_DAYS วัน
 */
class ProductionHousekeeping extends Command
{
    protected $signature = 'production:housekeeping
                            {--dry-run : แสดงผลโดยไม่เปลี่ยนแปลงข้อมูล}
                            {--stuck-minutes=20 : นาทีที่ถือว่า awaiting_scale ค้าง}
                            {--retain-days=90 : เก็บ weight events ย้อนหลังกี่วัน}';

    protected $description = 'Auto-cancel stuck awaiting_scale sessions + cleanup old weight events';

    public function handle(): int
    {
        $dryRun       = $this->option('dry-run');
        $stuckMinutes = (int) $this->option('stuck-minutes');
        $retainDays   = (int) $this->option('retain-days');

        $this->cancelStuckSessions($stuckMinutes, $dryRun);
        $this->cleanupOldWeightEvents($retainDays, $dryRun);

        return Command::SUCCESS;
    }

    // ──────────────────────────────────────────────────────────────────────
    // 1. Auto-cancel awaiting_scale sessions ที่ค้างนาน
    // ──────────────────────────────────────────────────────────────────────

    private function cancelStuckSessions(int $stuckMinutes, bool $dryRun): void
    {
        $cutoff = Carbon::now()->subMinutes($stuckMinutes);

        $stuck = ProductionSession::where('status', 'awaiting_scale')
            ->where(function ($q) use ($cutoff) {
                // ค้างนานตั้งแต่เริ่มต้น หรือตั้งแต่ updated_at ล่าสุด
                $q->where('started_at', '<', $cutoff)
                  ->orWhere('updated_at', '<', $cutoff);
            })
            ->get();

        if ($stuck->isEmpty()) {
            $this->line('[housekeeping] No stuck sessions found.');
            return;
        }

        foreach ($stuck as $session) {
            $machineId   = $session->machine_id;
            $orderId     = (string) ($session->order_id ?? '');
            $runUlid     = (string) ($session->session_run_ulid ?? '');
            $stuckSince  = $session->started_at ?? $session->updated_at;

            $this->warn("[housekeeping] Stuck awaiting_scale: machine={$machineId} order={$orderId} since={$stuckSince}");

            if ($dryRun) {
                continue;
            }

            try {
                DB::transaction(function () use ($session, $machineId, $orderId, $runUlid) {
                    // คืน queue item เป็น 'queued' ให้ผู้ใช้เลือกเริ่มใหม่ได้
                    if ($orderId !== '') {
                        ProductionQueueItem::where('machine_id', $machineId)
                            ->where('order_id', $orderId)
                            ->where('status', 'started')
                            ->update(['status' => 'queued']);
                    }

                    // ลบ weight events ที่อาจมาก่อนยืนยันกะ (ผิดปกติ)
                    if ($runUlid !== '') {
                        ProductionWeightEvent::where('machine_id', $machineId)
                            ->where('session_run_ulid', $runUlid)
                            ->delete();
                    }

                    $session->update([
                        'status'      => 'cancelled',
                        'finished_at' => now(),
                        'ts'          => (int) (now()->timestamp * 1000),
                    ]);
                });

                // ล้าง cache ที่เกี่ยวข้อง
                Cache::forget("machine_session_{$machineId}");
                Cache::forget("session_confirm_{$machineId}");
                Cache::forget("scale_cmd_{$machineId}");
                Cache::forget("scale_live_{$machineId}");

                $this->info("[housekeeping] Cancelled stuck session for machine={$machineId}");
                Log::info("[housekeeping] Auto-cancelled stuck awaiting_scale session", [
                    'machine_id'  => $machineId,
                    'order_id'    => $orderId,
                    'run_ulid'    => $runUlid,
                    'stuck_since' => (string) $stuckSince,
                ]);
            } catch (\Throwable $e) {
                $this->error("[housekeeping] Failed to cancel {$machineId}: {$e->getMessage()}");
                Log::error("[housekeeping] Cancel stuck session failed", [
                    'machine_id' => $machineId,
                    'error'      => $e->getMessage(),
                ]);
            }
        }
    }

    // ──────────────────────────────────────────────────────────────────────
    // 2. ลบ production_weight_events เก่าเกิน retain_days
    // ──────────────────────────────────────────────────────────────────────

    private function cleanupOldWeightEvents(int $retainDays, bool $dryRun): void
    {
        $cutoff = Carbon::now()->subDays($retainDays);

        $count = ProductionWeightEvent::where('created_at', '<', $cutoff)->count();

        if ($count === 0) {
            $this->line("[housekeeping] No weight events older than {$retainDays} days.");
            return;
        }

        $this->line("[housekeeping] Found {$count} weight events older than {$retainDays} days.");

        if ($dryRun) {
            return;
        }

        // ลบทีละ 500 เพื่อไม่ล็อค table นาน
        $deleted = 0;
        do {
            $batch = ProductionWeightEvent::where('created_at', '<', $cutoff)
                ->limit(500)
                ->delete();
            $deleted += $batch;
        } while ($batch > 0);

        $this->info("[housekeeping] Deleted {$deleted} old weight events (>{$retainDays} days).");
        Log::info("[housekeeping] Cleaned up old weight events", [
            'deleted'     => $deleted,
            'retain_days' => $retainDays,
            'cutoff'      => $cutoff->toDateTimeString(),
        ]);
    }
}
