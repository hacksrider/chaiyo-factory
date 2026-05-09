<?php

/**
 * รัน migrate ครั้งเดียวบน shared hosting ที่ Cron แบบ "Run a command" หา binary php ไม่เจอ
 *
 * วิธีใช้ (Plesk):
 * 1. Deploy ไฟล์นี้ไว้ข้าง artisan (รากโปรเจกต์ = httpdocs)
 * 2. Scheduled Tasks → Run a PHP script
 * 3. Path: /var/www/vhosts/chaiyo-factory.com/httpdocs/plesk-migrate-once.php
 * 4. Run Now → ตรวจเว็บ → ลบไฟล์นี้ออกจากเซิร์ฟเวอร์ทันที
 *
 * สำรอง: เปิดในเบราว์เซอร์ครั้งเดียว (เสี่ยงกว่า) ตั้ง $browserSecret แล้วเรียก
 *   https://โดเมน/plesk-migrate-once.php?key=SECRET
 *   (ถ้าโฟลเดอร์ public เป็น document root ต้องย้ายไฟล์ไป public หรือใช้แค่ Cron แทน)
 */

declare(strict_types=1);

$browserSecret = ''; // ตัวอย่าง: 'paste-long-random-string' — ถ้าว่าง = ปิดการรันผ่านเบราว์เซอร์

$isCli = \php_sapi_name() === 'cli' || \php_sapi_name() === 'phpdbg';
$browserOk = $browserSecret !== ''
    && isset($_GET['key'])
    && hash_equals($browserSecret, (string) $_GET['key']);

if (! $isCli && ! $browserOk) {
    http_response_code(403);
    exit('Forbidden');
}

require __DIR__.'/vendor/autoload.php';

$app = require __DIR__.'/bootstrap/app.php';

/** @var \Illuminate\Contracts\Console\Kernel $kernel */
$kernel = $app->make(\Illuminate\Contracts\Console\Kernel::class);
$kernel->bootstrap();

$code = $kernel->call('migrate', ['--force' => true]);

echo $kernel->output();

exit($code);
