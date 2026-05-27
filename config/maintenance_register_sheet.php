<?php

return [

    /*
    |--------------------------------------------------------------------------
    | FR-MTN-05 — ทะเบียนรับงานซ่อมบำรุง (Google Sheets)
    |--------------------------------------------------------------------------
    |
    | ใช้ Google Service Account — แชร์สเปรดชีตกับ client_email ใน JSON
    |
    */

    'enabled' => (bool) env('MAINTENANCE_REGISTER_SHEET_ENABLED', false),

    'spreadsheet_id' => env('GOOGLE_MAINTENANCE_REGISTER_SPREADSHEET_ID', ''),

    /** ชื่อแท็บ (tab) ตาม Sheet */
    'sheet_title' => trim((string) env(
        'GOOGLE_MAINTENANCE_REGISTER_SHEET_TITLE',
        'FR-MTN-05 ทะเบียนรับงานซ่อมบำรุง'
    ), " \t\n\r\0\x0B\""),

    /** path ไฟล์ JSON credential ของ Service Account */
    'credentials_path' => (static function (): string {
        $raw = env(
            'GOOGLE_MAINTENANCE_REGISTER_CREDENTIALS',
            env('GOOGLE_APPLICATION_CREDENTIALS', '')
        );
        $path = trim((string) $raw, " \t\n\r\0\x0B\"");
        if ($path === '') {
            return storage_path('app/google-maintenance-register.json');
        }
        if (! preg_match('#^[a-zA-Z]:[/\\\\]#', $path) && ! str_starts_with($path, '/')) {
            return base_path($path);
        }

        return $path;
    })(),

    'lock_seconds' => (int) env('MAINTENANCE_REGISTER_SHEET_LOCK_SECONDS', 25),

    /**
     * SSL verify สำหรับ Guzzle → Google API (Plesk บางเครื่องไม่มี CA bundle)
     * true | false | path เช่น /etc/ssl/certs/ca-certificates.crt
     */
    'http_verify' => env('GOOGLE_MAINTENANCE_HTTP_VERIFY', 'auto'),

];
