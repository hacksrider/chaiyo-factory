<?php

/**
 * วินิจฉัย Google Sheet บน Plesk (ผ่าน PHP-FPM เหมือนเว็บจริง)
 *
 * 1. ใน .env ตั้ง: MAINTENANCE_DIAGNOSE_KEY=รหัสลับยาวๆ
 * 2. เปิด: https://your-domain/maintenance-sheet-diagnose.php?key=รหัสลับยาวๆ
 * 3. ลบไฟล์นี้ออกหลังแก้เสร็จ
 */

declare(strict_types=1);

$expectedKey = '';

$envFile = dirname(__DIR__).'/.env';
if (is_readable($envFile)) {
    foreach (file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        $line = trim($line);
        if ($line === '' || str_starts_with($line, '#')) {
            continue;
        }
        if (str_starts_with($line, 'MAINTENANCE_DIAGNOSE_KEY=')) {
            $expectedKey = trim(substr($line, strlen('MAINTENANCE_DIAGNOSE_KEY=')), " \t\"'");
            break;
        }
    }
}

$provided = (string) ($_GET['key'] ?? '');
if ($expectedKey === '' || $provided === '' || ! hash_equals($expectedKey, $provided)) {
    http_response_code(403);
    header('Content-Type: text/plain; charset=utf-8');
    exit("Forbidden\nตั้ง MAINTENANCE_DIAGNOSE_KEY ใน .env แล้วเรียก ?key=...\n");
}

require dirname(__DIR__).'/vendor/autoload.php';

$app = require dirname(__DIR__).'/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

header('Content-Type: application/json; charset=utf-8');

try {
    $report = $app->make(App\Services\MaintenanceRegisterSheetService::class)->runDiagnostics();
    echo json_encode($report, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode([
        'fatal' => $e->getMessage(),
        'hints' => ['รัน composer install บน server', 'php artisan config:clear'],
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
}
