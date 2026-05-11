<?php

use Illuminate\Support\Facades\Route;
use App\Http\Controllers\Api\ProductionMonitorController;
use App\Http\Controllers\Api\MachineLogController;

/*
|--------------------------------------------------------------------------
| API Routes
|--------------------------------------------------------------------------
|
| These routes are loaded by bootstrap/app.php under the "api" middleware
| group, which automatically prefixes every URI with /api and applies rate
| limiting via the "throttle:api" middleware.
|
*/

// Machine Log — บันทึกสถานะเครื่องจักรลง Google Sheets
Route::prefix('machine-log')->group(function () {
    Route::post('/append', [MachineLogController::class, 'append']);
    Route::get('/reporters', [MachineLogController::class, 'reportersIndex']);
    Route::post('/reporters', [MachineLogController::class, 'reportersStore']);
    Route::delete('/reporters/{id}', [MachineLogController::class, 'reportersDestroy'])
        ->whereNumber('id');
});

// Production Monitor — Laravel proxy to Google Apps Script (bypasses browser CORS)
Route::prefix('production-monitor')->group(function () {

    // GET  /api/production-monitor/get-settings
    Route::get('/get-settings', [ProductionMonitorController::class, 'getSettings']);

    // GET  /api/production-monitor/debug  ← open in browser to inspect raw GAS response
    Route::get('/debug', [ProductionMonitorController::class, 'debug']);

            // GET  /api/production-monitor/history?sheetName=Machine_01
            Route::get('/history', [ProductionMonitorController::class, 'getHistory']);

    // GET  /api/production-monitor/order-detail?sheetName=Machine_01&orderId=123
    Route::get('/order-detail', [ProductionMonitorController::class, 'getOrderDetail']);

            // POST /api/production-monitor/create-order
            Route::post('/create-order', [ProductionMonitorController::class, 'createOrder']);

    // POST /api/production-monitor/update-weight
    Route::post('/update-weight', [ProductionMonitorController::class, 'updateWeight']);

    // POST /api/production-monitor/close-order
    Route::post('/close-order', [ProductionMonitorController::class, 'closeOrder']);

    // POST /api/production-monitor/log-weight-event  ← Web บันทึกน้ำหนักแต่ละครั้งลง GAS (fire-and-forget)
    Route::post('/log-weight-event', [ProductionMonitorController::class, 'logWeightEvent']);

    // GET  /api/production-monitor/plan?machine=EM+08&status=Inprocess
    Route::get('/plan', [ProductionMonitorController::class, 'getProductionPlan']);

    // GET  /api/production-monitor/monthly-plan?machine=EM+08
    Route::get('/monthly-plan', [ProductionMonitorController::class, 'getMonthlyPlan']);

    // GET  /api/production-monitor/daily-plan?machine=EM+08&jobNo=6901001
    Route::get('/daily-plan', [ProductionMonitorController::class, 'getDailyPlan']);

    // POST /api/production-monitor/update-daily-produced ← Finished Order → อัปเดตช่องกะใน Daily sheet
    Route::post('/update-daily-produced', [ProductionMonitorController::class, 'updateDailyProduced']);

    // POST /api/production-monitor/update-plan-produced ← Finished Order → บวกสะสมใน แผนการผลิต sheet
    Route::post('/update-plan-produced', [ProductionMonitorController::class, 'updatePlanProduced']);

    // GET  /api/production-monitor/product-lookup
    Route::get('/product-lookup',  [ProductionMonitorController::class, 'getProductLookup']);
    // GET  /api/production-monitor/product-details (รายละเอียดครบทุก field)
    Route::get('/product-details', [ProductionMonitorController::class, 'getProductDetails']);

    // POST /api/production-monitor/led  (direct push — ใช้เมื่ออยู่ network เดียวกัน)
    Route::post('/led', [ProductionMonitorController::class, 'sendLedCommand']);

    // GET  /api/production-monitor/led-ping?ledIp=192.168.1.108
    Route::get('/led-ping', [ProductionMonitorController::class, 'pingLed']);

    // POST /api/production-monitor/led-command/{machineId}  ← Web UI เก็บคำสั่งลง Cache
    // GET  /api/production-monitor/led-command/{machineId}  ← ESP32 ดึงคำสั่ง (polling)
    Route::post('/led-command/{machineId}', [ProductionMonitorController::class, 'storeLedCommand']);
    Route::get('/led-command/{machineId}',  [ProductionMonitorController::class, 'fetchLedCommand']);

    // GET  /api/production-monitor/led-status/{machineId}   ← UI ดึงสถานะล่าสุดเพื่อแสดงใน Modal
    Route::get('/led-status/{machineId}',   [ProductionMonitorController::class, 'getLedStatus']);

    // GET  /api/production-monitor/led-heartbeat/{machineId} ← UI เช็คว่าป้ายไฟออนไลน์ (จาก polling timestamp)
    Route::get('/led-heartbeat/{machineId}', [ProductionMonitorController::class, 'getLedHeartbeat']);

    // Scale command queue — Web → Scale ESP32
    // POST /api/production-monitor/scale-command/{machineId}  ← Web ส่งงาน
    // GET  /api/production-monitor/scale-command/{machineId}  ← Scale ESP32 poll
    Route::post('/scale-command/{machineId}', [ProductionMonitorController::class, 'storeScaleCommand']);
    Route::get('/scale-command/{machineId}',  [ProductionMonitorController::class, 'fetchScaleCommand']);

    // Scale confirmation — Scale ESP32 → Web
    // POST /api/production-monitor/scale-confirm/{machineId}  ← Scale ESP32 ยืนยัน (กะ+รหัสพนักงาน)
    // GET  /api/production-monitor/scale-confirm/{machineId}  ← Web poll รอการยืนยัน
    Route::post('/scale-confirm/{machineId}', [ProductionMonitorController::class, 'storeScaleConfirm']);
    Route::get('/scale-confirm/{machineId}',  [ProductionMonitorController::class, 'fetchScaleConfirm']);

    // Scale session live flag — Web → Laravel Cache ; Scale ESP32 GET เพื่อเทียบว่ายังผลิตอยู่ไหม (หลังเปิดไฟใหม่)
    Route::post('/scale-live/{machineId}', [ProductionMonitorController::class, 'storeScaleLive']);
    Route::get('/scale-live/{machineId}',  [ProductionMonitorController::class, 'fetchScaleLive']);

    // Scale weight events — Scale ESP32 → Web
    // POST /api/production-monitor/scale-weight/{machineId}   ← Scale ESP32 ส่งน้ำหนัก
    // GET  /api/production-monitor/scale-weight/{machineId}   ← Web poll รับ events
    Route::post('/scale-weight/{machineId}',  [ProductionMonitorController::class, 'storeScaleWeight']);
    Route::get('/scale-weight/{machineId}',   [ProductionMonitorController::class, 'fetchScaleWeights']);

    // POST /api/production-monitor/machine-session/{machineId}  ← Web browser sync state → Cache
    // GET  /api/production-monitor/machine-sessions             ← ทุก browser poll รับ shared state (fallback)
    Route::post('/machine-session/{machineId}', [ProductionMonitorController::class, 'storeMachineSession']);
    Route::get('/machine-sessions',             [ProductionMonitorController::class, 'fetchAllMachineSessions']);

    // GET  /api/production-monitor/stream  ← SSE real-time push (แทน polling)
    // Client ส่ง ?lastId=N และ ?since=<epoch_ms> เพื่อรับ events ที่พลาดหลัง reconnect
    // Server ส่ง ": heartbeat" comment ทุก 15 วินาที เพื่อป้องกัน proxy ตัดการเชื่อมต่อ
    Route::get('/stream', [ProductionMonitorController::class, 'stream'])
        ->withoutMiddleware(['throttle:api']); // SSE ต้องการ connection ยาว — ไม่จำกัดด้วย rate limit

    // ─── New routes (Bug Fix P1–P5) ──────────────────────────────────────────

    /**
     * GET /api/production-monitor/state-snapshot
     *
     * Full machine state snapshot for delta-sync on SSE reconnect.
     * Called by useRealtimeSync.onReconnect to fill the gap during disconnection.
     * Response: { sessions: { [machineId]: state }, serverTime: <epoch_ms> }
     */
    Route::get('/state-snapshot', [ProductionMonitorController::class, 'stateSnapshot']);

    /**
     * POST /api/production-monitor/push-to-scale/{machineId}
     *
     * StartNow: push complete job payload to the ESP32 scale immediately.
     * The scale firmware overwrites NVS with this payload (no merge).
     * If the scale is offline, this queues the push and retries every 10s.
     *
     * Request:  { order_id, product_name, target_weight, qty_target,
     *              qty_good, qty_remaining, shift, employee_id }
     * Response: { success: bool, queued: bool }
     */
    Route::post('/push-to-scale/{machineId}', [ProductionMonitorController::class, 'pushToScale']);

    /**
     * POST /api/production-monitor/session-confirm/{machineId}
     *
     * Called by ESP32 scale when operator presses D (confirm shift + employee ID).
     * Stores confirmation in cache and broadcasts SSE `session_confirmed` to ALL
     * connected browsers so they can mark the machine as "Live Monitoring Active".
     *
     * Request:  { shift: string, employee_id: string, confirmed_at: <epoch_ms> }
     * Response: { success: bool }
     *
     * Laravel controller stub:
     *   public function sessionConfirm(Request $request, string $machineId): JsonResponse
     *   {
     *       $data = $request->only(['shift', 'employee_id', 'confirmed_at']);
     *       $data['machineId'] = $machineId;
     *       Cache::put("session_confirm_{$machineId}", $data, now()->addHours(12));
     *
     *       // Broadcast SSE to all connected clients
     *       SseChannel::broadcast('session_confirmed', $data);  // implement per your SSE driver
     *
     *       return response()->json(['success' => true]);
     *   }
     */
    Route::post('/session-confirm/{machineId}', [ProductionMonitorController::class, 'sessionConfirm']);

    // ── DB-first endpoints (Phase 1) ─────────────────────────────────────────

    // Queue
    Route::post('/queue/{machineId}',                [ProductionMonitorController::class, 'enqueueItem']);
    Route::get('/queue/{machineId}',                 [ProductionMonitorController::class, 'getQueue']);
    Route::delete('/queue/{machineId}/{itemId}',     [ProductionMonitorController::class, 'deleteQueueItem'])
        ->whereNumber('itemId');

    // Session / Live
    Route::get('/session/{machineId}',               [ProductionMonitorController::class, 'getSession']);
    Route::post('/start/{machineId}',                [ProductionMonitorController::class, 'startSession']);
    Route::post('/pause/{machineId}',                [ProductionMonitorController::class, 'pauseSession']);
    Route::post('/finish/{machineId}',               [ProductionMonitorController::class, 'finishSession']);
    Route::post('/cancel/{machineId}',               [ProductionMonitorController::class, 'cancelSession']);

    // History from DB
    Route::get('/history-db',                        [ProductionMonitorController::class, 'getHistoryDb']);
    Route::get('/order-detail-db',                   [ProductionMonitorController::class, 'orderDetailDb']);
});
