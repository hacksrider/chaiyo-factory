<?php

namespace App\Console\Commands;

use App\Services\MaintenanceRegisterSheetService;
use Illuminate\Console\Command;

class MaintenanceRegisterSheetDiagnose extends Command
{
    protected $signature = 'maintenance:sheet-diagnose';

    protected $description = 'ทดสอบการเชื่อมต่อ Google Sheets สำหรับทะเบียนใบแจ้งซ่อม (FR-MTN-05)';

    public function handle(MaintenanceRegisterSheetService $sheet): int
    {
        $summary = $sheet->healthSummary();
        $this->info('Maintenance register sheet');
        foreach ($summary as $k => $v) {
            $this->line("  {$k}: ".(is_bool($v) ? ($v ? 'yes' : 'no') : $v));
        }

        if (! $sheet->isEnabled()) {
            $this->warn('Sheet sync is disabled or misconfigured.');

            return self::FAILURE;
        }

        try {
            $alloc = $sheet->allocateNextIndices();
            $this->info('Google allocate OK (dry read): next '.$alloc['me_number'].' row '.$alloc['row']);
        } catch (\Throwable $e) {
            $this->error('Google allocate failed: '.$e->getMessage());

            return self::FAILURE;
        }

        $this->info('Done.');

        return self::SUCCESS;
    }
}
