<?php

use Illuminate\Support\Facades\Route;
use App\Http\Controllers\Api\ProductionMonitorController;
use App\Http\Controllers\Api\MachineLogController;

/*
|--------------------------------------------------------------------------
| API Routes
|--------------------------------------------------------------------------
*/

// Machine Log — บันทึกสถานะเครื่องจักรลง Google Sheets
Route::prefix('machine-log')->group(function () {
    Route::post('/append', [MachineLogController::class, 'append']);
    Route::get('/reporters', [MachineLogController::class, 'reportersIndex']);
    Route::post('/reporters', [MachineLogController::class, 'reportersStore']);
    Route::delete('/reporters/{id}', [MachineLogController::class, 'reportersDestroy'])
        ->whereNumber('id');
});

/*
|--------------------------------------------------------------------------
| Production Monitor — อุปกรณ์/ตาชั่งไม่มี token (เหมือนเดิม)
|--------------------------------------------------------------------------
*/
Route::prefix('production-monitor')->group(function () {
    Route::post('/scale-command/{machineId}', [ProductionMonitorController::class, 'storeScaleCommand']);
    Route::get('/scale-command/{machineId}', [ProductionMonitorController::class, 'fetchScaleCommand']);
    Route::post('/scale-confirm/{machineId}', [ProductionMonitorController::class, 'storeScaleConfirm']);
    Route::get('/scale-confirm/{machineId}', [ProductionMonitorController::class, 'fetchScaleConfirm']);
    Route::post('/scale-live/{machineId}', [ProductionMonitorController::class, 'storeScaleLive']);
    Route::get('/scale-live/{machineId}', [ProductionMonitorController::class, 'fetchScaleLive']);
    Route::post('/scale-weight/{machineId}', [ProductionMonitorController::class, 'storeScaleWeight']);
    Route::get('/scale-weight/{machineId}', [ProductionMonitorController::class, 'fetchScaleWeights']);
    Route::post('/session-confirm/{machineId}', [ProductionMonitorController::class, 'sessionConfirm']);
    Route::get('/led-command/{machineId}', [ProductionMonitorController::class, 'fetchLedCommand']);
});

/*
|--------------------------------------------------------------------------
| Production Monitor — ต้อง login (Bearer หรือ ?token= สำหรับ SSE)
| admin / user เข้าได้ทุก route ในกลุ่มนี้ ยกเว้นย่อยที่สำเร็จด้วย middleware admin
|--------------------------------------------------------------------------
*/
Route::prefix('production-monitor')->middleware(['sanctum.query', 'auth:sanctum'])->group(function () {
    Route::get('/get-settings', [ProductionMonitorController::class, 'getSettings']);
    Route::get('/history', [ProductionMonitorController::class, 'getHistory']);
    Route::get('/order-detail', [ProductionMonitorController::class, 'getOrderDetail']);

    Route::get('/plan', [ProductionMonitorController::class, 'getProductionPlan']);
    Route::get('/monthly-plan', [ProductionMonitorController::class, 'getMonthlyPlan']);
    Route::get('/daily-plan', [ProductionMonitorController::class, 'getDailyPlan']);

    Route::get('/product-lookup', [ProductionMonitorController::class, 'getProductLookup']);
    Route::get('/product-details', [ProductionMonitorController::class, 'getProductDetails']);

    Route::get('/led-ping', [ProductionMonitorController::class, 'pingLed']);
    Route::get('/led-status/{machineId}', [ProductionMonitorController::class, 'getLedStatus']);
    Route::get('/led-heartbeat/{machineId}', [ProductionMonitorController::class, 'getLedHeartbeat']);

    Route::get('/machine-sessions', [ProductionMonitorController::class, 'fetchAllMachineSessions']);
    Route::get('/state-snapshot', [ProductionMonitorController::class, 'stateSnapshot']);
    Route::get('/stream', [ProductionMonitorController::class, 'stream'])
        ->withoutMiddleware(['throttle:api']);

    Route::get('/queue/{machineId}', [ProductionMonitorController::class, 'getQueue']);
    Route::get('/session/{machineId}', [ProductionMonitorController::class, 'getSession']);
    Route::get('/history-db', [ProductionMonitorController::class, 'getHistoryDb']);
    Route::get('/order-detail-db', [ProductionMonitorController::class, 'orderDetailDb']);

    // ป้ายไฟ — user ธรรมดาใช้ได้
    Route::post('/led', [ProductionMonitorController::class, 'sendLedCommand']);
    Route::post('/led-command/{machineId}', [ProductionMonitorController::class, 'storeLedCommand']);

    // จัดการการผลิต — เฉพาะ admin
    Route::middleware('admin')->group(function () {
        Route::get('/debug', [ProductionMonitorController::class, 'debug']);

        Route::post('/create-order', [ProductionMonitorController::class, 'createOrder']);
        Route::post('/update-weight', [ProductionMonitorController::class, 'updateWeight']);
        Route::post('/close-order', [ProductionMonitorController::class, 'closeOrder']);
        Route::post('/log-weight-event', [ProductionMonitorController::class, 'logWeightEvent']);

        Route::post('/update-daily-produced', [ProductionMonitorController::class, 'updateDailyProduced']);
        Route::post('/update-plan-produced', [ProductionMonitorController::class, 'updatePlanProduced']);

        Route::post('/push-to-scale/{machineId}', [ProductionMonitorController::class, 'pushToScale']);

        Route::post('/machine-session/{machineId}', [ProductionMonitorController::class, 'storeMachineSession']);

        Route::post('/queue/{machineId}', [ProductionMonitorController::class, 'enqueueItem']);
        Route::delete('/queue/{machineId}/{itemId}', [ProductionMonitorController::class, 'deleteQueueItem'])
            ->whereNumber('itemId');

        Route::post('/start/{machineId}', [ProductionMonitorController::class, 'startSession']);
        Route::post('/pause/{machineId}', [ProductionMonitorController::class, 'pauseSession']);
        Route::post('/finish/{machineId}', [ProductionMonitorController::class, 'finishSession']);
        Route::post('/cancel/{machineId}', [ProductionMonitorController::class, 'cancelSession']);

        Route::delete('/history-order/{id}', [ProductionMonitorController::class, 'deleteFinishedHistoryOrder'])
            ->whereNumber('id');
    });
});
