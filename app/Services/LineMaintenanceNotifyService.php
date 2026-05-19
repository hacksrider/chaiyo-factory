<?php

namespace App\Services;

use App\Models\MaintenanceRequest;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Throwable;

class LineMaintenanceNotifyService
{
    private const PUSH_URL = 'https://api.line.me/v2/bot/message/push';

    private const MAX_TEXT_LENGTH = 4800;

    public function isConfigured(): bool
    {
        return $this->gasWebhookUrl() !== '' || $this->isLinePushConfigured();
    }

    /** เปิด flag + มี token + ปลายทาง (ส่งผ่าน LINE API โดยตรง) */
    public function isLinePushConfigured(): bool
    {
        if (! config('line_maintenance.notify_on_create_enabled')) {
            return false;
        }

        $token = trim((string) config('line_maintenance.channel_access_token'));
        $to = trim((string) config('line_maintenance.push_to_id'));

        return $token !== '' && $to !== '';
    }

    /** แจ้งทาง GAS และ/หรือ LINE เมื่อมีการสร้างใบแจ้งซ่อม (ส่วนผู้แจ้ง) */
    public function notifyMaintenanceCreated(MaintenanceRequest $record, User $submitter): void
    {
        if (! $this->isConfigured()) {
            return;
        }

        try {
            $text = $this->formatCreatedMessage($record, $submitter);
            if ($this->gasWebhookUrl() !== '') {
                $this->postToGasWebhook($text);
            }
            if ($this->isLinePushConfigured()) {
                $this->pushText($text);
            }
        } catch (Throwable $e) {
            report($e);
        }
    }

    private function gasWebhookUrl(): string
    {
        return trim((string) config('line_maintenance.gas_webhook_url'));
    }

    /** POST {"message":"..."} แบบ UTF-8 ให้สอดคล้องกับ Invoke-RestMethod + Content-Type application/json */
    private function postToGasWebhook(string $text): void
    {
        $url = $this->gasWebhookUrl();
        if ($url === '') {
            return;
        }

        $text = $this->clipText($text);
        $payload = json_encode(['message' => $text], JSON_UNESCAPED_UNICODE);
        if ($payload === false) {
            Log::warning('LINE/GAS maintenance notify: json_encode ล้มเหลว');

            return;
        }

        $response = Http::timeout(20)
            ->withHeaders([
                'Content-Type' => 'application/json; charset=utf-8',
            ])
            ->withBody($payload, 'application/json; charset=utf-8')
            ->post($url);

        if (! $response->successful()) {
            Log::warning('GAS maintenance notify ล้มเหลว', [
                'status' => $response->status(),
                'body' => $response->body(),
            ]);
        }
    }

    public function pushText(string $text): void
    {
        $token = trim((string) config('line_maintenance.channel_access_token'));
        $to = trim((string) config('line_maintenance.push_to_id'));

        $text = $this->clipText($text);

        $response = Http::timeout(15)
            ->withHeaders([
                'Authorization' => 'Bearer '.$token,
                'Content-Type' => 'application/json',
            ])
            ->post(self::PUSH_URL, [
                'to' => $to,
                'messages' => [
                    [
                        'type' => 'text',
                        'text' => $text,
                    ],
                ],
            ]);

        if (! $response->successful()) {
            Log::warning('LINE maintenance notify ล้มเหลว', [
                'status' => $response->status(),
                'body' => $response->body(),
            ]);
        }
    }

    private function formatCreatedMessage(MaintenanceRequest $record, User $submitter): string
    {
        $p = $record->payload ?? [];

        $notified = $this->formatNotifiedAt($p['notifiedAt'] ?? '');
        $requester = trim((string) ($p['requesterName'] ?? ''));
        $department = trim((string) ($p['department'] ?? ''));
        $register = trim((string) ($p['registerWorkCategory'] ?? ''));
        $machine = trim((string) ($p['machineEquipment'] ?? ''));
        $symptoms = trim((string) ($p['symptoms'] ?? ''));
        $remarks = trim((string) ($p['remarks'] ?? ''));
        $sigReporter = trim((string) ($p['signatures']['reporter'] ?? ''));
        $urgency = (($p['urgency'] ?? '') === 'urgent') ? 'ด่วน' : 'ปกติ';

        $account = trim($submitter->name ?? '');
        if ($account === '') {
            $account = (string) ($submitter->username ?? '');
        }

        $lines = [
            '📋 มีการแจ้งซ่อม📌',
            '',
            'เลขที่: '.$record->notification_number,

            '',
            '【ข้อมูลผู้แจ้ง】',
            'วัน/เวลาแจ้ง: '.$notified,
            'ผู้แจ้ง: '.$this->nv($requester),
            'แผนก: '.(preg_match('/\((.*?)\)/', $this->nv($department), $m) ? $m[1] : ''),
            'ประเภทงาน: '.$this->nv($register),
            'เครื่องจักร/อุปกรณ์: '.$this->nv($machine),
            'ความเร่งด่วน: '.$urgency,
            'ประเภทงาน: '.$this->formatWorkType($p['workType'] ?? []),
            '',
            'อาการ/ปัญหา:',
            $this->nv($symptoms),
        ];

        if ($remarks !== '') {
            $lines[] = '';
            $lines[] = 'หมายเหตุ:';
            $lines[] = $remarks;
        }

        if ($sigReporter !== '') {
            $lines[] = '';
            $lines[] = 'ลายเซ็นผู้แจ้ง (พิมพ์ชื่อ): '.$sigReporter;
        }

        $refCount = $record->referenceMedia()->count();
        if ($refCount > 0) {
            $lines[] = '';
            $lines[] = 'รูปอ้างอิงแนบ: '.$refCount.' ไฟล์ (ดูในระบบ)';
        }

        if ($record->photo_before_path) {
            $lines[] = 'รูปก่อนซ่อม: แนบแล้ว (ดูในระบบ)';
        }

        return implode("\n", $lines);
    }

    private function formatWorkType(array $wt): string
    {
        $parts = [];
        if (! empty($wt['bm'])) {
            $parts[] = 'BM';
        }
        if (! empty($wt['cm'])) {
            $parts[] = 'CM';
        }
        if (! empty($wt['pm'])) {
            $parts[] = 'PM';
        }
        if (! empty($wt['other'])) {
            $detail = trim((string) ($wt['otherDetail'] ?? ''));
            $parts[] = $detail !== '' ? 'อื่นๆ: '.$detail : 'อื่นๆ';
        }

        return $parts !== [] ? implode(', ', $parts) : '—';
    }

    private function formatNotifiedAt(string $raw): string
    {
        if ($raw === '') {
            return '—';
        }
        try {
            $c = Carbon::parse($raw)->timezone(config('app.timezone', 'Asia/Bangkok'));

            return $c->format('d/m/Y H:i');
        } catch (Throwable) {
            return $raw;
        }
    }

    private function nv(string $s): string
    {
        return $s !== '' ? $s : '—';
    }

    private function clipText(string $text): string
    {
        if (strlen($text) <= self::MAX_TEXT_LENGTH) {
            return $text;
        }

        return substr($text, 0, self::MAX_TEXT_LENGTH)."\n\n…(ตัดข้อความยาว — ดูรายละเอียดในระบบ)";
    }
}
