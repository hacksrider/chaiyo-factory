<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\MaintenanceRequest;
use App\Models\MaintenanceRequestNotification;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

class MaintenanceRequestController extends Controller
{
    public function index(Request $request)
    {
        $user = $request->user();
        $query = MaintenanceRequest::with(['user:id,name,username'])
            ->orderByDesc('created_at');

        if ($user->role !== 'admin') {
            $query->where('user_id', $user->id);
        }

        return response()->json($query->paginate(30));
    }

    public function show(Request $request, int $id)
    {
        $record = MaintenanceRequest::with(['user:id,name,username', 'reviewedBy:id,name,username'])->findOrFail($id);
        $this->authorizeRequest($request->user(), $record);

        return response()->json($this->transformRequest($record));
    }

    public function store(Request $request)
    {
        $request->validate([
            'payload' => 'required|string',
            'photo_before' => 'nullable|image|max:12288',
            'photo_after' => 'nullable|image|max:12288',
        ]);

        $payload = json_decode($request->payload, true);
        if (! is_array($payload)) {
            return response()->json(['message' => 'payload ต้องเป็น JSON ที่ถูกต้อง'], 422);
        }

        $record = DB::transaction(function () use ($request, $payload) {
            $number = $this->nextNotificationNumber();
            $before = $request->file('photo_before');
            $after = $request->file('photo_after');

            $row = MaintenanceRequest::create([
                'notification_number' => $number,
                'user_id' => $request->user()->id,
                'status' => 'pending',
                'payload' => $payload,
                'photo_before_path' => $before ? $before->store('maintenance-requests', 'public') : null,
                'photo_after_path' => $after ? $after->store('maintenance-requests', 'public') : null,
            ]);

            return $row->fresh(['user:id,name,username']);
        });

        $this->notifyAdmins(
            $record,
            'submitted',
            'ใบแจ้งซ่อมใหม่ '.$record->notification_number,
            'มีการยืนยันส่งใบแจ้งซ่อมจาก '.$request->user()->name
        );

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
        $this->authorizeRequest($request->user(), $record);

        $incoming = json_decode($request->payload, true);
        if (! is_array($incoming)) {
            return response()->json(['message' => 'payload ต้องเป็น JSON ที่ถูกต้อง'], 422);
        }

        $actor = $request->user();
        $isAdmin = $actor->role === 'admin';

        $merged = array_replace_recursive($record->payload ?? [], $incoming);

        $photoBeforePath = $record->photo_before_path;
        $photoAfterPath = $record->photo_after_path;

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

        $record->update([
            'payload' => $merged,
            'photo_before_path' => $photoBeforePath,
            'photo_after_path' => $photoAfterPath,
        ]);

        if ($isAdmin) {
            if ($record->user_id !== $actor->id) {
                $this->notifyOwner(
                    $record,
                    'updated_by_admin',
                    'แอดมินอัปเดตใบ '.$record->notification_number,
                    $actor->name.' แก้ไขข้อมูลในใบแจ้งซ่อม'
                );
            }
        } else {
            $this->notifyAdmins(
                $record,
                'updated_by_submitter',
                'มีการแก้ไขใบ '.$record->notification_number,
                $actor->name.' แก้ไขใบแจ้งซ่อม กรุณาตรวจสอบ'
            );
        }

        return response()->json($this->transformRequest($record->fresh(['user:id,name,username', 'reviewedBy:id,name,username'])));
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

        $record->update([
            'status' => 'approved',
            'admin_note' => $request->input('admin_note'),
            'reviewed_by_id' => $actor->id,
            'reviewed_at' => now(),
        ]);

        $this->notifyOwner(
            $record,
            'approved',
            'อนุมัติใบ '.$record->notification_number,
            'ผู้ดูแลระบบอนุมัติคำขอของคุณแล้ว'
        );

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

        $record->update([
            'status' => 'rejected',
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

        return response()->json($this->transformRequest($record->fresh(['user:id,name,username', 'reviewedBy:id,name,username'])));
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

    private function authorizeRequest(User $user, MaintenanceRequest $record): void
    {
        if ($user->role === 'admin') {
            return;
        }
        if ($record->user_id !== $user->id) {
            abort(403, 'Unauthorized');
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
        $data = $record->toArray();
        $data['photo_before_url'] = $record->photo_before_path
            ? Storage::disk('public')->url($record->photo_before_path)
            : null;
        $data['photo_after_url'] = $record->photo_after_path
            ? Storage::disk('public')->url($record->photo_after_path)
            : null;

        return $data;
    }
}
