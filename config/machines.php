<?php

/**
 * Production Monitor — รายชื่อเครื่องจักร (Hardcoded)
 *
 * แทนที่การดึงจาก Google Sheets (GAS_PRODUCTION_URL ?action=getSettings)
 * แก้ไขได้โดยตรงที่นี่ — ไม่ต้องพึ่ง Google Sheets
 *
 * ฟอร์แมต key ตรงกับที่ GAS เคยส่งมา (MachineID, SheetName, LED_IP, Zone, Status)
 * เพื่อให้ normaliseMachines() ใน frontend ทำงานได้เหมือนเดิมทุกประการ
 */

return [

    /*
    |--------------------------------------------------------------------------
    | Machine List
    |--------------------------------------------------------------------------
    | LED_IP รองรับหลาย IP (คั่นด้วย comma) สำหรับเครื่องที่มีป้ายไฟ 2 จุด
    | เช่น "192.168.3.101,192.168.103.101"
    */

    'machines' => [

        // ── สายไมโคร ────────────────────────────────────────────────────────
        ['MachineID' => 'EM 08',  'SheetName' => 'EM 08',  'LED_IP' => '192.168.3.101,192.168.103.101', 'Zone' => 'สายไมโคร',    'Status' => 'Active'],
        ['MachineID' => 'EM 9A',  'SheetName' => 'EM 9A',  'LED_IP' => '192.168.103.24', 'Zone' => 'สายไมโคร',    'Status' => 'Active'],
        ['MachineID' => 'EM 9B',  'SheetName' => 'EM 9B',  'LED_IP' => '192.168.3.103,192.168.103.103', 'Zone' => 'สายไมโคร',    'Status' => 'Active'],

        // ── เทปน้ำพุ่ง ──────────────────────────────────────────────────────
        ['MachineID' => 'EM 10',  'SheetName' => 'EM 10',  'LED_IP' => '192.168.3.104,192.168.103.104', 'Zone' => 'เทปน้ำพุ่ง',  'Status' => 'Active'],
        ['MachineID' => 'EM 16',  'SheetName' => 'EM 16',  'LED_IP' => '192.168.3.105,192.168.103.105', 'Zone' => 'เทปน้ำพุ่ง',  'Status' => 'Active'],
        ['MachineID' => 'EM 17',  'SheetName' => 'EM 17',  'LED_IP' => '192.168.3.106,192.168.103.106', 'Zone' => 'เทปน้ำพุ่ง',  'Status' => 'Active'],
        ['MachineID' => 'EM 18',  'SheetName' => 'EM 18',  'LED_IP' => '192.168.3.107,192.168.103.107', 'Zone' => 'เทปน้ำพุ่ง',  'Status' => 'Active'],

        // ── PE Zone 1 ────────────────────────────────────────────────────────
        ['MachineID' => 'EM 20',  'SheetName' => 'EM 20',  'LED_IP' => '192.168.3.108,192.168.103.108', 'Zone' => 'PE Zone 1',   'Status' => 'Active'],
        ['MachineID' => 'EM 21',  'SheetName' => 'EM 21',  'LED_IP' => '192.168.3.109,192.168.103.109', 'Zone' => 'PE Zone 1',   'Status' => 'Active'],
        ['MachineID' => 'EM 22',  'SheetName' => 'EM 22',  'LED_IP' => '192.168.103.18', 'Zone' => 'PE Zone 1',   'Status' => 'Active'],
        ['MachineID' => 'EM 23',  'SheetName' => 'EM 23',  'LED_IP' => '192.168.3.111,192.168.103.111', 'Zone' => 'PE Zone 1',   'Status' => 'Active'],

        // ── PE Zone 2 ────────────────────────────────────────────────────────
        ['MachineID' => 'EM 24',  'SheetName' => 'EM 24',  'LED_IP' => '192.168.3.112,192.168.103.112', 'Zone' => 'PE Zone 2',   'Status' => 'Active'],
        ['MachineID' => 'EM 25',  'SheetName' => 'EM 25',  'LED_IP' => '192.168.3.113,192.168.103.113', 'Zone' => 'PE Zone 2',   'Status' => 'Active'],
        ['MachineID' => 'EM 26',  'SheetName' => 'EM 26',  'LED_IP' => '192.168.3.114,192.168.103.114', 'Zone' => 'PE Zone 2',   'Status' => 'Active'],
        ['MachineID' => 'EM 27',  'SheetName' => 'EM 27',  'LED_IP' => '192.168.3.115,192.168.103.115', 'Zone' => 'PE Zone 2',   'Status' => 'Active'],

        // ── PE Zone 3 ────────────────────────────────────────────────────────
        ['MachineID' => 'EM 06',  'SheetName' => 'EM 06',  'LED_IP' => '192.168.3.116,192.168.103.116', 'Zone' => 'PE Zone 3',   'Status' => 'Active'],
        ['MachineID' => 'EM 12',  'SheetName' => 'EM 12',  'LED_IP' => '192.168.3.117,192.168.103.117', 'Zone' => 'PE Zone 3',   'Status' => 'Active'],
        ['MachineID' => 'EM 13',  'SheetName' => 'EM 13',  'LED_IP' => '192.168.3.118,192.168.103.118', 'Zone' => 'PE Zone 3',   'Status' => 'Active'],
        ['MachineID' => 'EM 15',  'SheetName' => 'EM 15',  'LED_IP' => '192.168.3.119,192.168.103.119', 'Zone' => 'PE Zone 3',   'Status' => 'Active'],

        // ── PE Zone 4 ────────────────────────────────────────────────────────
        ['MachineID' => 'EM 03',  'SheetName' => 'EM 03',  'LED_IP' => '192.168.3.120,192.168.103.120', 'Zone' => 'PE Zone 4',   'Status' => 'Active'],
        ['MachineID' => 'EM 04',  'SheetName' => 'EM 04',  'LED_IP' => '192.168.3.121,192.168.103.121', 'Zone' => 'PE Zone 4',   'Status' => 'Active'],
        ['MachineID' => 'EM 07',  'SheetName' => 'EM 07',  'LED_IP' => '192.168.3.122,192.168.103.122', 'Zone' => 'PE Zone 4',   'Status' => 'Active'],

    ],

];
