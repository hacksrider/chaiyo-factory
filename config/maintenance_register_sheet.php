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
    'sheet_title' => env(
        'GOOGLE_MAINTENANCE_REGISTER_SHEET_TITLE',
        'FR-MTN-05 ทะเบียนรับงานซ่อมบำรุง'
    ),

    /** path ไฟล์ JSON credential ของ Service Account */
    'credentials_path' => env(
        'GOOGLE_MAINTENANCE_REGISTER_CREDENTIALS',
        env('GOOGLE_APPLICATION_CREDENTIALS', storage_path('app/google-maintenance-register.json'))
    ),

    'lock_seconds' => (int) env('MAINTENANCE_REGISTER_SHEET_LOCK_SECONDS', 25),

];
