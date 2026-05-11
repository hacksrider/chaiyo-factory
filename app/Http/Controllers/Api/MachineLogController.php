<?php

namespace App\Http\Controllers\Api;

use App\Models\MachineLogReporter;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Http\Client\ConnectionException;

class MachineLogController extends Controller
{
    private string $gasUrl;

    /** appendLog (machine_log_script.gs) | appendMachineLog (production_script.gs) */
    private string $appendAction;

    public function __construct()
    {
        // ถ้ามี GAS_MACHINE_LOG_URL → ใช้สคริปต์ Machine Log แยก (doPost action = appendLog)
        // ถ้าว่าง → fallback ไปที่ production_script.gs (action = appendMachineLog)
        $standalone = trim((string) env('GAS_MACHINE_LOG_URL', ''));
        if ($standalone !== '') {
            $this->gasUrl       = $standalone;
            $this->appendAction = 'appendLog';
        } else {
            $this->gasUrl       = env('GAS_PRODUCTION_URL', '');
            $this->appendAction = 'appendMachineLog';
        }
    }

    /**
     * POST /api/machine-log/append
     *
     * Proxies to GAS:
     *   - machine_log_script.gs      → action appendLog
     *   - production_script.gs       → action appendMachineLog (เมื่อไม่ตั้ง GAS_MACHINE_LOG_URL)
     *
     * Body: { machine, date, status, time, cause, team, reporter, productCode, detail, fix }
     */
    public function append(Request $request): JsonResponse
    {
        if (empty($this->gasUrl)) {
            return response()->json([
                'success' => false,
                'message' => 'Configure GAS_MACHINE_LOG_URL or GAS_PRODUCTION_URL in .env.',
            ], 503);
        }

        // Laravel required|string ถือว่า "" ว่างแล้ว fail — เว็บจึงเห็น 422 จากกะว่าง /
        // เครื่องไม่มี label จาก Settings
        $machineIn  = trim((string) $request->input('machine', ''));
        $teamIn     = trim((string) $request->input('team', ''));
        $reporterIn = trim((string) $request->input('reporter', ''));
        $request->merge([
            'machine'  => $machineIn !== '' ? $machineIn : '—',
            'team'     => $teamIn !== '' ? $teamIn : '—',
            'reporter' => $reporterIn !== '' ? $reporterIn : 'อัตโนมัติ',
        ]);

        $request->validate([
            'machine'     => 'required|string',
            'date'        => 'required|string',
            'status'      => 'required|string',
            'time'        => 'required|string',
            'team'        => 'required|string',
            'reporter'    => 'required|string',
            'cause'       => 'nullable|string',
            'productCode' => 'nullable|string',
            'detail'      => 'nullable|string',
            'fix'         => 'nullable|string',
        ]);

        $payload = array_merge(
            ['action' => $this->appendAction],
            $request->only(['machine', 'date', 'status', 'time', 'cause', 'team', 'reporter', 'productCode', 'detail', 'fix'])
        );

        set_time_limit(120);
        try {
            $response = Http::withoutVerifying()
                ->withOptions([
                    'allow_redirects' => [
                        'max'       => 10,
                        'strict'    => false,
                        'referer'   => false,
                        'protocols' => ['https', 'http'],
                    ],
                ])
                ->timeout(90) // GAS cold start อาจนานถึง 60-90s
                ->asJson()
                ->post($this->gasUrl, $payload);

            if ($response->failed()) {
                Log::error('[MachineLog] append: GAS returned HTTP ' . $response->status(), [
                    'body' => $response->body(),
                ]);
                return response()->json([
                    'success' => false,
                    'message' => 'GAS returned HTTP ' . $response->status(),
                ], 502);
            }

            $data = $response->json() ?? ['success' => true];
            return response()->json($data);

        } catch (ConnectionException $e) {
            Log::error('[MachineLog] append: Connection failed', ['error' => $e->getMessage()]);
            return response()->json([
                'success' => false,
                'message' => 'Could not connect to GAS: ' . $e->getMessage(),
            ], 502);
        } catch (\Exception $e) {
            Log::error('[MachineLog] append: Unexpected error', ['error' => $e->getMessage()]);
            return response()->json([
                'success' => false,
                'message' => 'Proxy error: ' . $e->getMessage(),
            ], 500);
        }
    }

    /**
     * GET /api/machine-log/reporters
     *
     * รายชื่อผู้ลงข้อมูล (Machine Log) สำหรับ dropdown ในหน้า LED
     */
    public function reportersIndex(): JsonResponse
    {
        $reporters = MachineLogReporter::query()
            ->orderBy('name')
            ->get(['id', 'name']);

        return response()->json(['reporters' => $reporters]);
    }

    /**
     * POST /api/machine-log/reporters
     *
     * Body: { name: string }
     */
    public function reportersStore(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'name' => 'required|string|max:255|unique:machine_log_reporters,name',
        ]);

        $name = trim($validated['name']);
        $row = MachineLogReporter::create(['name' => $name]);

        return response()->json([
            'success'  => true,
            'reporter' => ['id' => $row->id, 'name' => $row->name],
        ], 201);
    }

    /**
     * DELETE /api/machine-log/reporters/{id}
     */
    public function reportersDestroy(int $id): JsonResponse
    {
        $row = MachineLogReporter::find($id);
        if ($row === null) {
            return response()->json([
                'success' => false,
                'message' => 'Reporter not found.',
            ], 404);
        }

        $row->delete();

        return response()->json(['success' => true]);
    }
}
