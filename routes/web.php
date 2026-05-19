<?php

use App\Http\Controllers\Api\AiGemController;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\CategoryController;
use App\Http\Controllers\Api\MachineController;
use App\Http\Controllers\Api\MachineZoneController;
use App\Http\Controllers\Api\MachineZoneProblemController;
use App\Http\Controllers\Api\MaintenanceRequestController;
use App\Http\Controllers\Api\PageContentController;
use App\Http\Controllers\Api\ProblemController;
use App\Http\Controllers\Api\PublicController;
use App\Http\Controllers\Api\UserController;
use App\Http\Middleware\EnsureUserIsAdmin;
use Illuminate\Support\Facades\Route;

// Public routes - no authentication required
Route::get('/', function () {
    return view('welcome');
});

// Public API routes
Route::prefix('api')->group(function () {
    // Public endpoints
    Route::get('/home', [PublicController::class, 'home']);
    Route::get('/page-content/{key}', [PublicController::class, 'getPageContent']);

    // Public problem viewing
    Route::get('/problems', [ProblemController::class, 'index']);
    Route::get('/problems/{id}', [ProblemController::class, 'show']);

    // Public categories
    Route::get('/categories', [CategoryController::class, 'index']);

    // Public AI Gems
    Route::get('/ai-gems', [AiGemController::class, 'index']);

    // Machine routes (public)
    Route::get('/machines', [MachineController::class, 'index']);
    Route::get('/machines/{id}', [MachineController::class, 'show']);
    Route::get('/machines/{machineId}/zones', [MachineZoneController::class, 'index']);
    Route::get('/machine-zones/{id}', [MachineZoneController::class, 'show']);
    Route::get('/machine-zones/{zoneId}/problems', [MachineZoneProblemController::class, 'index']);
    Route::get('/machine-zone-problems/{id}', [MachineZoneProblemController::class, 'show']);

    // Auth routes
    Route::post('/login', [AuthController::class, 'login']);

    // Protected admin routes
    Route::middleware('auth:sanctum')->group(function () {
        Route::get('/me', [AuthController::class, 'me']);
        Route::post('/logout', [AuthController::class, 'logout']);

        // ใบแจ้งซ่อม / บำรุงรักษาเครื่องจักร (FR-MTN-04)
        Route::get('/maintenance-requests', [MaintenanceRequestController::class, 'index']);
        Route::post('/maintenance-requests', [MaintenanceRequestController::class, 'store']);
        Route::get('/maintenance-requests/{id}', [MaintenanceRequestController::class, 'show'])
            ->whereNumber('id');
        Route::post('/maintenance-requests/{id}', [MaintenanceRequestController::class, 'update'])
            ->whereNumber('id');
        Route::put('/maintenance-requests/{id}', [MaintenanceRequestController::class, 'update'])
            ->whereNumber('id');
        Route::post('/maintenance-requests/{id}/technician-complete', [MaintenanceRequestController::class, 'technicianComplete'])
            ->whereNumber('id');
        Route::post('/maintenance-requests/{id}/owner-submit-inspection', [MaintenanceRequestController::class, 'ownerSubmitInspection'])
            ->whereNumber('id');
        Route::get('/maintenance-requests/{id}/pdf', [MaintenanceRequestController::class, 'pdf'])
            ->whereNumber('id');
        Route::delete('/maintenance-requests/{id}', [MaintenanceRequestController::class, 'destroy'])
            ->whereNumber('id');
        Route::get('/maintenance-notifications', [MaintenanceRequestController::class, 'notificationsIndex']);
        Route::get('/maintenance-notifications/unread-count', [MaintenanceRequestController::class, 'unreadCount']);
        Route::post('/maintenance-notifications/read-all', [MaintenanceRequestController::class, 'markAllRead']);
        Route::delete('/maintenance-notifications', [MaintenanceRequestController::class, 'destroyAllNotifications']);
        Route::delete('/maintenance-notifications/{id}', [MaintenanceRequestController::class, 'destroyNotification'])
            ->whereNumber('id');
        Route::post('/maintenance-notifications/{id}/read', [MaintenanceRequestController::class, 'markNotificationRead'])
            ->whereNumber('id');

        Route::middleware([EnsureUserIsAdmin::class])->group(function () {
            Route::post('/maintenance-requests/{id}/approve', [MaintenanceRequestController::class, 'approve'])
                ->whereNumber('id');
            Route::post('/maintenance-requests/{id}/reject', [MaintenanceRequestController::class, 'reject'])
                ->whereNumber('id');
            Route::post('/maintenance-requests/{id}/admin-close', [MaintenanceRequestController::class, 'adminCloseMaintenance'])
                ->whereNumber('id');
        });

        // Admin only routes
        Route::middleware([EnsureUserIsAdmin::class])->group(function () {
            // Problems management
            Route::get('/admin/problems', [ProblemController::class, 'all']);
            Route::post('/admin/problems', [ProblemController::class, 'store']);
            Route::post('/admin/problems/{id}', [ProblemController::class, 'update']); // For method spoofing
            Route::put('/admin/problems/{id}', [ProblemController::class, 'update']);
            Route::delete('/admin/problems/{id}', [ProblemController::class, 'destroy']);

            // Categories management
            Route::get('/admin/categories', [CategoryController::class, 'all']);
            Route::post('/admin/categories', [CategoryController::class, 'store']);
            Route::put('/admin/categories/{id}', [CategoryController::class, 'update']);
            Route::delete('/admin/categories/{id}', [CategoryController::class, 'destroy']);

            // Users management
            Route::get('/admin/users', [UserController::class, 'index']);
            Route::post('/admin/users', [UserController::class, 'store']);
            Route::put('/admin/users/{id}', [UserController::class, 'update']);
            Route::delete('/admin/users/{id}', [UserController::class, 'destroy']);

            // Page content management
            Route::get('/admin/page-contents', [PageContentController::class, 'index']);
            Route::get('/admin/page-contents/{id}', [PageContentController::class, 'show']);
            Route::post('/admin/page-contents', [PageContentController::class, 'store']);
            Route::put('/admin/page-contents/{id}', [PageContentController::class, 'update']);
            Route::put('/admin/page-contents/key/{key}', [PageContentController::class, 'updateByKey']);
            Route::delete('/admin/page-contents/{id}', [PageContentController::class, 'destroy']);

            // Machines management
            Route::get('/admin/machines', [MachineController::class, 'all']);
            Route::post('/admin/machines', [MachineController::class, 'store']);
            Route::post('/admin/machines/{id}', [MachineController::class, 'update']); // For method spoofing
            Route::put('/admin/machines/{id}', [MachineController::class, 'update']);
            Route::delete('/admin/machines/{id}', [MachineController::class, 'destroy']);

            // Machine Zones management
            Route::get('/admin/machines/{machineId}/zones', [MachineZoneController::class, 'all']);
            Route::post('/admin/machine-zones', [MachineZoneController::class, 'store']);
            Route::post('/admin/machine-zones/{id}', [MachineZoneController::class, 'update']); // For method spoofing
            Route::put('/admin/machine-zones/{id}', [MachineZoneController::class, 'update']);
            Route::delete('/admin/machine-zones/{id}', [MachineZoneController::class, 'destroy']);

            // Machine Zone Problems management
            Route::get('/admin/machine-zones/{zoneId}/problems', [MachineZoneProblemController::class, 'all']);
            Route::post('/admin/machine-zone-problems', [MachineZoneProblemController::class, 'store']);
            Route::post('/admin/machine-zone-problems/{id}', [MachineZoneProblemController::class, 'update']); // For method spoofing
            Route::put('/admin/machine-zone-problems/{id}', [MachineZoneProblemController::class, 'update']);
            Route::delete('/admin/machine-zone-problems/{id}', [MachineZoneProblemController::class, 'destroy']);

            // AI Gems management
            Route::get('/admin/ai-gems', [AiGemController::class, 'all']);
            Route::post('/admin/ai-gems', [AiGemController::class, 'store']);
            Route::put('/admin/ai-gems/{id}', [AiGemController::class, 'update']);
            Route::delete('/admin/ai-gems/{id}', [AiGemController::class, 'destroy']);
        });
    });
});

// Catch-all route for React Router - must be last
// This will catch all routes that don't match above and serve the React app
Route::get('/{any}', function () {
    return view('welcome');
})->where('any', '.*');
