<?php

return [

    /*
    |--------------------------------------------------------------------------
    | แจ้งเตือนเมื่อมีใบแจ้งซ่อมใหม่
    |--------------------------------------------------------------------------
    |
    | 1) Google Apps Script Web App: POST JSON {"message":"..."} ไปที่ URL นี้
    |    (แอปสคริปต์ต้องมี doPost รับ e.postData.contents แล้วส่งต่อ LINE ฯลฯ)
    |
    | 2) LINE Messaging API โดยตรง: token + push_to_id (กลุ่ม C... / ผู้ใช้ U...)
    |
    */

    /** URL ของ GAS แบบ .../exec — ถ้าไม่ว่าง จะส่งข้อความเมื่อสร้างใบ */
    'gas_webhook_url' => env('MAINTENANCE_NOTIFY_GAS_WEBHOOK_URL', ''),

    'notify_on_create_enabled' => (bool) env('LINE_MAINTENANCE_NOTIFY_ON_CREATE', false),

    'channel_access_token' => env('LINE_MAINTENANCE_CHANNEL_ACCESS_TOKEN', ''),

    /** Group ID (C...) หรือ User ID (U...) */
    'push_to_id' => env('LINE_MAINTENANCE_PUSH_TO_ID', ''),

];
