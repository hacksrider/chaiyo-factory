<?php

namespace App\Services;

use App\Models\MaintenanceRequest;
use Carbon\Carbon;
use Google\Client as GoogleClient;
use Google\Service\Sheets;
use Google\Service\Sheets\ValueRange;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use RuntimeException;
use Throwable;

class MaintenanceRegisterSheetService
{
    public function isEnabled(): bool
    {
        if (! config('maintenance_register_sheet.enabled')) {
            return false;
        }
        $id = (string) config('maintenance_register_sheet.spreadsheet_id');

        return $id !== '' && $this->credentialsPath() !== '' && is_readable($this->credentialsPath());
    }

    public function credentialsPath(): string
    {
        return (string) config('maintenance_register_sheet.credentials_path');
    }

    /** ข้อความสั้นๆ สำหรับ log / API (ไม่เปิดเผย path เต็มใน production) */
    public function healthSummary(): array
    {
        $path = $this->credentialsPath();

        return [
            'enabled' => config('maintenance_register_sheet.enabled'),
            'spreadsheet_configured' => (string) config('maintenance_register_sheet.spreadsheet_id') !== '',
            'credentials_readable' => $path !== '' && is_readable($path),
            'sheet_title' => (string) config('maintenance_register_sheet.sheet_title'),
        ];
    }

    /**
     * วินิจฉัยทีละขั้น — รันบน Plesk: php artisan maintenance:sheet-diagnose
     *
     * @return array<string, mixed>
     */
    public function runDiagnostics(): array
    {
        $path = $this->credentialsPath();
        $report = [
            'php' => [
                'version' => PHP_VERSION,
                'sapi' => PHP_SAPI,
                'curl' => extension_loaded('curl'),
                'openssl' => extension_loaded('openssl'),
                'json' => extension_loaded('json'),
                'google_client_class' => class_exists(GoogleClient::class),
            ],
            'config' => [
                'enabled' => (bool) config('maintenance_register_sheet.enabled'),
                'spreadsheet_id' => (string) config('maintenance_register_sheet.spreadsheet_id'),
                'sheet_title' => (string) config('maintenance_register_sheet.sheet_title'),
                'credentials_path' => $path,
                'http_verify' => config('maintenance_register_sheet.http_verify'),
            ],
            'credentials' => [
                'file_exists' => $path !== '' && is_file($path),
                'readable' => $path !== '' && is_readable($path),
                'client_email' => null,
                'json_valid' => false,
            ],
            'google' => [],
            'hints' => [],
        ];

        if ($report['credentials']['readable']) {
            $raw = @file_get_contents($path);
            $json = is_string($raw) ? json_decode($raw, true) : null;
            $report['credentials']['json_valid'] = is_array($json)
                && ! empty($json['client_email'])
                && ! empty($json['private_key']);
            $report['credentials']['client_email'] = is_array($json) ? ($json['client_email'] ?? null) : null;
            if ($report['credentials']['json_valid']) {
                $report['hints'][] = 'แชร์สเปรดชีตให้ '.$report['credentials']['client_email'].' (สิทธิ์ Editor)';
            } else {
                $report['hints'][] = 'ไฟล์ JSON ไม่ครบ client_email / private_key';
            }
        } else {
            $report['hints'][] = 'อัปโหลด google-maintenance-register.json ไปที่ storage/app/ และ chmod 640 ให้ user ของ PHP-FPM อ่านได้';
        }

        if (! $this->isEnabled()) {
            $report['google']['status'] = 'disabled_or_misconfigured';

            return $report;
        }

        try {
            $client = $this->makeGoogleClient();
            $token = $client->fetchAccessTokenWithAssertion();
            if (isset($token['error'])) {
                $report['google']['token'] = 'error';
                $report['google']['token_error'] = (string) ($token['error_description'] ?? $token['error']);
                $report['hints'][] = 'ได้ token ไม่สำเร็จ — ตรวจ private_key ใน JSON และเวลาเซิร์ฟเวอร์ (NTP)';
            } else {
                $report['google']['token'] = 'ok';
            }
        } catch (Throwable $e) {
            $report['google']['token'] = 'exception';
            $report['google']['token_message'] = $e->getMessage();
            if (str_contains($e->getMessage(), 'SSL') || str_contains($e->getMessage(), 'certificate')) {
                $report['hints'][] = 'ปัญหา SSL — ใน .env ลอง GOOGLE_MAINTENANCE_HTTP_VERIFY=/etc/ssl/certs/ca-certificates.crt';
            }
            if (str_contains($e->getMessage(), 'Connection refused') || str_contains($e->getMessage(), 'Could not resolve')) {
                $report['hints'][] = 'เซิร์ฟเวอร์ออกเน็ตไป Google ไม่ได้ — ตรวจ firewall Plesk / ModSecurity';
            }
        }

        try {
            $sheets = new Sheets($this->makeGoogleClient());
            $spreadsheetId = (string) config('maintenance_register_sheet.spreadsheet_id');
            $meta = $sheets->spreadsheets->get($spreadsheetId, ['fields' => 'properties.title,sheets.properties.title']);
            $report['google']['spreadsheet_title'] = $meta->getProperties()->getTitle();
            $tabTitles = [];
            foreach ($meta->getSheets() as $sheet) {
                $tabTitles[] = $sheet->getProperties()->getTitle();
            }
            $report['google']['tab_titles'] = $tabTitles;
            $wanted = (string) config('maintenance_register_sheet.sheet_title');
            $report['google']['sheet_title_match'] = in_array($wanted, $tabTitles, true);
            if (! $report['google']['sheet_title_match']) {
                $report['hints'][] = 'ชื่อแท็บใน .env ไม่ตรงกับในไฟล์ — ตั้ง GOOGLE_MAINTENANCE_REGISTER_SHEET_TITLE ให้ตรงกับหนึ่งใน tab_titles (ไม่ใส่เครื่องหมายคำพูด)';
            }
        } catch (Throwable $e) {
            $report['google']['spreadsheet'] = 'error';
            $report['google']['spreadsheet_message'] = $e->getMessage();
            if (str_contains($e->getMessage(), '403') || str_contains($e->getMessage(), 'permission')) {
                $report['hints'][] = '403 — แชร์สเปรดชีตกับ service account (Editor) และเปิด Google Sheets API ใน Google Cloud';
            }
        }

        try {
            $alloc = $this->allocateNextIndices();
            $report['google']['read_range'] = 'ok';
            $report['google']['sample_next_me'] = $alloc['me_number'];
        } catch (Throwable $e) {
            $report['google']['read_range'] = 'error';
            $report['google']['read_range_message'] = $e->getMessage();
        }

        return $report;
    }

    /**
     * อ่าน max จากคอลัมน์ A/C แล้วจองลำดับถัดไป (ยังไม่เขียน Sheet)
     *
     * @return array{row: int, seq_a: int, me_number: string}
     */
    public function allocateNextIndices(): array
    {
        $sheet = $this->sheets();
        $spreadsheetId = (string) config('maintenance_register_sheet.spreadsheet_id');
        [$lastRow, $maxA, $maxMe] = $this->readColumnStats($sheet, $spreadsheetId);

        $nextRow = max(2, $lastRow + 1);
        $seqA = $maxA + 1;
        $meNumber = 'ME'.($maxMe + 1);

        return ['row' => $nextRow, 'seq_a' => $seqA, 'me_number' => $meNumber];
    }

    /**
     * สำรองเมื่อ Google Sheets API ล้ม — อ่านเลข ME ล่าสุดจากฐานข้อมูล
     *
     * @return array{row: int, seq_a: int, me_number: string}
     */
    public function allocateNextIndicesFromDatabase(): array
    {
        $maxMe = 0;
        MaintenanceRequest::query()
            ->where('notification_number', 'like', 'ME%')
            ->select('notification_number')
            ->orderByDesc('id')
            ->limit(500)
            ->pluck('notification_number')
            ->each(function (string $num) use (&$maxMe) {
                if (preg_match('/^ME(\d+)$/i', trim($num), $m)) {
                    $maxMe = max($maxMe, (int) $m[1]);
                }
            });

        $maxRow = (int) (MaintenanceRequest::query()
            ->whereNotNull('register_sheet_row')
            ->max('register_sheet_row') ?? 1);

        $nextMe = $maxMe + 1;
        $nextRow = max(2, $maxRow + 1);

        return [
            'row' => $nextRow,
            'seq_a' => $nextMe,
            'me_number' => 'ME'.$nextMe,
        ];
    }

    /** เขียนแถวเต็มหลังมี model ในฐานข้อมูลแล้ว */
    public function writeRowFromRecord(MaintenanceRequest $record, int $seqA, ?string $meOverride = null): void
    {
        $me = $meOverride ?? $record->notification_number;
        $values = $this->buildRowValues($record, $seqA, $me);
        $sheet = $this->sheets();
        $spreadsheetId = (string) config('maintenance_register_sheet.spreadsheet_id');
        $row = $record->register_sheet_row ?? 0;
        if ($row < 2) {
            throw new RuntimeException('register_sheet_row ไม่ถูกต้อง');
        }
        $this->updateRowRange($sheet, $spreadsheetId, $row, $values);
    }

    /** อัปเดตแถวเดิมตามสถานะและ payload ปัจจุบัน */
    public function updateRow(MaintenanceRequest $record): void
    {
        if (! $this->isEnabled()) {
            return;
        }
        if (! $this->shouldSyncNumber($record->notification_number)) {
            return;
        }

        $rowIndex = $record->register_sheet_row;
        if ($rowIndex === null || $rowIndex < 2) {
            $rowIndex = $this->findRowByMeColumn($record->notification_number);
        }
        if ($rowIndex === null) {
            Log::warning('Maintenance register sheet: ไม่พบแถวสำหรับ ME', [
                'maintenance_request_id' => $record->id,
                'notification_number' => $record->notification_number,
            ]);

            return;
        }

        $sheet = $this->sheets();
        $spreadsheetId = (string) config('maintenance_register_sheet.spreadsheet_id');
        $seqA = $this->readCellInt($sheet, $spreadsheetId, $rowIndex, 1) ?? $rowIndex - 1;
        $values = $this->buildRowValues($record, $seqA, $record->notification_number);
        $this->updateRowRange($sheet, $spreadsheetId, $rowIndex, $values);
    }

    public function withAllocateLock(callable $callback): mixed
    {
        if (! $this->isEnabled()) {
            return $callback();
        }
        $seconds = (int) config('maintenance_register_sheet.lock_seconds', 25);
        $lock = Cache::lock('maintenance_register_sheet_allocate', $seconds);

        return $lock->block($seconds, $callback);
    }

    /**
     * @return array{0: int, 1: int, 2: int} lastRow, maxA, maxMeSuffix
     */
    private function readColumnStats(Sheets $sheet, string $spreadsheetId): array
    {
        $q = $this->quotedTab();
        $opt = ['majorDimension' => 'ROWS', 'valueRenderOption' => 'UNFORMATTED_VALUE'];
        $colA = $sheet->spreadsheets_values->get($spreadsheetId, $q.'!A2:A', $opt)->getValues() ?? [];
        $colC = $sheet->spreadsheets_values->get($spreadsheetId, $q.'!C2:C', $opt)->getValues() ?? [];

        $lastRow = 1;
        $maxA = 0;
        foreach ($colA as $i => $row) {
            $val = $row[0] ?? null;
            if ($val === null || $val === '') {
                continue;
            }
            $lastRow = max($lastRow, $i + 2);
            if (is_numeric($val)) {
                $maxA = max($maxA, (int) $val);
            }
        }
        $maxMe = $this->maxMeNumericSuffix($colC);
        foreach ($colC as $i => $row) {
            $val = $row[0] ?? null;
            if ($val !== null && $val !== '') {
                $lastRow = max($lastRow, $i + 2);
            }
        }

        return [$lastRow, $maxA, $maxMe];
    }

    private function findRowByMeColumn(string $meNumber): ?int
    {
        try {
            $sheet = $this->sheets();
            $spreadsheetId = (string) config('maintenance_register_sheet.spreadsheet_id');
            $range = $this->quotedTab().'!C2:C';
            $resp = $sheet->spreadsheets_values->get($spreadsheetId, $range, ['majorDimension' => 'ROWS']);
            $rows = $resp->getValues() ?? [];
            $needle = strtoupper(trim($meNumber));
            foreach ($rows as $i => $row) {
                $val = strtoupper(trim((string) ($row[0] ?? '')));
                if ($val === $needle) {
                    return $i + 2;
                }
            }
        } catch (Throwable $e) {
            report($e);
        }

        return null;
    }

    private function readCellInt(Sheets $sheet, string $spreadsheetId, int $row, int $colA1): ?int
    {
        try {
            $colLetter = $this->columnLetter($colA1);
            $range = $this->quotedTab().'!'.$colLetter.$row;
            $resp = $sheet->spreadsheets_values->get($spreadsheetId, $range, ['valueRenderOption' => 'UNFORMATTED_VALUE']);
            $v = $resp->getValues()[0][0] ?? null;

            return is_numeric($v) ? (int) $v : null;
        } catch (Throwable) {
            return null;
        }
    }

    private function columnLetter(int $col): string
    {
        $s = '';
        while ($col > 0) {
            $m = ($col - 1) % 26;
            $s = chr(65 + $m).$s;
            $col = intdiv($col - 1, 26);
        }

        return $s;
    }

    /**
     * @param  list<list<mixed>>  $colC
     */
    private function maxMeNumericSuffix(array $colC): int
    {
        $max = 0;
        foreach ($colC as $row) {
            $raw = $row[0] ?? '';
            if ($raw === null || $raw === '') {
                continue;
            }
            $s = strtoupper(trim((string) $raw));
            if (preg_match('/^ME(\d+)$/', $s, $m)) {
                $max = max($max, (int) $m[1]);
            }
        }

        return $max;
    }

    /**
     * @return list<mixed>
     */
    private function buildRowValues(MaintenanceRequest $record, int $seqA, string $meNumber): array
    {
        $payload = $record->payload ?? [];
        $notify = $this->parseDateTime($payload['notifiedAt'] ?? null);
        $expected = $this->parseDate($payload['maintenance']['expectedCompletion'] ?? null);
        $completion = $this->parseDate($payload['timeline']['completionDate'] ?? null);

        $statusLabel = $this->statusLabel($record->status);
        $dept = $this->departmentEnglishPrefix((string) ($payload['department'] ?? ''));
        $mainType = $this->mainTypeLabel($payload);
        $registerType = trim((string) ($payload['registerWorkCategory'] ?? ''));

        $minutes = $this->resolveMinutes($payload, $notify, $completion);
        [$planLabel, $withinMonth] = $this->planAndWithinMonth(
            $record->status,
            $expected,
            $completion,
            $notify
        );

        $costRaw = $payload['timeline']['costBaht'] ?? '';
        $costCell = '';
        if ($costRaw !== '' && $costRaw !== null) {
            if (is_numeric($costRaw)) {
                $costCell = (float) $costRaw;
            } elseif (preg_match('/[\d.]+/', (string) $costRaw, $m)) {
                $costCell = (float) $m[0];
            }
        }

        $month = $notify ? $notify->month : '';
        $year = $notify ? $notify->year : '';

        return [
            $seqA,
            $notify ? $notify->format('Y-m-d') : '',
            $meNumber,
            $dept,
            $mainType,
            $registerType,
            (string) ($payload['machineEquipment'] ?? ''),
            (string) ($payload['symptoms'] ?? ''),
            (string) ($payload['maintenance']['receiver'] ?? ''),
            $statusLabel,
            $expected ? $expected->format('Y-m-d') : '',
            (string) ($payload['analysis']['cause'] ?? ''),
            (string) ($payload['maintenance']['actionTaken'] ?? ''),
            $completion ? $completion->format('Y-m-d') : '',
            $minutes,
            $planLabel,
            $costCell,
            $withinMonth,
            $month,
            $year,
        ];
    }

    private function statusLabel(string $status): string
    {
        return match ($status) {
            MaintenanceRequest::STATUS_PENDING_REVIEW, 'pending' => 'รอดำเนินการ',
            MaintenanceRequest::STATUS_APPROVED => 'อยู่ระหว่างดำเนินการ',
            MaintenanceRequest::STATUS_REJECTED => 'ยกเลิก',
            MaintenanceRequest::STATUS_AWAITING_ACCEPTANCE => 'ช่างเสร็จ — รอตรวจรับ',
            MaintenanceRequest::STATUS_AWAITING_ADMIN_CLOSURE => 'รอลงนามฝ่ายแผนการผลิต',
            MaintenanceRequest::STATUS_COMPLETED => 'แล้วเสร็จ',
            default => $status,
        };
    }

    private function departmentEnglishPrefix(string $dept): string
    {
        $dept = trim($dept);
        if ($dept === '') {
            return '';
        }
        if (preg_match('/^([^(]+)\(/u', $dept, $m)) {
            return trim($m[1]);
        }

        return $dept;
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    private function mainTypeLabel(array $payload): string
    {
        $wt = $payload['workType'] ?? [];
        $parts = [];
        if (! empty($wt['bm'])) {
            $parts[] = 'BM';
        }
        if (! empty($wt['cm'])) {
            $parts[] = 'CM';
        }
        if (! empty($wt['pm'])) {
            $parts[] = 'PM';
        }
        if (! empty($wt['other'])) {
            $detail = trim((string) ($wt['otherDetail'] ?? ''));
            $parts[] = $detail !== '' ? $detail : 'อื่นๆ';
        }

        return implode(', ', $parts);
    }

    private function resolveMinutes(array $payload, ?Carbon $notify, ?Carbon $completion): string|int|float
    {
        $total = $payload['timeline']['totalMinutes'] ?? '';
        if ($total !== '' && $total !== null && is_numeric($total)) {
            return (int) $total;
        }
        $actual = $payload['timeline']['actualRepairMinutes'] ?? '';
        if ($actual !== '' && $actual !== null && is_numeric($actual)) {
            return (int) $actual;
        }
        if ($notify && $completion) {
            return max(0, $notify->diffInMinutes($completion));
        }

        return '';
    }

    private function planAndWithinMonth(
        string $status,
        ?Carbon $expected,
        ?Carbon $completion,
        ?Carbon $notify
    ): array {
        $planLabel = '';
        if ($completion && $expected) {
            $planLabel = $completion->lessThanOrEqualTo($expected) ? 'ตามแผน' : 'ไม่ตามแผน';
        }

        $withinMonthCell = '';
        $techDoneOrLater = in_array($status, [
            MaintenanceRequest::STATUS_AWAITING_ACCEPTANCE,
            MaintenanceRequest::STATUS_AWAITING_ADMIN_CLOSURE,
            MaintenanceRequest::STATUS_COMPLETED,
        ], true);

        if ($techDoneOrLater && $notify && $completion) {
            $withinMonthCell = $notify->month === $completion->month && $notify->year === $completion->year;
        }

        return [$planLabel, $withinMonthCell];
    }

    private function parseDateTime(?string $raw): ?Carbon
    {
        if ($raw === null || trim($raw) === '') {
            return null;
        }
        try {
            return Carbon::parse($raw);
        } catch (Throwable) {
            return null;
        }
    }

    private function parseDate(?string $raw): ?Carbon
    {
        if ($raw === null || trim($raw) === '') {
            return null;
        }
        try {
            return Carbon::parse($raw)->startOfDay();
        } catch (Throwable) {
            return null;
        }
    }

    private function shouldSyncNumber(string $notificationNumber): bool
    {
        return str_starts_with(strtoupper(trim($notificationNumber)), 'ME');
    }

    /**
     * @param  list<mixed>  $values
     */
    private function updateRowRange(Sheets $sheet, string $spreadsheetId, int $row, array $values): void
    {
        $range = $this->quotedTab().'!A'.$row.':T'.$row;
        $body = new ValueRange(['range' => $range, 'values' => [$values]]);
        $sheet->spreadsheets_values->update(
            $spreadsheetId,
            $range,
            $body,
            ['valueInputOption' => 'USER_ENTERED']
        );
    }

    private function quotedTab(): string
    {
        $title = (string) config('maintenance_register_sheet.sheet_title');

        return "'".str_replace("'", "''", $title)."'";
    }

    private function sheets(): Sheets
    {
        $path = $this->credentialsPath();
        if ($path === '' || ! is_readable($path)) {
            throw new RuntimeException(
                'อ่านไฟล์ credential Google ไม่ได้ — ตรวจ GOOGLE_MAINTENANCE_REGISTER_CREDENTIALS และแชร์สเปรดชีตกับ service account'
            );
        }

        return new Sheets($this->makeGoogleClient());
    }

    private function makeGoogleClient(): GoogleClient
    {
        $path = $this->credentialsPath();
        $client = new GoogleClient;
        $client->setApplicationName(config('app.name').' Maintenance Register');
        $client->setScopes([Sheets::SPREADSHEETS]);
        $client->setAuthConfig($path);
        $client->setAccessType('offline');
        $this->configureHttpClient($client);

        return $client;
    }

    /** Plesk/shared hosting: บางเครื่องไม่มี CA bundle ทำให้ SSL ล้ม */
    private function configureHttpClient(GoogleClient $client): void
    {
        if (! class_exists(\GuzzleHttp\Client::class)) {
            return;
        }

        $verify = config('maintenance_register_sheet.http_verify');
        if ($verify === false || $verify === 'false' || $verify === '0') {
            $client->setHttpClient(new \GuzzleHttp\Client(['verify' => false, 'timeout' => 30]));

            return;
        }
        if (is_string($verify) && $verify !== '' && $verify !== 'auto' && $verify !== 'true') {
            $client->setHttpClient(new \GuzzleHttp\Client(['verify' => $verify, 'timeout' => 30]));

            return;
        }

        foreach ([
            '/etc/ssl/certs/ca-certificates.crt',
            '/etc/pki/tls/certs/ca-bundle.crt',
            '/etc/ssl/ca-bundle.pem',
            '/usr/local/share/certs/ca-root-nss.crt',
        ] as $bundle) {
            if (is_readable($bundle)) {
                $client->setHttpClient(new \GuzzleHttp\Client(['verify' => $bundle, 'timeout' => 30]));

                return;
            }
        }

        $client->setHttpClient(new \GuzzleHttp\Client(['timeout' => 30]));
    }
}
