<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\MaintenanceRequest;
use App\Models\MaintenanceRequestNotification;
use App\Models\MaintenanceRequestReferenceMedia;
use App\Models\User;
use App\Services\LineMaintenanceNotifyService;
use App\Services\MaintenanceRegisterSheetService;
use Barryvdh\DomPDF\Facade\Pdf;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;

class MaintenanceRequestController extends Controller
{
    public function index(Request $request)
    {
        $user = $request->user();
        $query = MaintenanceRequest::with(['user:id,name,username', 'reviewedBy:id,name,username', 'referenceMedia'])
            ->orderByDesc('created_at');

        if ($user->role === 'admin') {
            // all rows
        } elseif ($user->role === 'technician') {
            $query->whereIn('status', [
                MaintenanceRequest::STATUS_APPROVED,
                MaintenanceRequest::STATUS_AWAITING_ACCEPTANCE,
                MaintenanceRequest::STATUS_AWAITING_ADMIN_CLOSURE,
                MaintenanceRequest::STATUS_COMPLETED,
            ]);
        } else {
            $query->where('user_id', $user->id);
        }

        $page = $query->paginate(30);
        $page->getCollection()->transform(fn (MaintenanceRequest $r) => $this->transformRequest($r));

        return response()->json($page);
    }

    public function show(Request $request, int $id)
    {
        $record = MaintenanceRequest::with(['user:id,name,username', 'reviewedBy:id,name,username', 'referenceMedia'])->findOrFail($id);
        if (! $this->canView($request->user(), $record)) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        return response()->json($this->transformRequest($record));
    }

    public function store(Request $request)
    {
        $request->validate([
            'payload' => 'required|string',
            'photo_before' => 'nullable|image|max:12288',
            'photo_after' => 'nullable|image|max:12288',
            'reference_images' => 'nullable|array',
            'reference_images.*' => 'image|max:12288',
        ]);

        $payload = json_decode($request->payload, true);
        if (! is_array($payload)) {
            return response()->json(['message' => 'payload ต้องเป็น JSON ที่ถูกต้อง'], 422);
        }

        $sheet = app(MaintenanceRegisterSheetService::class);
        if ($sheet->isEnabled()) {
            $this->validateReporterPayloadForRegisterSheet($payload);
        }

        $record = $sheet->withAllocateLock(function () use ($request, $payload, $sheet) {
            return DB::transaction(function () use ($request, $payload, $sheet) {
                $before = $request->file('photo_before');
                $after = $request->file('photo_after');

                if ($sheet->isEnabled()) {
                    $alloc = $sheet->allocateNextIndices();
                    $row = MaintenanceRequest::create([
                        'notification_number' => $alloc['me_number'],
                        'register_sheet_row' => $alloc['row'],
                        'user_id' => $request->user()->id,
                        'status' => MaintenanceRequest::STATUS_PENDING_REVIEW,
                        'payload' => $payload,
                        'photo_before_path' => $before ? $before->store('maintenance-requests', 'public') : null,
                        'photo_after_path' => $after ? $after->store('maintenance-requests', 'public') : null,
                    ]);
                    $sheet->writeRowFromRecord($row->fresh(['user:id,name,username', 'referenceMedia']), $alloc['seq_a']);
                } else {
                    $row = MaintenanceRequest::create([
                        'notification_number' => $this->nextNotificationNumber(),
                        'register_sheet_row' => null,
                        'user_id' => $request->user()->id,
                        'status' => MaintenanceRequest::STATUS_PENDING_REVIEW,
                        'payload' => $payload,
                        'photo_before_path' => $before ? $before->store('maintenance-requests', 'public') : null,
                        'photo_after_path' => $after ? $after->store('maintenance-requests', 'public') : null,
                    ]);
                }

                $refs = $request->file('reference_images', []);
                if (! is_array($refs)) {
                    $refs = [];
                }
                foreach ($refs as $i => $file) {
                    if ($file && $file->isValid()) {
                        $path = $file->store('maintenance-requests/references', 'public');
                        MaintenanceRequestReferenceMedia::create([
                            'maintenance_request_id' => $row->id,
                            'path' => $path,
                            'sort_order' => (int) $i,
                        ]);
                    }
                }

                return $row->fresh(['user:id,name,username', 'referenceMedia']);
            });
        });

        $this->notifyAdmins(
            $record,
            'submitted',
            'ใบแจ้งซ่อมใหม่ '.$record->notification_number,
            'มีการยืนยันส่งใบแจ้งซ่อมจาก '.$request->user()->name
        );

        app(LineMaintenanceNotifyService::class)->notifyMaintenanceCreated($record, $request->user());

        return response()->json($this->transformRequest($record), 201);
    }

    public function update(Request $request, int $id)
    {
        $request->validate([
            'payload' => 'required|string',
            'photo_before' => 'nullable|image|max:12288',
            'photo_after' => 'nullable|image|max:12288',
            'clear_photo_before' => 'nullable|boolean',
            'clear_photo_after' => 'nullable|boolean',
        ]);

        $record = MaintenanceRequest::findOrFail($id);
        $actor = $request->user();

        $allowedKeys = $this->allowedPayloadKeys($actor, $record);
        if (is_array($allowedKeys) && $allowedKeys === []) {
            return response()->json(['message' => 'ไม่สามารถแก้ไขใบในสถานะนี้ได้'], 403);
        }

        $incoming = json_decode($request->payload, true);
        if (! is_array($incoming)) {
            return response()->json(['message' => 'payload ต้องเป็น JSON ที่ถูกต้อง'], 422);
        }

        $canTouchPhotos = $actor->role === 'admin'
            || ($actor->role === 'technician' && $record->status === MaintenanceRequest::STATUS_APPROVED);

        if (! $canTouchPhotos && (
            $request->hasFile('photo_before')
            || $request->hasFile('photo_after')
            || $request->boolean('clear_photo_before')
            || $request->boolean('clear_photo_after')
        )) {
            return response()->json(['message' => 'ไม่สามารถแก้ไขรูปในสถานะนี้ได้'], 422);
        }

        $basePayload = $record->payload ?? [];
        if ($actor->role !== 'admin'
            && $record->user_id === $actor->id
            && $record->status === MaintenanceRequest::STATUS_AWAITING_ACCEPTANCE
            && is_array($allowedKeys)
            && $allowedKeys === ['inspection']) {
            $merged = $this->mergeOwnerInspectionDraft($basePayload, $incoming);
        } else {
            $merged = $this->mergePayload($allowedKeys, $basePayload, $incoming);
        }

        $photoBeforePath = $record->photo_before_path;
        $photoAfterPath = $record->photo_after_path;

        if ($canTouchPhotos) {
            if ($request->boolean('clear_photo_before')) {
                if ($photoBeforePath) {
                    Storage::disk('public')->delete($photoBeforePath);
                }
                $photoBeforePath = null;
            }
            if ($request->boolean('clear_photo_after')) {
                if ($photoAfterPath) {
                    Storage::disk('public')->delete($photoAfterPath);
                }
                $photoAfterPath = null;
            }

            if ($request->hasFile('photo_before')) {
                if ($photoBeforePath) {
                    Storage::disk('public')->delete($photoBeforePath);
                }
                $photoBeforePath = $request->file('photo_before')->store('maintenance-requests', 'public');
            }
            if ($request->hasFile('photo_after')) {
                if ($photoAfterPath) {
                    Storage::disk('public')->delete($photoAfterPath);
                }
                $photoAfterPath = $request->file('photo_after')->store('maintenance-requests', 'public');
            }
        }

        $record->update([
            'payload' => $merged,
            'photo_before_path' => $photoBeforePath,
            'photo_after_path' => $photoAfterPath,
        ]);

        $isAdmin = $actor->role === 'admin';

        if ($isAdmin) {
            if ($record->user_id !== $actor->id) {
                $this->notifyOwner(
                    $record,
                    'updated_by_admin',
                    'แอดมินอัปเดตใบ '.$record->notification_number,
                    $actor->name.' แก้ไขข้อมูลในใบแจ้งซ่อม'
                );
            }
        } elseif ($actor->role === 'technician') {
            $this->notifyAdmins(
                $record,
                'updated_by_technician',
                'ช่างอัปเดตใบ '.$record->notification_number,
                $actor->name.' บันทึกความคืบหน้าแบบฟอร์มซ่อม'
            );
            $this->notifyOwner(
                $record,
                'updated_by_technician',
                'อัปเดตใบ '.$record->notification_number,
                'ช่าง '.$actor->name.' มีการบันทึกแบบฟอร์มซ่อมบำรุง'
            );
        } else {
            $this->notifyAdmins(
                $record,
                'updated_by_submitter',
                'มีการแก้ไขใบ '.$record->notification_number,
                $actor->name.' แก้ไขใบแจ้งซ่อม กรุณาตรวจสอบ'
            );
        }

        $this->syncRegisterSheet($record);

        return response()->json($this->transformRequest($record->fresh(['user:id,name,username', 'reviewedBy:id,name,username', 'referenceMedia'])));
    }

    /** ช่างกดเสร็จสิ้น — ส่งต่อให้เจ้าของใบตรวจรับ */
    public function technicianComplete(Request $request, int $id)
    {
        $record = MaintenanceRequest::findOrFail($id);
        if ($request->user()->role !== 'technician') {
            return response()->json(['message' => 'Unauthorized'], 403);
        }
        if ($record->status !== MaintenanceRequest::STATUS_APPROVED) {
            return response()->json(['message' => 'สถานะปัจจุบันไม่พร้อมให้ปิดงานช่าง'], 422);
        }

        $record->update([
            'status' => MaintenanceRequest::STATUS_AWAITING_ACCEPTANCE,
            'tech_completed_at' => now(),
        ]);

        $this->notifyOwner(
            $record,
            'tech_completed',
            'ซ่อมเสร็จแล้ว '.$record->notification_number,
            'กรุณาตรวจรับงานและบันทึกผลในฟอร์ม — จากนั้นระบบจะส่งต่อให้ฝ่ายวางแผนการผลิตลงนามปิดงาน'
        );

        $this->syncRegisterSheet($record);

        return response()->json($this->transformRequest($record->fresh(['user:id,name,username', 'reviewedBy:id,name,username'])));
    }

    /** ผู้แจ้งส่งผลตรวจรับ → รอ Admin (ฝ่ายวางแผน) ลงนามปิดงาน */
    public function ownerSubmitInspection(Request $request, int $id)
    {
        $request->validate([
            'payload' => 'required|string',
        ]);

        $record = MaintenanceRequest::findOrFail($id);
        $user = $request->user();
        if ($record->user_id !== $user->id) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }
        if ($record->status !== MaintenanceRequest::STATUS_AWAITING_ACCEPTANCE) {
            return response()->json(['message' => 'สถานะไม่พร้อมให้ส่งผลตรวจรับ'], 422);
        }

        $incoming = json_decode($request->payload, true);
        if (! is_array($incoming)) {
            return response()->json(['message' => 'payload ต้องเป็น JSON ที่ถูกต้อง'], 422);
        }

        $merged = $this->mergeOwnerInspectionForSubmit($record->payload ?? [], $incoming);
        $ins = $merged['inspection'] ?? [];
        $result = $ins['result'] ?? '';
        if (! in_array($result, ['normal', 'abnormal'], true)) {
            return response()->json(['message' => 'กรุณาเลือกผลตรวจรับ (ปกติ / ไม่ปกติ)'], 422);
        }
        if ($result === 'abnormal' && trim((string) ($ins['abnormalReason'] ?? '')) === '') {
            return response()->json(['message' => 'กรุณาระบุเหตุผลเมื่อใช้งานไม่ปกติ'], 422);
        }
        if (trim((string) ($ins['inspectorName'] ?? '')) === '' || trim((string) ($ins['inspectorDate'] ?? '')) === '') {
            return response()->json(['message' => 'กรุณาระบุผู้ตรวจรับและวันที่ผู้ตรวจให้ครบ'], 422);
        }

        $record->update([
            'status' => MaintenanceRequest::STATUS_AWAITING_ADMIN_CLOSURE,
            'payload' => $merged,
        ]);

        $this->notifyAdmins(
            $record,
            'owner_inspection_submitted',
            'ผู้แจ้งส่งผลตรวจรับ '.$record->notification_number,
            $user->name.' บันทึกผลตรวจรับแล้ว — รอฝ่ายวางแผนการผลิตลงนามปิดงาน'
        );

        $this->syncRegisterSheet($record);

        return response()->json($this->transformRequest($record->fresh(['user:id,name,username', 'reviewedBy:id,name,username'])));
    }

    /** Admin ลงนามฝ่ายวางแผนการผลิต + วันที่ → ปิดใบ */
    public function adminCloseMaintenance(Request $request, int $id)
    {
        $request->validate([
            'payload' => 'required|string',
        ]);

        $record = MaintenanceRequest::findOrFail($id);
        $actor = $request->user();
        if ($actor->role !== 'admin') {
            return response()->json(['message' => 'Unauthorized'], 403);
        }
        if ($record->status !== MaintenanceRequest::STATUS_AWAITING_ADMIN_CLOSURE) {
            return response()->json(['message' => 'สถานะไม่พร้อมให้ปิดงาน'], 422);
        }

        $incoming = json_decode($request->payload, true);
        if (! is_array($incoming)) {
            return response()->json(['message' => 'payload ต้องเป็น JSON ที่ถูกต้อง'], 422);
        }

        $incIns = $incoming['inspection'] ?? [];
        $planName = trim((string) ($incIns['productionPlanningName'] ?? ''));
        $planDate = trim((string) ($incIns['productionPlanningDate'] ?? ''));
        if ($planName === '' || $planDate === '') {
            return response()->json(['message' => 'กรุณาระบุชื่อฝ่ายวางแผนการผลิตและวันที่ให้ครบ'], 422);
        }

        $merged = $record->payload ?? [];
        $merged['inspection'] = array_merge($merged['inspection'] ?? [], [
            'productionPlanningName' => $planName,
            'productionPlanningDate' => $planDate,
        ]);

        $record->update([
            'status' => MaintenanceRequest::STATUS_COMPLETED,
            'payload' => $merged,
            'owner_accepted_at' => now(),
        ]);

        $this->notifyOwner(
            $record,
            'maintenance_closed',
            'ปิดงาน '.$record->notification_number,
            'แบบฟอร์มปิดสมบูรณ์แล้ว — ฝ่ายวางแผนการผลิตลงนามเรียบร้อย'
        );
        $this->notifyTechnicians(
            $record,
            'maintenance_closed',
            'ปิดงาน '.$record->notification_number,
            'ใบ '.$record->notification_number.' ปิดงานสมบูรณ์'
        );

        $this->syncRegisterSheet($record);

        return response()->json($this->transformRequest($record->fresh(['user:id,name,username', 'reviewedBy:id,name,username'])));
    }

    public function pdf(Request $request, int $id)
    {
        $record = MaintenanceRequest::with(['user:id,name,username', 'reviewedBy:id,name,username', 'referenceMedia'])->findOrFail($id);
        if (! $this->canView($request->user(), $record)) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }
        if ($record->status !== MaintenanceRequest::STATUS_COMPLETED) {
            return response()->json(['message' => 'ดาวน์โหลด PDF ได้เมื่อปิดงานและตรวจรับครบแล้วเท่านั้น'], 422);
        }

        $fontRegularPath = storage_path('fonts/Sarabun-Regular.ttf');
        $fontBoldPath = storage_path('fonts/Sarabun-Bold.ttf');
        $fontUrl = is_file($fontRegularPath) ? str_replace('\\', '/', $fontRegularPath) : null;
        // Dompdf ใช้ฟอนต์ bold แยกต่างหาก — ถ้าไม่ลงทะเบียน ข้อความ <strong> จะไป Helvetica-Bold ไม่มี glyภ ไทย (แสดงเป็นช่อง แต่ copy ได้)
        $fontBoldUrl = $fontUrl !== null
            ? str_replace('\\', '/', is_file($fontBoldPath) ? $fontBoldPath : $fontRegularPath)
            : null;

        try {
            $pdf = Pdf::loadView('maintenance-request-pdf', [
                'record' => $record,
                'fontUrl' => $fontUrl,
                'fontBoldUrl' => $fontBoldUrl,
            ]);
            $projectRoot = realpath(base_path());
            if ($projectRoot !== false) {
                $pdf->setBasePath(str_replace('\\', '/', $projectRoot));
            }
            $pdf->setPaper('a4', 'portrait');
            $filename = $record->notification_number.'.pdf';

            return $pdf->download($filename);
        } catch (\Throwable $e) {
            report($e);

            $message = 'สร้าง PDF ไม่สำเร็จ';
            if (config('app.debug')) {
                $message .= ' — '.$e->getMessage();
            } else {
                $message .= ' — ลองดูรายละเอียดในล็อกเซิร์ฟเวอร์ หรือเปิด APP_DEBUG ชั่วคราวเพื่อดูข้อความผิดพลาด';
            }

            return response()->json(['message' => $message], 500);
        }
    }

    public function approve(Request $request, int $id)
    {
        $request->validate([
            'admin_note' => 'nullable|string|max:2000',
        ]);

        $record = MaintenanceRequest::findOrFail($id);
        $actor = $request->user();
        if ($actor->role !== 'admin') {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        if (! in_array($record->status, [MaintenanceRequest::STATUS_PENDING_REVIEW, 'pending'], true)) {
            return response()->json(['message' => 'ใบนี้ไม่อยู่ในสถานะรอพิจารณา'], 422);
        }

        $record->update([
            'status' => MaintenanceRequest::STATUS_APPROVED,
            'admin_note' => $request->input('admin_note'),
            'reviewed_by_id' => $actor->id,
            'reviewed_at' => now(),
        ]);

        $this->notifyOwner(
            $record,
            'approved',
            'อนุมัติใบ '.$record->notification_number,
            'ผู้ดูแลระบบอนุมัติคำขอของคุณแล้ว — ช่างจะดำเนินการต่อ'
        );
        $this->notifyTechnicians(
            $record,
            'approved',
            'ใบซ่อมรอดำเนินการ '.$record->notification_number,
            'มีใบแจ้งซ่อมได้รับการอนุมัติจาก '.$record->user?->name
        );

        $this->syncRegisterSheet($record);

        return response()->json($this->transformRequest($record->fresh(['user:id,name,username', 'reviewedBy:id,name,username'])));
    }

    public function reject(Request $request, int $id)
    {
        $request->validate([
            'admin_note' => 'required|string|max:2000',
        ]);

        $record = MaintenanceRequest::findOrFail($id);
        $actor = $request->user();
        if ($actor->role !== 'admin') {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        if (! in_array($record->status, [MaintenanceRequest::STATUS_PENDING_REVIEW, 'pending'], true)) {
            return response()->json(['message' => 'ใบนี้ไม่อยู่ในสถานะรอพิจารณา'], 422);
        }

        $record->update([
            'status' => MaintenanceRequest::STATUS_REJECTED,
            'admin_note' => $request->input('admin_note'),
            'reviewed_by_id' => $actor->id,
            'reviewed_at' => now(),
        ]);

        $this->notifyOwner(
            $record,
            'rejected',
            'ปฏิเสธใบ '.$record->notification_number,
            $request->input('admin_note')
        );

        $this->syncRegisterSheet($record);

        return response()->json($this->transformRequest($record->fresh(['user:id,name,username', 'reviewedBy:id,name,username'])));
    }

    public function destroy(Request $request, int $id)
    {
        $record = MaintenanceRequest::with(['referenceMedia'])->findOrFail($id);
        $actor = $request->user();
        if (! $this->canDeleteMaintenance($actor, $record)) {
            return response()->json(['message' => 'ไม่มีสิทธิ์ลบใบนี้ หรือสถานะยังดำเนินการไม่จบ'], 403);
        }

        DB::transaction(function () use ($record) {
            foreach ($record->referenceMedia as $media) {
                if ($media->path) {
                    Storage::disk('public')->delete($media->path);
                }
            }
            if ($record->photo_before_path) {
                Storage::disk('public')->delete($record->photo_before_path);
            }
            if ($record->photo_after_path) {
                Storage::disk('public')->delete($record->photo_after_path);
            }
            $record->delete();
        });

        return response()->json(['ok' => true]);
    }

    public function notificationsIndex(Request $request)
    {
        $items = MaintenanceRequestNotification::where('user_id', $request->user()->id)
            ->with(['maintenanceRequest:id,notification_number,status'])
            ->orderByDesc('created_at')
            ->limit(50)
            ->get();

        return response()->json($items);
    }

    public function unreadCount(Request $request)
    {
        $count = MaintenanceRequestNotification::where('user_id', $request->user()->id)
            ->whereNull('read_at')
            ->count();

        return response()->json(['count' => $count]);
    }

    public function markNotificationRead(Request $request, int $id)
    {
        $n = MaintenanceRequestNotification::where('user_id', $request->user()->id)->findOrFail($id);
        if (! $n->read_at) {
            $n->update(['read_at' => now()]);
        }

        return response()->json(['ok' => true]);
    }

    public function markAllRead(Request $request)
    {
        MaintenanceRequestNotification::where('user_id', $request->user()->id)
            ->whereNull('read_at')
            ->update(['read_at' => now()]);

        return response()->json(['ok' => true]);
    }

    public function destroyNotification(Request $request, int $id)
    {
        $n = MaintenanceRequestNotification::where('user_id', $request->user()->id)->findOrFail($id);
        $n->delete();

        return response()->json(['ok' => true]);
    }

    public function destroyAllNotifications(Request $request)
    {
        MaintenanceRequestNotification::where('user_id', $request->user()->id)->delete();

        return response()->json(['ok' => true]);
    }

    private function canDeleteMaintenance(User $user, MaintenanceRequest $record): bool
    {
        if ($user->role === 'admin') {
            return true;
        }
        if ($record->user_id !== $user->id) {
            return false;
        }

        return in_array($record->status, [
            MaintenanceRequest::STATUS_PENDING_REVIEW,
            'pending',
            MaintenanceRequest::STATUS_REJECTED,
            MaintenanceRequest::STATUS_COMPLETED,
        ], true);
    }

    private function canView(User $user, MaintenanceRequest $record): bool
    {
        if ($user->role === 'admin') {
            return true;
        }
        if ($record->user_id === $user->id) {
            return true;
        }
        if ($user->role === 'technician') {
            return in_array($record->status, [
                MaintenanceRequest::STATUS_APPROVED,
                MaintenanceRequest::STATUS_AWAITING_ACCEPTANCE,
                MaintenanceRequest::STATUS_AWAITING_ADMIN_CLOSURE,
                MaintenanceRequest::STATUS_COMPLETED,
            ], true);
        }

        return false;
    }

    /**
     * @return array<string>|null null = admin แก้ได้ทุกฟิลด์
     */
    private function allowedPayloadKeys(User $user, MaintenanceRequest $record): ?array
    {
        if ($user->role === 'admin') {
            return null;
        }
        if ($user->role === 'technician' && $record->status === MaintenanceRequest::STATUS_APPROVED) {
            return ['maintenance', 'analysis', 'procurement', 'timeline'];
        }
        if ($record->user_id === $user->id) {
            if (in_array($record->status, [MaintenanceRequest::STATUS_PENDING_REVIEW, 'pending'], true)) {
                return ['notifiedAt', 'requesterName', 'department', 'registerWorkCategory', 'machineEquipment', 'workType', 'symptoms', 'urgency', 'remarks', 'signatures'];
            }
            if ($record->status === MaintenanceRequest::STATUS_AWAITING_ACCEPTANCE) {
                return ['inspection'];
            }
            if ($record->status === MaintenanceRequest::STATUS_AWAITING_ADMIN_CLOSURE) {
                return [];
            }
        }

        return [];
    }

    /**
     * @param  array<string>|null  $allowedTopLevelKeys
     */
    private function mergePayload(?array $allowedTopLevelKeys, array $base, array $incoming): array
    {
        if ($allowedTopLevelKeys === null) {
            return array_replace_recursive($base, $incoming);
        }

        $out = $base;
        foreach ($allowedTopLevelKeys as $key) {
            if (! array_key_exists($key, $incoming)) {
                continue;
            }
            $inc = $incoming[$key];
            if (is_array($inc) && isset($out[$key]) && is_array($out[$key])) {
                $out[$key] = array_replace_recursive($out[$key], $inc);
            } else {
                $out[$key] = $inc;
            }
        }

        return $out;
    }

    private function mergeOwnerInspectionDraft(array $base, array $incoming): array
    {
        $keys = ['result', 'abnormalReason', 'inspectorName', 'inspectorDate'];
        $inc = array_intersect_key($incoming['inspection'] ?? [], array_flip($keys));
        $out = $base;
        $out['inspection'] = array_merge($out['inspection'] ?? [], $inc);

        return $out;
    }

    private function mergeOwnerInspectionForSubmit(array $base, array $incoming): array
    {
        $keys = ['result', 'abnormalReason', 'inspectorName', 'inspectorDate'];
        $inc = array_intersect_key($incoming['inspection'] ?? [], array_flip($keys));
        $out = $base;
        $planKeys = ['productionPlanningName', 'productionPlanningDate'];
        $prevPlanning = array_intersect_key($out['inspection'] ?? [], array_flip($planKeys));
        $out['inspection'] = array_merge($out['inspection'] ?? [], $inc, $prevPlanning);

        return $out;
    }

    private function validateReporterPayloadForRegisterSheet(array $payload): void
    {
        Validator::make($payload, [
            'registerWorkCategory' => 'required|string|max:255',
            'department' => 'required|string|max:500',
            'requesterName' => 'required|string|max:255',
            'machineEquipment' => 'required|string|max:500',
            'symptoms' => 'required|string|max:10000',
        ])->validate();

        $wt = $payload['workType'] ?? [];
        $hasType = ! empty($wt['bm']) || ! empty($wt['cm']) || ! empty($wt['pm']) || ! empty($wt['other']);
        if (! $hasType) {
            throw ValidationException::withMessages([
                'payload' => ['กรุณาเลือกประเภทงาน (BM / CM / PM / อื่นๆ) อย่างน้อยหนึ่งประเภท'],
            ]);
        }
        if (! empty($wt['other']) && trim((string) ($wt['otherDetail'] ?? '')) === '') {
            throw ValidationException::withMessages([
                'payload' => ['กรุณาระบุรายละเอียดเมื่อเลือกประเภทงาน อื่นๆ'],
            ]);
        }
    }

    private function syncRegisterSheet(MaintenanceRequest $record): void
    {
        $svc = app(MaintenanceRegisterSheetService::class);
        if (! $svc->isEnabled()) {
            return;
        }
        try {
            $svc->updateRow($record->fresh());
        } catch (\Throwable $e) {
            report($e);
        }
    }

    private function nextNotificationNumber(): string
    {
        $year = now()->year;
        $prefix = 'MTN-'.$year.'-';

        $last = MaintenanceRequest::where('notification_number', 'like', $prefix.'%')
            ->orderByDesc('id')
            ->value('notification_number');

        $seq = 1;
        if ($last && str_starts_with($last, $prefix)) {
            $seq = (int) substr($last, strlen($prefix)) + 1;
        }

        return $prefix.str_pad((string) $seq, 5, '0', STR_PAD_LEFT);
    }

    private function notifyAdmins(MaintenanceRequest $record, string $eventType, string $title, ?string $body): void
    {
        $adminIds = User::where('role', 'admin')->pluck('id');
        foreach ($adminIds as $adminId) {
            MaintenanceRequestNotification::create([
                'maintenance_request_id' => $record->id,
                'user_id' => $adminId,
                'event_type' => $eventType,
                'title' => $title,
                'body' => $body,
            ]);
        }
    }

    private function notifyTechnicians(MaintenanceRequest $record, string $eventType, string $title, ?string $body): void
    {
        $ids = User::where('role', 'technician')->pluck('id');
        foreach ($ids as $uid) {
            MaintenanceRequestNotification::create([
                'maintenance_request_id' => $record->id,
                'user_id' => $uid,
                'event_type' => $eventType,
                'title' => $title,
                'body' => $body,
            ]);
        }
    }

    private function notifyOwner(MaintenanceRequest $record, string $eventType, string $title, ?string $body): void
    {
        MaintenanceRequestNotification::create([
            'maintenance_request_id' => $record->id,
            'user_id' => $record->user_id,
            'event_type' => $eventType,
            'title' => $title,
            'body' => $body,
        ]);
    }

    private function transformRequest(MaintenanceRequest $record): array
    {
        $record->loadMissing(['referenceMedia']);
        $data = $record->toArray();
        unset($data['reference_media']);
        $data['photo_before_url'] = $record->photo_before_path
            ? Storage::disk('public')->url($record->photo_before_path)
            : null;
        $data['photo_after_url'] = $record->photo_after_path
            ? Storage::disk('public')->url($record->photo_after_path)
            : null;
        $data['reference_image_urls'] = $record->referenceMedia
            ->map(static fn (MaintenanceRequestReferenceMedia $m) => Storage::disk('public')->url($m->path))
            ->values()
            ->all();

        return $data;
    }
}
