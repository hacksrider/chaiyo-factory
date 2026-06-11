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

/**
 * ล้าง cache ทุกอย่าง: bootstrap/cache + storage/framework/views + storage/framework/cache
 * ใช้เมื่อ SSE 401 หรือเปลี่ยน middleware/config แล้ว reload ไม่ขึ้น
 */
function plesk_clear_all_cache(): array
{
    $base = dirname(__DIR__);
    $removed = [];

    // 1) Bootstrap cache files (config, routes, events, services, packages)
    foreach ([
        'config.php', 'routes-v7.php', 'events.php', 'services.php', 'packages.php',
    ] as $f) {
        $p = $base.'/bootstrap/cache/'.$f;
        if (is_file($p) && @unlink($p)) {
            $removed[] = 'bootstrap/cache/'.$f;
        }
    }

    // 2) Compiled Blade views
    $viewsDir = $base.'/storage/framework/views';
    if (is_dir($viewsDir)) {
        foreach (glob($viewsDir.'/*.php') ?: [] as $f) {
            if (@unlink($f)) {
                $removed[] = 'views/'.basename($f);
            }
        }
    }

    // 3) Storage/framework/cache/data (application cache)
    $cacheData = $base.'/storage/framework/cache/data';
    if (is_dir($cacheData)) {
        $iter = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($cacheData, FilesystemIterator::SKIP_DOTS),
            RecursiveIteratorIterator::CHILD_FIRST
        );
        $count = 0;
        foreach ($iter as $node) {
            if ($node->isFile() && @unlink($node->getPathname())) {
                $count++;
            }
        }
        if ($count > 0) {
            $removed[] = "cache/data ({$count} files)";
        }
    }

    return $removed;
}

$expectedKey = plesk_read_diagnose_key();
$provided    = (string) ($_GET['key'] ?? '');
$action      = (string) ($_GET['action'] ?? 'help');

if ($expectedKey === '' || $provided === '' || ! hash_equals($expectedKey, $provided)) {
    http_response_code(403);
    exit("Forbidden\n\nตั้ง MAINTENANCE_DIAGNOSE_KEY ใน .env ก่อน\n");
}

// Actions ที่เป็น write/destructive ต้องใส่ ?confirm=yes กันกด Error
$writeActions = ['clear-cache', 'clear-all-cache', 'sse-reset', 'daily-test', 'queue', 'housekeeping-run'];
if (in_array($action, $writeActions, true) && ($_GET['confirm'] ?? '') !== 'yes') {
    http_response_code(400);
    header('Content-Type: application/json; charset=utf-8');
    exit(json_encode([
        'error'   => "action '{$action}' เป็น write/destructive — ต้องใส่ &confirm=yes ด้วย",
        'example' => "?key=...&action={$action}&confirm=yes",
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
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
    echo "ล้าง bootstrap cache แล้ว (เทียบเท่า php artisan config:clear + route:clear)\n\n";
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

if ($action === 'clear-all-cache') {
    $removed = plesk_clear_all_cache();
    echo "ล้าง cache ทั้งหมดแล้ว\n";
    echo "(bootstrap/cache + Blade views + storage cache)\n\n";
    if ($removed === []) {
        echo "ไม่พบไฟล์ cache — สะอาดอยู่แล้ว\n";
    } else {
        echo "ลบแล้ว (" . count($removed) . " รายการ):\n";
        foreach ($removed as $f) {
            echo "  - {$f}\n";
        }
    }

    // ล้าง PHP OPcache ด้วย (ถ้าเปิดใช้) — สำคัญเมื่อ middleware เปลี่ยนแต่ PHP ยังโหลด code เก่า
    if (function_exists('opcache_reset')) {
        $ok = opcache_reset();
        echo "\nOPcache reset: ".($ok ? 'สำเร็จ ✓' : 'ล้มเหลว (อาจต้อง restart PHP-FPM)')."\n";
    } else {
        echo "\nOPcache: ไม่ได้เปิดใช้ หรือไม่ได้ทำงานจาก web\n";
    }

    echo "\nถ้า SSE ยัง 401 อยู่ ให้ logout แล้ว login ใหม่ หรือ restart PHP-FPM\n";
    exit;
}

// ─── sse-test: ทดสอบ auth + session state ─────────────────────────────────
if ($action === 'sse-test') {
    $vendorAutoload = dirname(__DIR__).'/vendor/autoload.php';
    if (! is_file($vendorAutoload)) {
        http_response_code(500);
        exit("ไม่พบ vendor/autoload.php\n");
    }
    require $vendorAutoload;
    $app = require dirname(__DIR__).'/bootstrap/app.php';
    $app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

    header('Content-Type: application/json; charset=utf-8');

    $report = [];

    // 1) Check SSE queue
    try {
        $counter = Illuminate\Support\Facades\Cache::get('sse_counter', 0);
        $queue   = Illuminate\Support\Facades\Cache::get('sse_queue', []);
        $report['sse_counter'] = $counter;
        $report['sse_queue_size'] = count($queue);
        $report['sse_queue_latest_5'] = array_slice($queue, -5);

        $allIdsZero = count($queue) > 0 && array_reduce($queue, fn ($ok, $ev) => $ok && ((int) ($ev['id'] ?? 0)) === 0, true);
        $report['health'] = [
            'counter_ok'   => (int) $counter > 0,
            'all_ids_zero' => $allIdsZero,
            'broken'       => $allIdsZero || ((int) $counter <= 0 && count($queue) > 0),
            'hint'         => $allIdsZero
                ? 'SSE queue มี event แต่ id=0 ทั้งหมด — browser รับไม่ได้ เรียก ?action=sse-reset แล้ว deploy fix ล่าสุด'
                : null,
        ];
    } catch (\Throwable $e) {
        $report['sse_queue_error'] = $e->getMessage();
    }

    // 2) Check all production sessions
    try {
        $sessions = \App\Models\ProductionSession::whereNotIn('status', ['finished', 'cancelled'])
            ->get(['machine_id', 'status', 'order_id', 'shift', 'employee_id', 'ts'])
            ->toArray();
        $report['active_sessions'] = $sessions;
    } catch (\Throwable $e) {
        $report['active_sessions_error'] = $e->getMessage();
    }

    // 3) Test token auth (if ?token= provided)
    $testToken = $_GET['token'] ?? '';
    if ($testToken !== '') {
        try {
            $tokenModel = \Laravel\Sanctum\PersonalAccessToken::findToken($testToken);
            $report['token_valid'] = $tokenModel !== null;
            if ($tokenModel) {
                $report['token_user_id'] = $tokenModel->tokenable_id;
                $report['token_name']    = $tokenModel->name;
            }
        } catch (\Throwable $e) {
            $report['token_error'] = $e->getMessage();
        }
    }

    echo json_encode($report, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
    exit;
}

// ─── sse-reset: ล้าง queue ที่ id=0 เสีย ───────────────────────────────────
if ($action === 'sse-reset') {
    $vendorAutoload = dirname(__DIR__).'/vendor/autoload.php';
    if (! is_file($vendorAutoload)) {
        http_response_code(500);
        exit("ไม่พบ vendor/autoload.php\n");
    }
    require $vendorAutoload;
    $app = require dirname(__DIR__).'/bootstrap/app.php';
    $app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

    Illuminate\Support\Facades\Cache::forget('sse_queue');
    Illuminate\Support\Facades\Cache::forget('sse_counter');
    Illuminate\Support\Facades\Cache::forget('sse_counter_lock');

    header('Content-Type: application/json; charset=utf-8');
    echo json_encode([
        'ok'      => true,
        'message' => 'SSE queue + counter reset แล้ว — event ใหม่จะได้ id ถูกต้องหลัง deploy fix',
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
    exit;
}

// ─── daily-test: ส่ง updateDailyProduced ไป GAS แล้วดู raw response ──────────
if ($action === 'daily-test') {
    $vendorAutoload = dirname(__DIR__).'/vendor/autoload.php';
    if (! is_file($vendorAutoload)) {
        http_response_code(500);
        exit("ไม่พบ vendor/autoload.php\n");
    }
    require $vendorAutoload;
    $app = require dirname(__DIR__).'/bootstrap/app.php';
    $app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

    $gasUrl  = env('GAS_PLAN_URL', '');
    $machineId = $_GET['machine']  ?? 'EM 08';
    $jobNo     = $_GET['jobNo']    ?? '6905185';
    $date      = $_GET['date']     ?? date('Y-m-d');
    $shift     = $_GET['shift']    ?? 'A';
    $produced  = (int) ($_GET['produced'] ?? 1);

    header('Content-Type: application/json; charset=utf-8');

    if (empty($gasUrl)) {
        echo json_encode(['error' => 'GAS_PLAN_URL is not set in .env'], JSON_PRETTY_PRINT);
        exit;
    }

    $payload = [
        'action'    => 'updateDailyProduced',
        'machineId' => $machineId,
        'jobNo'     => $jobNo,
        'date'      => $date,
        'shift'     => $shift,
        'produced'  => $produced,
        'machine'   => $machineId,
        'orderId'   => $jobNo,
        'planDate'  => $date,
        'qty'       => $produced,
        'goodCount' => $produced,
    ];

    try {
        $response = Illuminate\Support\Facades\Http::withoutVerifying()
            ->withOptions(['allow_redirects' => ['max' => 10, 'strict' => false, 'protocols' => ['https', 'http']]])
            ->timeout(120)
            ->asJson()
            ->post($gasUrl, $payload);

        echo json_encode([
            'sent'         => $payload,
            'http_status'  => $response->status(),
            'raw_body'     => substr($response->body(), 0, 2000),
            'parsed'       => $response->json(),
        ], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
    } catch (\Throwable $e) {
        echo json_encode(['error' => $e->getMessage()], JSON_PRETTY_PRINT);
    }
    exit;
}

// ─── daily-sample: เรียก getDailySample จาก GAS ดูค่า raw ใน Daily sheet ───
if ($action === 'daily-sample') {
    $vendorAutoload = dirname(__DIR__).'/vendor/autoload.php';
    if (! is_file($vendorAutoload)) {
        http_response_code(500);
        exit("ไม่พบ vendor/autoload.php\n");
    }
    require $vendorAutoload;
    $app = require dirname(__DIR__).'/bootstrap/app.php';
    $app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

    $gasUrl = env('GAS_PLAN_URL', '');
    header('Content-Type: application/json; charset=utf-8');

    if (empty($gasUrl)) {
        echo json_encode(['error' => 'GAS_PLAN_URL is not set in .env'], JSON_PRETTY_PRINT);
        exit;
    }

    // ดึง raw sample จาก Daily sheet (15 แถวแรก) — ใช้ debug ดู format วันที่
    $url = $gasUrl . '?action=getDailySample';
    try {
        $response = Illuminate\Support\Facades\Http::withoutVerifying()
            ->withOptions(['allow_redirects' => ['max' => 10, 'strict' => false, 'protocols' => ['https', 'http']]])
            ->timeout(120)
            ->get($url);

        echo json_encode([
            'note'        => 'แถวที่ 1-15 ของ Daily sheet — ดู col0 (A=วันที่) ว่าเป็น DATE: หรือ string',
            'http_status' => $response->status(),
            'data'        => $response->json(),
        ], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
    } catch (\Throwable $e) {
        echo json_encode(['error' => $e->getMessage()], JSON_PRETTY_PRINT);
    }
    exit;
}

// ─── housekeeping-test: รัน production:housekeeping ผ่าน Laravel (debug cron error) ─
if ($action === 'housekeeping-test') {
    $vendorAutoload = dirname(__DIR__).'/vendor/autoload.php';
    if (! is_file($vendorAutoload)) {
        http_response_code(500);
        exit("ไม่พบ vendor/autoload.php\n");
    }
    require $vendorAutoload;
    $app = require dirname(__DIR__).'/bootstrap/app.php';
    $kernel = $app->make(Illuminate\Contracts\Console\Kernel::class);
    $kernel->bootstrap();

    header('Content-Type: application/json; charset=utf-8');

    $cmdFile = dirname(__DIR__).'/app/Console/Commands/ProductionHousekeeping.php';
    $dryRun  = ($_GET['dry'] ?? 'yes') !== 'no';

    try {
        $exitCode = Illuminate\Support\Facades\Artisan::call('production:housekeeping', array_filter([
            '--dry-run'       => $dryRun,
            '--stuck-minutes' => $_GET['stuck-minutes'] ?? null,
            '--retain-days'   => $_GET['retain-days'] ?? null,
        ]));

        echo json_encode([
            'ok'                  => $exitCode === 0,
            'exit_code'           => $exitCode,
            'dry_run'             => $dryRun,
            'command_file_exists' => is_file($cmdFile),
            'command_file'        => $cmdFile,
            'php_binary'          => PHP_BINARY,
            'base_path'           => base_path(),
            'output'              => Illuminate\Support\Facades\Artisan::output(),
        ], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
    } catch (\Throwable $e) {
        http_response_code(500);
        echo json_encode([
            'ok'                  => false,
            'command_file_exists' => is_file($cmdFile),
            'error'               => $e->getMessage(),
            'trace'               => $e->getTraceAsString(),
        ], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
    }
    exit;
}

// ─── housekeeping-run: รัน production:housekeeping จริง (สำหรับ Plesk cron ผ่าน curl) ─
if ($action === 'housekeeping-run') {
    $vendorAutoload = dirname(__DIR__).'/vendor/autoload.php';
    if (! is_file($vendorAutoload)) {
        http_response_code(500);
        exit("ไม่พบ vendor/autoload.php\n");
    }
    require $vendorAutoload;
    $app = require dirname(__DIR__).'/bootstrap/app.php';
    $kernel = $app->make(Illuminate\Contracts\Console\Kernel::class);
    $kernel->bootstrap();

    header('Content-Type: application/json; charset=utf-8');

    try {
        $exitCode = Illuminate\Support\Facades\Artisan::call('production:housekeeping', array_filter([
            '--stuck-minutes' => $_GET['stuck-minutes'] ?? null,
            '--retain-days'   => $_GET['retain-days'] ?? null,
        ]));

        echo json_encode([
            'ok'        => $exitCode === 0,
            'exit_code' => $exitCode,
            'output'    => Illuminate\Support\Facades\Artisan::output(),
            'ran_at'    => date('c'),
        ], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
    } catch (\Throwable $e) {
        http_response_code(500);
        echo json_encode(['ok' => false, 'error' => $e->getMessage()], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
    }
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
echo "action=clear-cache      ล้าง bootstrap/cache (config, routes)\n";
echo "action=clear-all-cache  ล้างทุกอย่าง: cache + views + storage  ← ใช้เมื่อ SSE 401\n";
echo "action=sse-test         ตรวจ SSE queue + sessions ทั้งหมด (JSON)\n";
echo "action=sse-reset        ล้าง SSE queue/counter ที่ id=0 เสีย\n";
echo "action=daily-test       ทดสอบ updateDailyProduced → GAS (JSON)\n";
echo "action=daily-sample     ดู raw 15 แถวแรกของ Daily sheet (debug format วันที่)\n";
echo "action=housekeeping-test ทดสอบ production:housekeeping (debug cron error)\n";
echo "action=housekeeping-run  รัน production:housekeeping จริง (cron ผ่าน curl + confirm=yes)\n";
echo "action=diagnose         ทดสอบ Google Sheets (JSON)\n";
echo "action=gas-warm         ปิง GAS ให้อุ่น (ลดความช้าตอนกดเสร็จสิ้น — ตั้ง Cron ทุก 10 นาที)\n";
echo "action=queue            ประมวลผล Laravel queue (ถ้าใช้ background job)\n\n";
echo "URL ตัวอย่าง:\n";
$proto = (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
$host  = $_SERVER['HTTP_HOST'] ?? 'your-domain';
echo "  {$proto}://{$host}/plesk-tools.php?key=***&action=clear-cache\n";
echo "  {$proto}://{$host}/plesk-tools.php?key=***&action=clear-all-cache\n";
