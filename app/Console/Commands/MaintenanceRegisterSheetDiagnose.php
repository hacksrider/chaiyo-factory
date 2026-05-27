<?php

namespace App\Console\Commands;

use App\Services\MaintenanceRegisterSheetService;
use Illuminate\Console\Command;

class MaintenanceRegisterSheetDiagnose extends Command
{
    protected $signature = 'maintenance:sheet-diagnose {--json : Print raw JSON report}';

    protected $description = 'ทดสอบ Google Sheets (FR-MTN-05) — ใช้บน Plesk หลังตั้ง .env';

    public function handle(MaintenanceRegisterSheetService $sheet): int
    {
        $report = $sheet->runDiagnostics();

        if ($this->option('json')) {
            $this->line(json_encode($report, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));

            return $this->exitCodeFromReport($report);
        }

        $this->info('=== Maintenance Google Sheet (Plesk / CLI) ===');
        $this->line('PHP '.($report['php']['version'] ?? '?').' ('.($report['php']['sapi'] ?? '?').')');
        $this->line('curl: '.($report['php']['curl'] ? 'yes' : 'NO'));
        $this->line('openssl: '.($report['php']['openssl'] ? 'yes' : 'NO'));
        $this->line('google/apiclient: '.($report['php']['google_client_class'] ? 'yes' : 'NO'));

        $this->newLine();
        $this->info('Config');
        foreach ($report['config'] ?? [] as $k => $v) {
            $this->line("  {$k}: {$v}");
        }

        $this->newLine();
        $this->info('Credentials');
        foreach ($report['credentials'] ?? [] as $k => $v) {
            if ($v === null) {
                continue;
            }
            $display = is_bool($v) ? ($v ? 'yes' : 'no') : $v;
            $this->line("  {$k}: {$display}");
        }

        $this->newLine();
        $this->info('Google API');
        foreach ($report['google'] ?? [] as $k => $v) {
            if (is_array($v)) {
                $this->line("  {$k}: ".implode(' | ', $v));

                continue;
            }
            $display = is_bool($v) ? ($v ? 'yes' : 'no') : (string) $v;
            $this->line("  {$k}: {$display}");
        }

        if (! empty($report['hints'])) {
            $this->newLine();
            $this->warn('แนวทางแก้:');
            foreach ($report['hints'] as $hint) {
                $this->line('  • '.$hint);
            }
        }

        return $this->exitCodeFromReport($report);
    }

    /**
     * @param  array<string, mixed>  $report
     */
    private function exitCodeFromReport(array $report): int
    {
        if (! ($report['config']['enabled'] ?? false)) {
            return self::FAILURE;
        }
        if (($report['google']['token'] ?? '') !== 'ok') {
            return self::FAILURE;
        }
        if (($report['google']['sheet_title_match'] ?? true) === false) {
            return self::FAILURE;
        }
        if (($report['google']['read_range'] ?? '') !== 'ok') {
            return self::FAILURE;
        }

        $this->newLine();
        $this->info('OK — เว็บควร sync Google Sheet ได้ (รัน config:clear หลังแก้ .env)');

        return self::SUCCESS;
    }
}
