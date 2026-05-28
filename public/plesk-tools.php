<?php

/**
 * เครื่องมือ Plesk (ไม่มี SSH) — ลบ config cache + ทดสอบ Google Sheet
 *
 * 1. ใน .env: MAINTENANCE_DIAGNOSE_KEY=รหัสลับยาวๆ
 * 2. ล้าง cache:  https://โดเมน/plesk-tools.php?key=รหัส&action=clear-cache
 * 3. ทด Google:  https://โดเมน/plesk-tools.php?key=รหัส&action=diagnose
 * 4. อุ่น GAS (ลด cold start): https://โดเมน/plesk-tools.php?key=รหัส&action=gas-warm
 * 5. Queue (ถ้าใช้ background job): ...&action=queue
 * 6. ลบไฟล์นี้หลังใช้เสร็จ
 */

declare(strict_types=1);

header('Content-Type: text/plain; charset=utf-8');

function plesk_read_env_value(string $key): string
{
    $envFile = dirname(__DIR__).'/.env';
    if (! is_readable($envFile)) {
        return '';
    }
    $prefix = $key.'=';
    foreach (file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        $line = trim($line);
        if ($line === '' || str_starts_with($line, '#')) {
            continue;
        }
        if (str_starts_with($line, $prefix)) {
            return trim(substr($line, strlen($prefix)), " \t\"'");
        }
    }

    return '';
}

function plesk_read_diagnose_key(): string
{
    return plesk_read_env_value('MAINTENANCE_DIAGNOSE_KEY');
}

function plesk_clear_laravel_cache(): array
{
    $base = dirname(__DIR__);
    $targets = [
        $base.'/bootstrap/cache/config.php',
        $base.'/bootstrap/cache/routes-v7.php',
        $base.'/bootstrap/cache/events.php',
        $base.'/bootstrap/cache/services.php',
        $base.'/bootstrap/cache/packages.php',
    ];
    $done = [];
    foreach ($targets as $path) {
        if (is_file($path) && @unlink($path)) {
            $done[] = basename($path);
        }
    }

    return $done;
}

$expectedKey = plesk_read_diagnose_key();
$provided = (string) ($_GET['key'] ?? '');
$action = (string) ($_GET['action'] ?? 'help');

if ($expectedKey === '' || $provided === '' || ! hash_equals($expectedKey, $provided)) {
    http_response_code(403);
    exit("Forbidden\n\nตั้ง MAINTENANCE_DIAGNOSE_KEY ใน .env ก่อน\n".
        "ตัวอย่าง: MAINTENANCE_DIAGNOSE_KEY=mySecretKey2026\n\n".
        "แล้วเปิด:\n  plesk-tools.php?key=mySecretKey2026&action=clear-cache\n".
        "  plesk-tools.php?key=mySecretKey2026&action=diagnose\n".
        "  plesk-tools.php?key=mySecretKey2026&action=gas-warm\n".
        "  plesk-tools.php?key=mySecretKey2026&action=queue\n");
}

if ($action === 'gas-warm') {
    $gasUrl = plesk_read_env_value('GAS_PRODUCTION_URL');
    if ($gasUrl === '') {
        http_response_code(500);
        exit("ไม่พบ GAS_PRODUCTION_URL ใน .env\n");
    }

    $pingUrl = $gasUrl.(str_contains($gasUrl, '?') ? '&' : '?').'action=getSettings';
    $start = microtime(true);
    $ctx = stream_context_create([
        'http' => [
            'timeout'       => 25,
            'ignore_errors' => true,
        ],
    ]);
    $body = @file_get_contents($pingUrl, false, $ctx);
    $ms = (int) round((microtime(true) - $start) * 1000);

    if ($body === false) {
        http_response_code(502);
        exit("GAS warm ล้มเหลว ({$ms} ms)\n");
    }

    echo "GAS warm OK ({$ms} ms)\n";
    echo 'เวลา: '.date('Y-m-d H:i:s')."\n";
    exit;
}

if ($action === 'queue') {
    $vendorAutoload = dirname(__DIR__).'/vendor/autoload.php';
    if (! is_file($vendorAutoload)) {
        http_response_code(500);
        exit("ไม่พบ vendor/autoload.php — รัน composer install บน server ก่อน\n");
    }

    require $vendorAutoload;
    $app = require dirname(__DIR__).'/bootstrap/app.php';
    $kernel = $app->make(Illuminate\Contracts\Console\Kernel::class);
    $kernel->bootstrap();

    $exitCode = $kernel->call('queue:work', [
        '--stop-when-empty' => true,
        '--max-time'        => 50,
        '--queue'           => 'gas-sync,default',
    ]);

    echo "queue:work เสร็จแล้ว (exit {$exitCode})\n";
    echo "เวลา: ".date('Y-m-d H:i:s')."\n";
    exit;
}

if ($action === 'clear-cache') {
    $removed = plesk_clear_laravel_cache();
    echo "ล้าง cache แล้ว (เทียบเท่า php artisan config:clear)\n\n";
    if ($removed === []) {
        echo "ไม่พบไฟล์ cache — อาจล้างไปแล้ว หรือยังไม่เคย config:cache\n";
    } else {
        echo "ลบแล้ว:\n";
        foreach ($removed as $f) {
            echo "  - bootstrap/cache/{$f}\n";
        }
    }
    echo "\nรีเฟรชเว็บหลักได้เลย\n";
    exit;
}

if ($action === 'diagnose') {
    $vendorAutoload = dirname(__DIR__).'/vendor/autoload.php';
    $googleClientFile = dirname(__DIR__).'/vendor/google/apiclient/src/Client.php';
    if (! is_file($vendorAutoload)) {
        http_response_code(500);
        exit("ไม่พบ vendor/autoload.php\n\n".
            "สาเหตุ: ยังไม่ได้รัน composer install บน server\n".
            "บน Plesk (ไม่มี SSH): ใช้เมนู PHP Composer → Install หรืออัปโหลดโฟลเดอร์ vendor จากเครื่อง dev\n");
    }
    if (! is_file($googleClientFile)) {
        http_response_code(500);
        exit("ไม่พบ google/apiclient ใน vendor/\n\n".
            "แพ็กเกจ google/apiclient ยังไม่ถูกติดตั้งบน server\n".
            "แก้: Plesk → PHP Composer → composer install --no-dev\n".
            "หรือบนเครื่อง dev รัน composer install --no-dev แล้ว zip โฟลเดอร์ vendor อัปโหลดทับ httpdocs/vendor\n");
    }

    require $vendorAutoload;
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
            'hints' => [
                'แก้ .env แล้วเรียก ?action=clear-cache ก่อน',
                'ตรวจ vendor/ ว่ามีจาก composer install',
            ],
        ], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
    }
    exit;
}

echo "Plesk tools — ไม่ต้องใช้ SSH\n\n";
echo "action=clear-cache  ล้าง config cache หลังแก้ .env\n";
echo "action=diagnose     ทดสอบ Google Sheets (JSON)\n";
echo "action=gas-warm     ปิง GAS ให้อุ่น (ลดความช้าตอนกดเสร็จสิ้น — ตั้ง Cron ทุก 10 นาที)\n";
echo "action=queue        ประมวลผล Laravel queue (ถ้าใช้ background job)\n\n";
echo "URL ตัวอย่าง:\n";
echo "  ".(isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off' ? 'https' : 'http')
    .'://'.($_SERVER['HTTP_HOST'] ?? 'your-domain')
    .'/plesk-tools.php?key=***&action=clear-cache'."\n";
