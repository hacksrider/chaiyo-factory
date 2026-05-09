<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Jobs\SyncWeightEventToGas;
use App\Jobs\SyncOrderToGas;
use App\Models\ProductionQueueItem;
use App\Models\ProductionSession;
use App\Models\ProductionWeightEvent;
use App\Models\ProductionOrder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use Illuminate\Http\Client\ConnectionException;

class ProductionMonitorController extends Controller
{
    /**
     * GAS Web App URL for the weight-monitoring spreadsheet (Settings + machine sheets).
     * Override via GAS_PRODUCTION_URL in .env.
     */
    private string $gasUrl;

    /**
     * GAS Web App URL for the production-plan spreadsheet (แผนการผลิต / Monthly / Daily).
     * Override via GAS_PLAN_URL in .env.
     */
    private string $gasPlanUrl;

    public function __construct()
    {
        $this->gasUrl = env(
            'GAS_PRODUCTION_URL',
            'https://script.google.com/macros/s/AKfycbzg1FRP4zDvgJpIQmgLAGBPM9EpUbjndLmEOWD52WlL6U-ixhm4GZu9kESCZDWJn05o/exec'
        );

        // Separate deployment pointing at the แผนการผลิต spreadsheet.
        // Set GAS_PLAN_URL in .env once you deploy the plan script.
        $this->gasPlanUrl = env('GAS_PLAN_URL', '');
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Public endpoints
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * GET /api/production-monitor/get-settings
     *
     * Proxies to GAS doGet?action=getSettings.
     * GAS issues a 302 → script.googleusercontent.com; we follow it explicitly.
     */
    public function getSettings(): JsonResponse
    {
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
                ->timeout(30)
                ->get($this->gasUrl, ['action' => 'getSettings']);

            if ($response->failed()) {
                Log::error('[ProductionMonitor] getSettings: GAS returned HTTP ' . $response->status(), [
                    'body' => $response->body(),
                ]);

                return response()->json([
                    'success' => false,
                    'message' => 'GAS returned HTTP ' . $response->status(),
                    'debug'   => $response->body(),
                ], 502);
            }

            $data = $response->json();

            if ($data === null) {
                $preview = substr($response->body(), 0, 1000);

                Log::warning('[ProductionMonitor] getSettings: GAS returned non-JSON', [
                    'content_type' => $response->header('Content-Type'),
                    'body_preview' => $preview,
                ]);

                return response()->json([
                    'success' => false,
                    'message' => 'GAS script has no doGet() function, or is returning an error page instead of JSON. '
                               . 'Visit /api/production-monitor/debug to inspect the raw GAS response.',
                    'raw'     => $preview,
                ], 502);
            }

            return response()->json($data);

        } catch (ConnectionException $e) {
            Log::error('[ProductionMonitor] getSettings: Connection failed', ['error' => $e->getMessage()]);

            return response()->json([
                'success' => false,
                'message' => 'Could not connect to GAS: ' . $e->getMessage(),
            ], 502);

        } catch (\Exception $e) {
            Log::error('[ProductionMonitor] getSettings: Unexpected error', ['error' => $e->getMessage()]);

            return response()->json([
                'success' => false,
                'message' => 'Proxy error: ' . $e->getMessage(),
            ], 500);
        }
    }

    /**
     * POST /api/production-monitor/create-order
     *
     * Body: { machineId, sheetName, orderId, productCode?, productName, targetQty, shift?, employeeId? }
     */
    public function createOrder(Request $request): JsonResponse
    {
        $request->validate([
            'machineId'   => 'required|string',
            'sheetName'   => 'required|string',
            'orderId'     => 'required|string',
            'productName' => 'required|string',
            'targetQty'   => 'required|integer|min:1',
            'productCode' => 'nullable|string',
            'shift'       => 'nullable|string',
            'employeeId'  => 'nullable|string',
        ]);

        return $this->forwardPost('createOrder', $request->only([
            'machineId', 'sheetName', 'orderId', 'productCode',
            'productName', 'targetQty', 'shift', 'employeeId',
        ]));
    }

    /**
     * POST /api/production-monitor/log-weight-event
     *
     * ส่งรายการน้ำหนักแต่ละครั้ง (กดปุ่มตาชั่ง) ลง GAS Sheet ของเครื่องนั้น
     * เรียกจาก Web หลัง poll รับ events จาก scale-weight (fire-and-forget)
     *
     * Body: { machineId, sheetName, orderId, seq, type, weight, pressedAt }
     */
    public function logWeightEvent(Request $request): JsonResponse
    {
        $request->validate([
            'machineId' => 'required|string',
            'sheetName' => 'required|string',
            'orderId'   => 'required|string',
            'type'      => 'required|in:good,ng',
            'weight'    => 'required|numeric|min:0',
            'seq'       => 'nullable|integer|min:0',
            'pressedAt' => 'nullable|string',
        ]);

        return $this->forwardPost('logWeightEvent', $request->only([
            'machineId', 'sheetName', 'orderId', 'seq', 'type', 'weight', 'pressedAt',
        ]));
    }

    /**
     * POST /api/production-monitor/update-weight
     *
     * Body: { machineId, sheetName, orderId, weight, pipeCounter }
     */
    public function updateWeight(Request $request): JsonResponse
    {
        $request->validate([
            'machineId' => 'required|string',
            'sheetName' => 'required|string',
            'orderId'   => 'required|string',
            'type'      => 'required|in:good,ng',
            'weight'    => 'required|numeric|min:0',
        ]);

        return $this->forwardPost('updateWeight', $request->all());
    }

    /**
     * POST /api/production-monitor/close-order
     *
     * Body: { machineId, sheetName, orderId }
     */
    public function closeOrder(Request $request): JsonResponse
    {
        $request->validate([
            'machineId'        => 'required|string',
            'sheetName'        => 'required|string',
            'orderId'          => 'required|string',
            'goodCount'        => 'required|integer|min:0',
            'totalGoodWeight'  => 'required|numeric|min:0',
            'ngCount'          => 'required|integer|min:0',
            'totalNgWeight'    => 'required|numeric|min:0',
        ]);

        return $this->forwardPost('closeOrder', $request->all());
    }

    /**
     * GET /api/production-monitor/history?sheetName=Machine_01
     *
     * Fetches production records from GAS.
     * If sheetName is omitted, GAS returns records from all machine sheets.
     */
    public function getHistory(Request $request): JsonResponse
    {
        $params = ['action' => 'getHistory'];
        if ($request->filled('sheetName')) {
            $params['sheetName'] = $request->input('sheetName');
        }

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
                ->timeout(30)
                ->get($this->gasUrl, $params);

            if ($response->failed()) {
                return response()->json([
                    'success' => false,
                    'message' => 'GAS returned HTTP ' . $response->status(),
                ], 502);
            }

            $data = $response->json();
            if ($data === null) {
                return response()->json([
                    'success' => false,
                    'message' => 'GAS returned non-JSON. Make sure doGet() handles action=getHistory.',
                    'raw'     => substr($response->body(), 0, 500),
                ], 502);
            }

            return response()->json($data);

        } catch (ConnectionException $e) {
            return response()->json(['success' => false, 'message' => 'Connection failed: ' . $e->getMessage()], 502);
        } catch (\Exception $e) {
            return response()->json(['success' => false, 'message' => 'Proxy error: ' . $e->getMessage()], 500);
        }
    }

    /**
     * GET /api/production-monitor/order-detail?sheetName=Machine_01&orderId=123
     *
     * Returns per-order weight events (between Started → Completed) from GAS.
     * Used by the History UI popup ("ดูข้อมูล").
     */
    public function getOrderDetail(Request $request): JsonResponse
    {
        $request->validate([
            'sheetName' => 'required|string',
            'orderId'   => 'required|string',
            'startedAt' => 'nullable|string',
        ]);

        $params = [
            'action'    => 'getOrderDetail',
            'sheetName' => $request->input('sheetName'),
            'orderId'   => $request->input('orderId'),
        ];
        if ($request->filled('startedAt')) {
            $params['startedAt'] = $request->input('startedAt');
        }

        $data = $this->fetchFromGas($params, $this->gasUrl);

        if (isset($data['_error'])) {
            return response()->json([
                'success' => false,
                'message' => $data['_error'],
                'debug'   => $data['_debug'] ?? null,
            ], $data['_status'] ?? 502);
        }

        return response()->json($data);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Private helpers
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * Forward a POST payload to the GAS web app.
     *
     * Why asJson():
     *   Our GAS doPost(e) reads the body with JSON.parse(e.postData.contents),
     *   so the request must carry Content-Type: application/json and a JSON body.
     *   Using asForm() (URL-encoded) would make JSON.parse throw a SyntaxError.
     *
     * Why allow_redirects strict => false:
     *   GAS returns a 302 after doPost() runs. Guzzle converts POST → GET on
     *   the redirect (standard RFC 2616 behaviour). The redirect target just
     *   serves the pre-computed response body, so the method change is fine.
     *
     * @param string $action  GAS action name (e.g. 'createOrder')
     * @param array  $data    Validated request fields
     */
    /**
     * GET /api/production-monitor/debug
     *
     * Diagnostic endpoint — returns the raw GAS response without any
     * processing so you can see exactly what the script is returning.
     * Open this URL directly in your browser while troubleshooting.
     *
     * Remove or protect this endpoint before deploying to production.
     */
    public function debug(): JsonResponse
    {
        // Bug 6 fix: เปิด endpoint นี้เฉพาะ local / dev เท่านั้น
        if (app()->isProduction()) {
            abort(404);
        }

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
                ->timeout(30)
                ->get($this->gasUrl, ['action' => 'getSettings']);

            return response()->json([
                'gas_url'           => $this->gasUrl,
                'http_status'       => $response->status(),
                'content_type'      => $response->header('Content-Type'),
                'redirect_followed' => $response->effectiveUri() ?? null,
                'body_length'       => strlen($response->body()),
                'body_preview'      => substr($response->body(), 0, 3000),
                'json_parsed'       => $response->json(),
                'hint'              => $response->json() === null
                    ? 'GAS returned non-JSON. Your Apps Script must implement doGet(e) and return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON).'
                    : 'JSON parsed successfully — data looks good.',
            ]);

        } catch (\Exception $e) {
            return response()->json([
                'gas_url' => $this->gasUrl,
                'error'   => $e->getMessage(),
            ], 500);
        }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // LED sign proxy
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * POST /api/production-monitor/led
     *
     * Proxies a JSON command to the ESP32 LED sign on the local network.
     * Routing through Laravel avoids browser CORS / Private-Network-Access
     * restrictions that prevent JavaScript from reaching LAN IP addresses.
     *
     * Body: { ledIp: "192.168.1.101", text: "...", r: 0, g: 255, b: 255, fontSize: 1 }
     */
    public function sendLedCommand(Request $request): JsonResponse
    {
        $request->validate([
            'ledIp' => 'required|string',
        ]);

        $ledIp   = trim($request->input('ledIp'));
        $payload = $request->only(['text', 'r', 'g', 'b', 'fontSize', 'speed']);

        try {
            $response = Http::withOptions(['connect_timeout' => 3])
                ->timeout(5)
                ->asJson()                          // ← ส่ง Content-Type: application/json
                ->post("http://{$ledIp}/led", $payload);

            if ($response->failed()) {
                return response()->json([
                    'success' => false,
                    'message' => "ESP32 ตอบกลับ HTTP {$response->status()}: " . substr($response->body(), 0, 300),
                ], 502);
            }

            return response()->json([
                'success' => true,
                'data'    => $response->json() ?? ['ok' => true],
            ]);

        } catch (ConnectionException $e) {
            Log::warning('[LED] sendLedCommand: cannot reach ESP32', [
                'ledIp' => $ledIp,
                'error' => $e->getMessage(),
            ]);
            return response()->json([
                'success' => false,
                'message' => "เชื่อมต่อ {$ledIp} ไม่ได้: " . $e->getMessage(),
            ], 503);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Proxy error: ' . $e->getMessage(),
            ], 500);
        }
    }

    /**
     * GET /api/production-monitor/led-ping?ledIp=192.168.1.108
     *
     * ทดสอบว่า Laravel server เชื่อมต่อ ESP32 ได้ไหม
     * ใช้ GET /status ซึ่งเบากว่า POST /led
     */
    public function pingLed(Request $request): JsonResponse
    {
        $ledIp = trim($request->input('ledIp', ''));
        if (!$ledIp) {
            return response()->json(['success' => false, 'message' => 'ledIp is required'], 422);
        }

        try {
            $response = Http::withOptions(['connect_timeout' => 3])
                ->timeout(4)
                ->get("http://{$ledIp}/status");

            return response()->json([
                'success'     => $response->ok(),
                'http_status' => $response->status(),
                'body'        => $response->json() ?? $response->body(),
            ], $response->ok() ? 200 : 502);

        } catch (ConnectionException $e) {
            return response()->json([
                'success' => false,
                'message' => "เชื่อมต่อไม่ได้: " . $e->getMessage(),
            ], 503);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => $e->getMessage(),
            ], 500);
        }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // LED command queue  (polling architecture)
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * POST /api/production-monitor/led-command/{machineId}
     *
     * Web UI เก็บคำสั่งไว้ใน Laravel Cache (TTL 5 นาที)
     * Body: { text, r, g, b, fontSize, speed }
     *
     * ไม่ต้องรู้ IP ของ ESP32 เลย — ESP32 เป็นฝ่าย poll มาดึงเอง
     */
    public function storeLedCommand(Request $request, string $machineId): JsonResponse
    {
        $payload = $request->only(['text', 'r', 'g', 'b', 'fontSize', 'speed', 'actual', 'target']);

        // Pending command — ESP32 ดึงแล้วลบทิ้ง (TTL 5 นาที)
        Cache::put("led_cmd_{$machineId}", $payload, now()->addMinutes(5));

        // Persistent state — ใช้แสดงใน UI ว่าป้ายไฟกำลังแสดงอะไร (TTL 30 วัน)
        $ledState = array_merge($payload, ['updatedAt' => now()->toISOString()]);
        Cache::put("led_state_{$machineId}", $ledState, now()->addDays(30));

        // Broadcast ให้ทุก browser รับ LED state ทันที
        $this->publishEvent('led_state', [
            'machineId' => $machineId,
            'state'     => $ledState,
        ]);

        return response()->json(['success' => true, 'queued' => true, 'machineId' => $machineId]);
    }

    /**
     * GET /api/production-monitor/led-status/{machineId}
     *
     * ดึงสถานะล่าสุดของป้ายไฟ (last command sent from UI)
     * ใช้แสดงใน Modal ว่าตอนนี้ป้ายไฟกำลังแสดงอะไรอยู่
     */
    public function getLedStatus(string $machineId): JsonResponse
    {
        $state = Cache::get("led_state_{$machineId}");

        return response()->json([
            'success'   => true,
            'machineId' => $machineId,
            'hasState'  => $state !== null,
            'state'     => $state,
        ]);
    }

    /**
     * GET /api/production-monitor/led-command/{machineId}
     *
     * ESP32 ดึงคำสั่งล่าสุด (polling ทุก ~2 วินาที)
     * ใช้ Cache::pull() → อ่านแล้วลบออกเลย (ส่งได้ครั้งเดียว)
     * Response: { pending: true, text, r, g, b, fontSize } หรือ { pending: false }
     *
     * บันทึก heartbeat ทุกครั้งที่ ESP32 poll — ใช้แทน direct-ping เพื่อแสดงสถานะ WiFi บน UI
     */
    public function fetchLedCommand(Request $request, string $machineId): JsonResponse
    {
        // Heartbeat: บันทึกเวลา + IP จริงของ ESP32 (TTL 30 วินาที — หาย = offline)
        // $request->ip() คือ IP ของ ESP32 บน LAN ที่ยิง request มา (ใช้ DHCP แล้วก็รู้ IP จริง)
        Cache::put("led_heartbeat_{$machineId}", [
            'time' => now()->toISOString(),
            'ip'   => $request->ip(),
        ], now()->addSeconds(30));

        $command = Cache::pull("led_cmd_{$machineId}");

        if ($command) {
            return response()->json(array_merge(['pending' => true], $command));
        }

        return response()->json(['pending' => false]);
    }

    /**
     * GET /api/production-monitor/led-heartbeat/{machineId}
     *
     * เว็บเช็คสถานะ WiFi ของป้ายไฟโดยดูจาก heartbeat ล่าสุด
     * ESP32 poll /led-command ทุก 2s → บันทึก timestamp อัตโนมัติ
     * ถ้า ESP32 ไม่ได้ poll ภายใน 15 วินาที = offline
     *
     * วิธีนี้ไม่ต้องให้ PC ping IP ของ ESP32 โดยตรง
     * → ใช้ได้ทุก network (แม้ PC กับ ESP32 อยู่คนละ subnet)
     */
    public function getLedHeartbeat(string $machineId): JsonResponse
    {
        $raw        = Cache::get("led_heartbeat_{$machineId}");
        $online     = false;
        $secondsAgo = null;
        $deviceIp   = null;
        $lastSeenAt = null;

        if ($raw !== null) {
            // รองรับ 2 format: เก่า = string ISO, ใหม่ = array { time, ip }
            if (is_array($raw)) {
                $lastSeenAt = $raw['time'] ?? null;
                $deviceIp   = $raw['ip']   ?? null;
            } else {
                $lastSeenAt = $raw; // format เก่า (string)
            }

            if ($lastSeenAt) {
                try {
                    $dt         = \Carbon\Carbon::parse($lastSeenAt);
                    $secondsAgo = (int) $dt->diffInSeconds(now());
                    $online     = $secondsAgo <= 15; // online ถ้า poll ล่าสุดไม่เกิน 15 วินาที
                } catch (\Throwable $e) {
                    // parse ไม่ได้ → offline
                }
            }
        }

        return response()->json([
            'success'    => true,
            'machineId'  => $machineId,
            'online'     => $online,
            'lastSeenAt' => $lastSeenAt,
            'secondsAgo' => $secondsAgo,
            'deviceIp'   => $deviceIp, // IP จริงของ ESP32 (DHCP) — null ถ้ายังไม่เคย poll
        ]);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Plan data endpoints (แผนการผลิต / Monthly / Daily)
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * GET /api/production-monitor/plan?machine=EM+08&status=Inprocess
     *
     * Returns rows from the "แผนการผลิต" sheet.
     * Cached for 5 minutes per unique param combination.
     */
    public function getProductionPlan(Request $request): JsonResponse
    {
        if (empty($this->gasPlanUrl)) {
            return response()->json([
                'success' => false,
                'message' => 'GAS_PLAN_URL is not configured. Please set it in .env and re-deploy the plan GAS script.',
            ], 503);
        }
        $params = ['action' => 'getProductionPlan'];
        if ($request->filled('machine')) $params['machine'] = $request->input('machine');
        if ($request->filled('status'))  $params['status']  = $request->input('status');
        return $this->gasGetCached($params, $this->gasPlanUrl);
    }

    /**
     * GET /api/production-monitor/monthly-plan?machine=EM+08&jobNo=6901001
     *
     * Returns rows from the "Monthly" sheet.
     * Cached for 5 minutes per unique param combination.
     */
    public function getMonthlyPlan(Request $request): JsonResponse
    {
        if (empty($this->gasPlanUrl)) {
            return response()->json([
                'success' => false,
                'message' => 'GAS_PLAN_URL is not configured.',
            ], 503);
        }
        $params = ['action' => 'getMonthlyPlan'];
        if ($request->filled('machine')) $params['machine'] = $request->input('machine');
        if ($request->filled('jobNo'))   $params['jobNo']   = $request->input('jobNo');
        return $this->gasGetCached($params, $this->gasPlanUrl);
    }

    /**
     * GET /api/production-monitor/product-lookup
     *
     * Returns a { productCode: productName } map read from Chaiyo Data Center sheet
     * via the GAS plan script. Cached for 30 minutes (data changes rarely).
     */
    public function getProductLookup(): JsonResponse
    {
        if (empty($this->gasPlanUrl)) {
            return response()->json([
                'success' => false,
                'message' => 'GAS_PLAN_URL is not configured.',
            ], 503);
        }
        $params = ['action' => 'getProductLookup'];
        return $this->gasGetCached($params, $this->gasPlanUrl, 1800);
    }

    /**
     * GET /api/production-monitor/product-details
     *
     * Returns a { productCode: { name, peType, size, length, pn, brand,
     *                            colorStripe, stdWeight, minWeight, maxWeight } }
     * map read from the "Product" sheet via the GAS plan script.
     * Cached for 30 minutes (product list changes rarely).
     */
    public function getProductDetails(): JsonResponse
    {
        if (empty($this->gasPlanUrl)) {
            return response()->json([
                'success' => false,
                'message' => 'GAS_PLAN_URL is not configured.',
            ], 503);
        }
        $params = ['action' => 'getProductDetails'];
        return $this->gasGetCached($params, $this->gasPlanUrl, 1800);
    }

    /**
     * GET /api/production-monitor/daily-plan?machine=EM+08&jobNo=6901001
     *
     * Returns rows from the "Daily" sheet.
     * Cached for 15 minutes (no jobNo) or 5 minutes (specific jobNo).
     */
    public function getDailyPlan(Request $request): JsonResponse
    {
        if (empty($this->gasPlanUrl)) {
            return response()->json([
                'success' => false,
                'message' => 'GAS_PLAN_URL is not configured.',
            ], 503);
        }
        $params = ['action' => 'getDailyPlan'];
        if ($request->filled('machine'))    $params['machine']    = $request->input('machine');
        if ($request->filled('jobNo'))      $params['jobNo']      = $request->input('jobNo');
        if ($request->filled('sinceDate'))  $params['sinceDate']  = $request->input('sinceDate');
        // ข้อมูลรายวันไม่ค่อยเปลี่ยน — cache นานขึ้นเพื่อลดการเรียก GAS
        $ttl = $request->filled('jobNo') ? 300 : 900;
        return $this->gasGetCached($params, $this->gasPlanUrl, $ttl);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Scale command queue  (Web → Scale ESP32 → Web)
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * POST /api/production-monitor/scale-command/{machineId}
     *
     * Web ส่งข้อมูลงานให้ Scale ESP32 รับ (เก็บใน Cache, TTL 10 นาที)
     * Body: { orderId, productCode, targetQty, sheetName }
     */
    public function storeScaleCommand(Request $request, string $machineId): JsonResponse
    {
        $payload = $request->only([
            'orderId', 'productCode', 'targetQty', 'sheetName',
            'stdWeight', 'minWeight', 'maxWeight', 'productLen',
        ]);

        Cache::put("scale_cmd_{$machineId}", $payload, now()->addMinutes(10));
        // รีเซ็ตนับของดีของเซสชั่นก่อนหน้า
        Cache::put("scale_count_{$machineId}", 0, now()->addHours(24));
        Cache::forget("scale_events_{$machineId}");

        return response()->json(['success' => true, 'queued' => true]);
    }

    /**
     * GET /api/production-monitor/scale-command/{machineId}
     *
     * Scale ESP32 ดึงงาน (pull-once: อ่านแล้วลบ)
     * Response: { pending: true, orderId, productCode, targetQty, sheetName }
     *        หรือ { pending: false }
     */
    public function fetchScaleCommand(string $machineId): JsonResponse
    {
        $cmd = Cache::pull("scale_cmd_{$machineId}");

        if ($cmd) {
            return response()->json(array_merge(['pending' => true], $cmd));
        }

        return response()->json(['pending' => false]);
    }

    /**
     * POST /api/production-monitor/scale-confirm/{machineId}
     *
     * Scale ESP32 ส่งยืนยัน (กะ + รหัสพนักงาน) หลังกด D
     * Body: { shift, employeeId }
     */
    public function storeScaleConfirm(Request $request, string $machineId): JsonResponse
    {
        $payload = $request->only(['shift', 'employeeId']);
        Cache::put("scale_confirm_{$machineId}", $payload, now()->addMinutes(5));

        return response()->json(['success' => true]);
    }

    /**
     * POST /api/production-monitor/session-confirm/{machineId}
     *
     * NEW: Called by Scale ESP32 when operator confirms (shift + employee id).
     * Stores confirmation in cache and broadcasts SSE `session_confirmed` to all browsers.
     *
     * Body: { shift, employee_id, confirmed_at }
     * (firmware may also send employeeId for legacy compatibility)
     */
    public function sessionConfirm(Request $request, string $machineId): JsonResponse
    {
        $shift = (string) $request->input('shift', '');
        $employeeId = (string) ($request->input('employee_id') ?? $request->input('employeeId') ?? '');
        $confirmedAt = $request->input('confirmed_at');

        if ($shift === '' || $employeeId === '') {
            return response()->json([
                'success' => false,
                'message' => 'Missing required fields: shift, employee_id',
            ], 422);
        }

        $data = [
            'machineId'     => $machineId,
            'shift'         => $shift,
            'employee_id'   => $employeeId,
            'confirmed_at'  => is_numeric($confirmedAt) ? (int) $confirmedAt : null,
        ];

        Cache::put("session_confirm_{$machineId}", $data, now()->addHours(12));

        // Keep legacy polling flow working (SetupMode polls /scale-confirm).
        Cache::put("scale_confirm_{$machineId}", [
            'shift'      => $shift,
            'employeeId' => $employeeId,
        ], now()->addMinutes(5));

        // DB write: update active session with shift/employeeId from scale
        try {
            ProductionSession::where('machine_id', $machineId)
                ->whereNotIn('status', ['finished', 'cancelled'])
                ->update([
                    'shift'       => $shift,
                    'employee_id' => $employeeId,
                    'ts'          => (int) (now()->timestamp * 1000),
                ]);
        } catch (\Throwable $e) {
            Log::warning("sessionConfirm DB update failed for {$machineId}: " . $e->getMessage());
        }

        // Defensive: mark scale-live as live=true immediately so the ESP32 does NOT
        // reset back to IDLE if the web browser crashes before its useEffect fires
        // storeScaleLive(). We merge over the existing payload to preserve orderId,
        // targetQty, stdWeight etc. that were already stored by the web on Start Now.
        $existingLive = Cache::get("scale_live_{$machineId}") ?? [];
        Cache::put("scale_live_{$machineId}", array_merge($existingLive, [
            'live'        => true,
            'shift'       => $shift,
            'employee_id' => $employeeId,
        ]), now()->addDays(1));

        $this->publishEvent('session_confirmed', $data);

        return response()->json(['success' => true]);
    }

    /**
     * GET /api/production-monitor/scale-confirm/{machineId}
     *
     * Web หน้าเว็บ poll รอการยืนยันจาก Scale ESP32 (pull-once)
     * Response: { pending: true, shift, employeeId }
     *        หรือ { pending: false }
     */
    public function fetchScaleConfirm(string $machineId): JsonResponse
    {
        $confirm = Cache::pull("scale_confirm_{$machineId}");

        if ($confirm) {
            return response()->json(array_merge(['pending' => true], $confirm));
        }

        return response()->json(['pending' => false]);
    }

    /**
     * POST /api/production-monitor/scale-live/{machineId}
     *
     * Web ซิงค์สถานะ Live ของเครื่องพร้อม session ข้อมูลงานปัจจุบัน
     * ตาชั่ง ESP32 ดึงข้อมูลนี้เพื่อ restore หลัง reboot / WiFi หลุด
     *
     * Body (live=true):  { live:true, orderId, productCode, productName, targetQty,
     *                      pipeCounter, shift, employeeId, sheetName }
     * Body (live=false): { live:false }
     */
    public function storeScaleLive(Request $request, string $machineId): JsonResponse
    {
        $live = $request->boolean('live');

        if ($live) {
            $session = array_merge(
                ['live' => true],
                $request->only([
                    'orderId', 'productCode', 'productName',
                    'targetQty', 'pipeCounter',
                    'shift', 'employeeId', 'sheetName',
                    'stdWeight', 'minWeight', 'maxWeight', 'productLen',
                ])
            );
            Cache::put("scale_live_{$machineId}", $session, now()->addDays(7));
        } else {
            Cache::put("scale_live_{$machineId}", ['live' => false], now()->addDays(7));
        }

        return response()->json(['success' => true]);
    }

    /**
     * GET /api/production-monitor/scale-live/{machineId}
     *
     * Scale ESP32 poll ว่าเว็บยังถือว่าผลิตอยู่ไหม + ดึง session ข้อมูลงาน
     *
     * Bug 3 fix: ถ้า scale_live cache miss → fallback ไป machine_session cache
     * เพื่อป้องกัน scale ล้าง NVS เมื่อ cache หมดอายุหรือ server restart
     *
     * Response (live):    { live:true, orderId, ..., pipeCounter, ... }
     * Response (stopped): { live:false }
     * Response (unknown): { live:null }  ← ไม่มีข้อมูลพอ อย่าเพิ่งลบ NVS
     */
    public function fetchScaleLive(string $machineId): JsonResponse
    {
        $key = "scale_live_{$machineId}";

        if (Cache::has($key)) {
            $data = Cache::get($key);
            // รองรับ cache รูปแบบเก่า (เก็บ bool ตรงๆ)
            if (is_bool($data)) {
                return response()->json(['live' => $data]);
            }
            return response()->json($data);
        }

        // Bug 3 fix: scale_live หาย → fallback ไป machine_session
        // machine_session มี TTL 7 วัน (นานกว่า scale_live เดิมที่ 72h)
        $sessionKey = "machine_session_{$machineId}";
        if (Cache::has($sessionKey)) {
            $session = Cache::get($sessionKey);
            if (is_array($session) && ($session['mode'] ?? '') === 'live') {
                // Reconstruct scale-live payload จาก machine_session
                $restored = [
                    'live'        => true,
                    'orderId'     => $session['orderId']     ?? '',
                    'productCode' => $session['productCode'] ?? '',
                    'productName' => $session['productName'] ?? '',
                    'targetQty'   => $session['targetQty']   ?? 0,
                    'pipeCounter' => $session['pipeCounter'] ?? 0,
                    'shift'       => $session['shift']       ?? '',
                    'employeeId'  => $session['employeeId']  ?? '',
                    'sheetName'   => $session['sheetName']   ?? '',
                ];
                // เขียนกลับ scale_live เพื่อให้ poll ครั้งต่อไปเร็วขึ้น
                Cache::put($key, $restored, now()->addDays(7));
                return response()->json($restored);
            }
            // session มีอยู่แต่ mode != live → หยุดผลิตแล้ว
            if (is_array($session) && isset($session['mode'])) {
                return response()->json(['live' => false]);
            }
        }

        // ไม่มีข้อมูลเลย → return null แทน false เพื่อกัน scale ล้าง NVS โดยไม่จำเป็น
        // (scale firmware ควร treat live:null ว่า "ยังไม่รู้ อย่าเพิ่งทำอะไร")
        return response()->json(['live' => null]);
    }

    /**
     * POST /api/production-monitor/scale-weight/{machineId}
     *
     * Scale ESP32 ส่งน้ำหนัก+ประเภท ทุกครั้งที่กดปุ่ม
     * Body: { orderId, sheetName, type, weight, employeeId, shift, actualCount }
     *
     * ถ้า type=good: อัปเดต led_cmd_{machineId} ด้วย actual count ใหม่
     * เพื่อให้ป้ายไฟอัปเดตอัตโนมัติโดยไม่ต้องรอ web page
     */
    public function storeScaleWeight(Request $request, string $machineId): JsonResponse
    {
        $payload = $request->only(['orderId','sheetName','type','weight','employeeId','shift','actualCount','pressedAt']);

        // เวลากดปุ่มที่ตาชั่ง (ส่งมาจาก ESP32 พร้อม NTP timestamp)
        // ถ้า ESP32 ยังไม่มี NTP (เพิ่ง boot) จะเป็น "millis:xxxxx" → fallback เป็นเวลา server
        $rawPressedAt = $payload['pressedAt'] ?? null;
        if ($rawPressedAt && !str_starts_with((string)$rawPressedAt, 'millis:')) {
            $payload['pressedAt'] = $rawPressedAt;
        } else {
            $payload['pressedAt'] = now()->toISOString();
        }
        // เก็บเวลา server ด้วยเสมอ (ใช้ debug / ตรวจ latency)
        $payload['receivedAt'] = now()->toISOString();

        // DB write: insert weight event + update session counters atomically
        try {
            DB::transaction(function () use ($machineId, $payload) {
                $type   = $payload['type']   ?? 'good';
                $weight = (float) ($payload['weight'] ?? 0);
                $orderId    = $payload['orderId']    ?? '';
                $sheetName  = $payload['sheetName']  ?? '';
                $employeeId = $payload['employeeId'] ?? '';
                $shift      = $payload['shift']      ?? '';

                // Determine seq within this order
                $seq = (int) ProductionWeightEvent::where('machine_id', $machineId)
                    ->where('order_id', $orderId)
                    ->max('seq') + 1;

                $weightEvent = ProductionWeightEvent::create([
                    'machine_id'  => $machineId,
                    'order_id'    => $orderId,
                    'sheet_name'  => $sheetName,
                    'type'        => $type,
                    'weight'      => $weight,
                    'seq'         => $seq,
                    'employee_id' => $employeeId,
                    'shift'       => $shift,
                    'pressed_at'  => $payload['pressedAt'],
                    'received_at' => $payload['receivedAt'],
                    'raw_payload' => $payload,
                    'gas_sync_status' => 'pending',
                ]);

                // Async dual-write to Google Sheet
                SyncWeightEventToGas::dispatch($weightEvent->id, $this->gasUrl)
                    ->onQueue('gas-sync');

                // Update session counters
                $session = ProductionSession::where('machine_id', $machineId)
                    ->whereNotIn('status', ['finished', 'cancelled'])
                    ->first();

                if ($session) {
                    if ($type === 'good') {
                        $session->increment('pipe_counter');
                        $session->increment('total_good_weight', $weight);
                    } else {
                        $session->increment('ng_count');
                        $session->increment('total_ng_weight', $weight);
                    }
                }
            });
        } catch (\Throwable $e) {
            Log::warning("storeScaleWeight DB write failed for {$machineId}: " . $e->getMessage());
        }

        // เก็บ event ต่อท้าย list — ใช้ Cache::get (ไม่ใช่ pull) เพื่อให้ทุก browser รับได้
        // events จะหมดอายุเองใน 2 ชั่วโมง หรือถูก reset เมื่อ scale-command ใหม่มา
        $events   = Cache::get("scale_events_{$machineId}", []);
        $events[] = $payload;
        // Ring buffer: เก็บสูงสุด 500 events (~1 วันของการผลิต)
        if (count($events) > 500) {
            $events = array_slice($events, -500);
        }
        Cache::put("scale_events_{$machineId}", $events, now()->addHours(2));

        // Broadcast ทันที → browsers รับ scale_weight event โดยไม่ต้องรอ poll รอบถัดไป
        $this->publishEvent('scale_weight', [
            'machineId' => $machineId,
            'event'     => $payload,
        ]);

        // ถ้าของดี → push actualCount ลง led_cmd เพื่อให้ป้ายไฟรับอัตโนมัติ
        if (($payload['type'] ?? '') === 'good') {
            $actualCount = intval($payload['actualCount'] ?? 0);
            Cache::put("scale_count_{$machineId}", $actualCount, now()->addHours(24));

            $ledState = Cache::get("led_state_{$machineId}");

            // Bug 5 fix: ถ้า led_state ไม่มี (ยังไม่เคย set จากหน้าเว็บ)
            // ให้สร้าง default จาก machine_session หรือ scale_live session
            // เพื่อให้ LED อัปเดต actualCount ได้แม้ไม่เคยผ่าน /led-cmd
            if (!$ledState) {
                $session = Cache::get("machine_session_{$machineId}")
                        ?? Cache::get("scale_live_{$machineId}");
                if (is_array($session) && ($session['live'] ?? $session['mode'] ?? '') !== false) {
                    $orderId     = $session['orderId']     ?? '';
                    $productCode = $session['productCode'] ?? '';
                    $productName = $session['productName'] ?? '';
                    $targetQty   = $session['targetQty']   ?? 0;
                    $displayText = $productCode
                        ? "{$productCode} {$productName}"
                        : "Order: {$orderId}";
                    $ledState = [
                        'text'      => $displayText,
                        'r'         => 0,
                        'g'         => 255,
                        'b'         => 255,
                        'fontSize'  => 1,
                        'speed'     => 50,
                        'actual'    => (string) $actualCount,
                        'target'    => (string) $targetQty,
                    ];
                    Cache::put("led_state_{$machineId}", $ledState, now()->addDays(30));
                }
            }

            if ($ledState) {
                $ledState['actual'] = (string) $actualCount;
                $ledState['updatedAt'] = now()->toISOString();
                // Push pending led_cmd (ESP32 ป้ายไฟ poll ทุก 2s)
                Cache::put("led_cmd_{$machineId}", $ledState, now()->addMinutes(5));
                // Persist state so /led-status reflects latest actual (used by ESP32 reconcile)
                Cache::put("led_state_{$machineId}", $ledState, now()->addDays(30));
            }
        }

        return response()->json([
            'success'     => true,
            'actualCount' => Cache::get("scale_count_{$machineId}", 0),
        ]);
    }

    /**
     * GET /api/production-monitor/scale-weight/{machineId}
     *
     * Web poll รับ weight events สะสม (READ-ONLY — ไม่ลบ)
     * ใช้ since={timestamp} เพื่อรับเฉพาะ events ใหม่ (ป้องกัน process ซ้ำ)
     *
     * Response: { events: [...], latestTs: string|null }
     *
     * NOTE: เปลี่ยนจาก Cache::pull() เป็น Cache::get() เพื่อแก้ bug ที่ทำให้
     * browser tab อื่นไม่ได้รับ events (pull ลบข้อมูลทันทีที่ browser แรกอ่าน)
     */
    public function fetchScaleWeights(Request $request, string $machineId): JsonResponse
    {
        $since  = $request->input('since', null); // ISO timestamp — คืนเฉพาะ events ที่ receivedAt > since
        $events = Cache::get("scale_events_{$machineId}", []);

        if ($since) {
            $sinceTs = strtotime($since);
            if ($sinceTs !== false) {
                $events = array_values(array_filter($events, function ($ev) use ($sinceTs) {
                    $ts = strtotime($ev['receivedAt'] ?? $ev['pressedAt'] ?? '');
                    return $ts !== false && $ts > $sinceTs;
                }));
            }
        }

        $latestTs = null;
        if (!empty($events)) {
            $latestTs = end($events)['receivedAt'] ?? end($events)['pressedAt'] ?? null;
        }

        return response()->json(['events' => $events, 'latestTs' => $latestTs]);
    }

    // ──────────────────────────────────────────────────────────────────────────

    private function forwardPost(string $action, array $data): JsonResponse
    {
        // action goes in the body so GAS can read it from e.parameter.action
        $payload = array_merge($data, ['action' => $action]);

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
                ->timeout(30)
                ->asJson()          // sends as application/json — GAS reads via JSON.parse(e.postData.contents)
                ->post($this->gasUrl, $payload);

            if ($response->failed()) {
                Log::error("[ProductionMonitor] {$action}: GAS returned HTTP " . $response->status(), [
                    'payload' => $payload,
                    'body'    => $response->body(),
                ]);

                return response()->json([
                    'success' => false,
                    'message' => "GAS [{$action}] returned HTTP " . $response->status(),
                    'debug'   => $response->body(),
                ], 502);
            }

            $body = $response->json() ?? ['success' => true, 'raw' => $response->body()];

            return response()->json($body);

        } catch (ConnectionException $e) {
            Log::error("[ProductionMonitor] {$action}: Connection failed", ['error' => $e->getMessage()]);

            return response()->json([
                'success' => false,
                'message' => "Could not connect to GAS for [{$action}]: " . $e->getMessage(),
            ], 502);

        } catch (\Exception $e) {
            Log::error("[ProductionMonitor] {$action}: Unexpected error", ['error' => $e->getMessage()]);

            return response()->json([
                'success' => false,
                'message' => 'Proxy error: ' . $e->getMessage(),
            ], 500);
        }
    }

    /**
     * Shared GET proxy to GAS — no caching.
     */
    private function gasGet(array $params, string $url = ''): JsonResponse
    {
        $data = $this->fetchFromGas($params, $url ?: $this->gasUrl);
        if (isset($data['_error'])) {
            return response()->json(['success' => false, 'message' => $data['_error'], 'debug' => $data['_debug'] ?? null], $data['_status'] ?? 502);
        }
        return response()->json($data);
    }

    /**
     * GET proxy to GAS with 5-minute server-side cache.
     *
     * GAS endpoints are slow (30–90 s) and rate-limited.
     * Caching per unique param set means the second request for the same
     * machine/action is instant — no round-trip to Google.
     *
     * Cache is stored in the configured CACHE_STORE (default: database).
     * TTL: 5 minutes (300 s).
     */
    private function gasGetCached(array $params, string $url = '', int $ttl = 300): JsonResponse
    {
        $targetUrl = $url ?: $this->gasUrl;
        $cacheKey  = 'gas_plan_' . md5($targetUrl . serialize($params));

        $cached = Cache::get($cacheKey);
        if ($cached !== null) {
            return response()->json($cached)->header('X-Cache', 'HIT');
        }

        $data = $this->fetchFromGas($params, $targetUrl);
        if (isset($data['_error'])) {
            return response()->json(['success' => false, 'message' => $data['_error'], 'debug' => $data['_debug'] ?? null], $data['_status'] ?? 502);
        }

        Cache::put($cacheKey, $data, $ttl);
        return response()->json($data)->header('X-Cache', 'MISS');
    }

    /**
     * POST /api/production-monitor/update-daily-produced
     *
     * อัปเดตช่องกะ A/B/C ใน Daily sheet ของ GAS หลังกด Finished Order
     * Body: { machineId, jobNo, date, shift, produced }
     */
    public function updateDailyProduced(Request $request): JsonResponse
    {
        if (empty($this->gasPlanUrl)) {
            return response()->json(['success' => false, 'message' => 'GAS_PLAN_URL is not configured.'], 503);
        }
        $payload = [
            'action'    => 'updateDailyProduced',
            'machineId' => $request->input('machineId', ''),
            'jobNo'     => $request->input('jobNo', ''),
            'date'      => $request->input('date', ''),
            'shift'     => $request->input('shift', ''),
            'produced'  => (int) $request->input('produced', 0),
        ];
        $result = $this->fetchFromGasPost($payload, $this->gasPlanUrl);
        if (isset($result['_error'])) {
            return response()->json(['success' => false, 'message' => $result['_error']], $result['_status'] ?? 502);
        }
        return response()->json($result);
    }

    /**
     * POST /api/production-monitor/update-plan-produced
     *
     * อัปเดต Sheet "แผนการผลิต" หลังกด Finished Order:
     *   - บวกสะสม goodCount ลงคอลัมวันที่
     *   - บวกสะสม น้ำหนักของดี (col V) และ น้ำหนักของเสีย (col W)
     *   - ต่อท้าย employeeId (col X) ถ้าไม่ซ้ำ
     *
     * Body: { jobNo, date (yyyy-MM-dd), goodCount, goodWeight, ngWeight, employeeId }
     */
    public function updatePlanProduced(Request $request): JsonResponse
    {
        if (empty($this->gasPlanUrl)) {
            return response()->json(['success' => false, 'message' => 'GAS_PLAN_URL is not configured.'], 503);
        }
        $payload = [
            'action'     => 'updatePlanProduced',
            'jobNo'      => $request->input('jobNo',      ''),
            'date'       => $request->input('date',       ''),
            'goodCount'  => (int)   $request->input('goodCount',  0),
            'goodWeight' => (float) $request->input('goodWeight', 0),
            'ngWeight'   => (float) $request->input('ngWeight',   0),
            'employeeId' => $request->input('employeeId', ''),
        ];
        $result = $this->fetchFromGasPost($payload, $this->gasPlanUrl);
        if (isset($result['_error'])) {
            return response()->json(['success' => false, 'message' => $result['_error']], $result['_status'] ?? 502);
        }
        return response()->json($result);
    }

    /**
     * POST request to GAS (for write operations like updateDailyProduced).
     */
    private function fetchFromGasPost(array $payload, string $url): array
    {
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
                ->timeout(90)
                ->post($url, $payload);

            if ($response->failed()) {
                return ['_error' => 'GAS returned HTTP ' . $response->status(), '_debug' => substr($response->body(), 0, 500), '_status' => 502];
            }
            $data = $response->json();
            if ($data === null) {
                return ['_error' => 'GAS returned non-JSON', '_debug' => substr($response->body(), 0, 500), '_status' => 502];
            }
            return $data;
        } catch (ConnectionException $e) {
            return ['_error' => 'Connection failed: ' . $e->getMessage(), '_status' => 502];
        } catch (\Exception $e) {
            return ['_error' => 'Proxy error: ' . $e->getMessage(), '_status' => 500];
        }
    }

    /**
     * Makes the actual HTTP call to a GAS web app and returns decoded JSON.
     *
     * On error returns [ '_error' => '...', '_status' => int, '_debug' => '...' ].
     */
    private function fetchFromGas(array $params, string $url): array
    {
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
                ->timeout(90)
                ->get($url, $params);

            if ($response->failed()) {
                return [
                    '_error'  => 'GAS returned HTTP ' . $response->status(),
                    '_debug'  => substr($response->body(), 0, 500),
                    '_status' => 502,
                ];
            }

            $data = $response->json();
            if ($data === null) {
                return [
                    '_error'  => 'GAS returned non-JSON. Make sure doGet() handles action=' . ($params['action'] ?? '?'),
                    '_debug'  => substr($response->body(), 0, 500),
                    '_status' => 502,
                ];
            }

            return $data;

        } catch (ConnectionException $e) {
            return ['_error' => 'Connection failed: ' . $e->getMessage(), '_status' => 502];
        } catch (\Exception $e) {
            return ['_error' => 'Proxy error: ' . $e->getMessage(), '_status' => 500];
        }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Server-Sent Events (SSE) — real-time push to all browsers
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * Append an event to the SSE broadcast queue.
     *
     * ทุกครั้งที่ state เปลี่ยน (machine_session / led_state / scale_weight)
     * เรียก publishEvent() เพื่อให้ browsers ที่เชื่อม /stream รับได้ทันที
     * แทนการรอ poll รอบถัดไป (ลด latency จาก 2-5s → <300ms)
     */
    private function publishEvent(string $type, array $data): void
    {
        $id     = (int) Cache::increment('sse_counter');
        $events = Cache::get('sse_queue', []);

        $events[] = [
            'id'   => $id,
            'type' => $type,
            'data' => $data,
            'ts'   => now()->toISOString(),
        ];

        // Keep last 1000 events in the ring buffer (~5 min at 3 events/s)
        if (count($events) > 1000) {
            $events = array_slice($events, -1000);
        }

        Cache::put('sse_queue', $events, now()->addMinutes(5));
    }

    /**
     * GET /api/production-monitor/stream
     *
     * Server-Sent Events endpoint.
     * ทุก browser เชื่อมที่นี่ครั้งเดียว — รับ events แบบ push แทน poll ทุก 2s
     *
     * Events ที่ส่ง:
     *   machine_session  { machineId, state }
     *   led_state        { machineId, state }
     *   scale_weight     { machineId, event }
     *   connected        { ts }
     *
     * Client ส่ง Last-Event-ID header เพื่อรับ events ที่พลาดไป (reconnect)
     * Connection ถูกปิดหลัง 50s — client reconnects อัตโนมัติ
     *
     * การตั้งค่า server สำหรับ production:
     *   Nginx: proxy_buffering off;  proxy_read_timeout 60;
     *   PHP-FPM: pm.max_children ควรมากพอ (เพิ่ม 1 ต่อ browser tab)
     */
    public function stream(Request $request): void
    {
        // Disable all output buffering layers
        while (ob_get_level() > 0) {
            ob_end_clean();
        }

        header('Content-Type: text/event-stream; charset=utf-8');
        header('Cache-Control: no-cache, no-store, must-revalidate');
        header('Pragma: no-cache');
        header('Connection: keep-alive');
        header('X-Accel-Buffering: no');   // Nginx: disable proxy buffering
        header('X-Content-Type-Options: nosniff');

        set_time_limit(0);
        ignore_user_abort(true);

        $lastId    = max(0, (int) ($request->header('Last-Event-ID') ?? $request->input('lastId', 0)));
        $startTime = microtime(true);
        $maxSecs   = 50;          // max connection time before client reconnects
        $hbInterval = 15;         // send keep-alive comment every 15s
        $pollMs    = 300_000;     // poll cache every 300ms

        // Initial event — confirm connection and give client current event counter
        $currentId = (int) Cache::get('sse_counter', 0);
        echo "event: connected\n";
        echo "data: " . json_encode(['ts' => time(), 'latestId' => $currentId]) . "\n\n";
        flush();

        $lastHb = microtime(true);

        while (!connection_aborted()) {
            $now = microtime(true);

            if (($now - $startTime) >= $maxSecs) {
                // Graceful close — client's EventSource will reconnect with Last-Event-ID
                echo ": timeout — reconnecting\n\n";
                flush();
                break;
            }

            // Dispatch any new events
            $currentId = (int) Cache::get('sse_counter', 0);
            if ($currentId > $lastId) {
                $queue = Cache::get('sse_queue', []);
                foreach ($queue as $ev) {
                    if (($ev['id'] ?? 0) > $lastId) {
                        echo "id: {$ev['id']}\n";
                        echo "event: {$ev['type']}\n";
                        echo "data: " . json_encode($ev['data']) . "\n\n";
                        $lastId = $ev['id'];
                    }
                }
                flush();
            }

            // Keep-alive heartbeat (prevents proxy timeout)
            // Sent as a named event so the frontend EventSource listener can reset
            // its 30-second dead-connection watchdog timer.
            if (($now - $lastHb) >= $hbInterval) {
                echo "event: heartbeat\n";
                echo "data: " . json_encode(['t' => time()]) . "\n\n";
                flush();
                $lastHb = $now;
            }

            usleep($pollMs);
        }
    }

    /**
     * POST /api/production-monitor/machine-session/{machineId}
     *
     * Web browser sync สถานะเครื่องเก็บลง Cache ให้ browser อื่น poll ได้
     * ทำให้ทุกหน้าจอในโรงงานแสดงสถานะเดียวกัน
     *
     * Body: { state: { mode, orderId, productCode, productName, targetQty,
     *                  remainingQty, planDate, shift, employeeId, pipeCounter,
     *                  totalGoodWeight, ngCount, totalNgWeight, startedAt,
     *                  sheetName, ledIp, queue, pausedOrder, _ts } }
     */
    public function storeMachineSession(Request $request, string $machineId): JsonResponse
    {
        $state = $request->input('state');
        if (!is_array($state) || empty($state)) {
            return response()->json(['success' => false, 'message' => 'state required'], 400);
        }

        Cache::put("machine_session_{$machineId}", $state, now()->addDays(7));

        // Bug 3 fix: เมื่อ machine_session อัปเดต ให้ refresh scale_live ด้วยเสมอ
        // เพื่อป้องกัน scale_live หมดอายุก่อน machine_session และทำให้ตาชั่ง reset โดยไม่จำเป็น
        $mode = $state['mode'] ?? '';
        if ($mode === 'live') {
            // preserve weight fields — ถ้า frontend ส่ง 0/null ให้ใช้ค่าเดิมใน cache
            // ป้องกันกรณีที่ machine state เก่าไม่มี stdWeight แล้ว overwrite ค่าที่ตาชั่งใช้
            $existing   = Cache::get("scale_live_{$machineId}", []);
            $stdWeight  = ($state['stdWeight']  ?? 0) ?: ($existing['stdWeight']  ?? 0);
            $minWeight  = ($state['minWeight']  ?? 0) ?: ($existing['minWeight']  ?? 0);
            $maxWeight  = ($state['maxWeight']  ?? 0) ?: ($existing['maxWeight']  ?? 0);
            $productLen = ($state['length']     ?? 0) ?: ($existing['productLen'] ?? 0);
            // preserve shift/employeeId — browser ส่วนใหญ่ไม่มีค่านี้ (ถูกตั้งโดยตาชั่ง)
            // ถ้า browser ส่งมาว่างเปล่า ให้ใช้ค่าเดิมที่ตาชั่งบันทึกไว้
            $shift      = ($state['shift']      ?? '') ?: ($existing['shift']      ?? '');
            $employeeId = ($state['employeeId'] ?? '') ?: ($existing['employeeId'] ?? '');
            $scaleLive = [
                'live'        => true,
                'orderId'     => $state['orderId']     ?? '',
                'productCode' => $state['productCode'] ?? '',
                'productName' => $state['productName'] ?? '',
                'targetQty'   => $state['targetQty']   ?? 0,
                'pipeCounter' => $state['pipeCounter'] ?? 0,
                'shift'       => $shift,
                'employeeId'  => $employeeId,
                'sheetName'   => $state['sheetName']   ?? '',
                'stdWeight'   => $stdWeight,
                'minWeight'   => $minWeight,
                'maxWeight'   => $maxWeight,
                'productLen'  => $productLen,
            ];
            Cache::put("scale_live_{$machineId}", $scaleLive, now()->addDays(7));
        } elseif ($mode !== '') {
            // mode = 'setup' หรือ 'idle' → ไม่ได้ผลิต
            Cache::put("scale_live_{$machineId}", ['live' => false], now()->addDays(7));
        }

        // Track รายชื่อ machineId ที่เคย sync เพื่อ fetchAll ใช้
        $known = Cache::get('known_machine_session_ids', []);
        if (!in_array($machineId, $known)) {
            $known[] = $machineId;
            Cache::put('known_machine_session_ids', $known, now()->addDays(30));
        }

        // Broadcast ให้ทุก browser รับทันที (แทนการรอ poll 2s รอบถัดไป)
        $this->publishEvent('machine_session', [
            'machineId' => $machineId,
            'state'     => $state,
        ]);

        return response()->json(['success' => true]);
    }

    /**
     * GET /api/production-monitor/machine-sessions
     *
     * Browser ทุกเครื่อง poll ทุก 5 วินาที เพื่อรับสถานะล่าสุดของทุกเครื่อง
     * Response: { sessions: { machineId: state, ... } }
     */
    public function fetchAllMachineSessions(): JsonResponse
    {
        $known    = Cache::get('known_machine_session_ids', []);
        $sessions = [];

        foreach ($known as $mid) {
            $state = Cache::get("machine_session_{$mid}");
            if ($state !== null) {
                $sessions[$mid] = $state;
            }
        }

        return response()->json(['sessions' => $sessions]);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // STATE SNAPSHOT  — delta sync on SSE reconnect
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * GET /api/production-monitor/state-snapshot
     *
     * Full machine state for delta-sync after SSE reconnect.
     * Returns DB sessions (primary) merged over cache sessions (fallback).
     * Response: { sessions: { [machineId]: state }, queue: { [machineId]: [...] }, serverTime: <epoch_ms> }
     */
    public function stateSnapshot(): JsonResponse
    {
        // DB-first: load all non-finished sessions
        $dbSessions = ProductionSession::whereNotIn('status', ['finished', 'cancelled'])
            ->get()
            ->keyBy('machine_id')
            ->map(fn($s) => $s->toFrontendState())
            ->toArray();

        // Fallback: cache-based sessions for machines not in DB yet
        $known    = Cache::get('known_machine_session_ids', []);
        $sessions = $dbSessions;
        foreach ($known as $mid) {
            if (!isset($sessions[$mid])) {
                $cached = Cache::get("machine_session_{$mid}");
                if ($cached !== null) {
                    $sessions[$mid] = $cached;
                }
            }
        }

        // DB queue per machine
        $queueItems = ProductionQueueItem::where('status', 'queued')
            ->orderBy('created_at')
            ->get()
            ->groupBy('machine_id')
            ->map(fn($items) => $items->map(fn($i) => $i->toFrontend())->values())
            ->toArray();

        return response()->json([
            'sessions'   => $sessions,
            'queue'      => $queueItems,
            'serverTime' => (int) round(microtime(true) * 1000),
        ]);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // DB-FIRST ENDPOINTS  (Phase 1 — runs alongside cache-based flow)
    // ══════════════════════════════════════════════════════════════════════════

    // ── Queue ─────────────────────────────────────────────────────────────────

    /**
     * POST /api/production-monitor/queue/{machineId}
     *
     * เพิ่มรายการผลิตเข้าคิวใน DB → broadcast queue_updated via SSE
     *
     * Body: { orderId, productCode, productName, targetQty, remainingQty,
     *         planDate, sheetName, ledIp, queueKey?,
     *         peType?, size?, length?, pn?, brand?, colorStripe?,
     *         stdWeight?, minWeight?, maxWeight? }
     */
    public function enqueueItem(Request $request, string $machineId): JsonResponse
    {
        $data = $request->only([
            'orderId', 'productCode', 'productName', 'targetQty', 'remainingQty',
            'planDate', 'sheetName', 'ledIp', 'queueKey',
            'peType', 'size', 'length', 'pn', 'brand', 'colorStripe',
            'stdWeight', 'minWeight', 'maxWeight',
        ]);

        if (empty($data['orderId'])) {
            return response()->json(['success' => false, 'message' => 'orderId required'], 422);
        }

        // Dedup: ถ้า queueKey เดิมยังอยู่ใน queued state → return existing
        if (!empty($data['queueKey'])) {
            $existing = ProductionQueueItem::where('machine_id', $machineId)
                ->where('queue_key', $data['queueKey'])
                ->where('status', 'queued')
                ->first();
            if ($existing) {
                return response()->json([
                    'success' => true,
                    'item'    => $existing->toFrontend(),
                    'dedup'   => true,
                ]);
            }
        }

        $item = ProductionQueueItem::create([
            'machine_id'   => $machineId,
            'order_id'     => $data['orderId'],
            'product_code' => $data['productCode'] ?? '',
            'product_name' => $data['productName'] ?? '',
            'target_qty'   => (int) ($data['targetQty'] ?? 0),
            'remaining_qty'=> (int) ($data['remainingQty'] ?? $data['targetQty'] ?? 0),
            'plan_date'    => $data['planDate'] ?? '',
            'sheet_name'   => $data['sheetName'] ?? '',
            'led_ip'       => $data['ledIp'] ?? '',
            'queue_key'    => $data['queueKey'] ?? null,
            'pe_type'      => $data['peType'] ?? null,
            'size'         => isset($data['size']) ? (float) $data['size'] : null,
            'length'       => isset($data['length']) ? (float) $data['length'] : null,
            'pn'           => isset($data['pn']) ? (float) $data['pn'] : null,
            'brand'        => $data['brand'] ?? null,
            'color_stripe' => $data['colorStripe'] ?? null,
            'std_weight'   => isset($data['stdWeight']) ? (float) $data['stdWeight'] : null,
            'min_weight'   => isset($data['minWeight']) ? (float) $data['minWeight'] : null,
            'max_weight'   => isset($data['maxWeight']) ? (float) $data['maxWeight'] : null,
            'status'       => 'queued',
        ]);

        $this->publishEvent('queue_updated', [
            'machineId' => $machineId,
            'action'    => 'added',
            'item'      => $item->toFrontend(),
        ]);

        return response()->json(['success' => true, 'item' => $item->toFrontend()], 201);
    }

    /**
     * GET /api/production-monitor/queue/{machineId}
     *
     * ดึงคิวทั้งหมด (status=queued) ของเครื่องนี้
     * Response: { queue: [ {...}, ... ] }
     */
    public function getQueue(string $machineId): JsonResponse
    {
        $items = ProductionQueueItem::where('machine_id', $machineId)
            ->where('status', 'queued')
            ->orderBy('created_at')
            ->get()
            ->map(fn($i) => $i->toFrontend())
            ->values();

        return response()->json(['queue' => $items]);
    }

    /**
     * DELETE /api/production-monitor/queue/{machineId}/{itemId}
     *
     * ยกเลิกรายการในคิว → broadcast queue_updated
     */
    public function deleteQueueItem(string $machineId, int $itemId): JsonResponse
    {
        $item = ProductionQueueItem::where('machine_id', $machineId)
            ->where('id', $itemId)
            ->first();

        if (!$item) {
            return response()->json(['success' => false, 'message' => 'not found'], 404);
        }

        $item->update(['status' => 'cancelled']);

        $this->publishEvent('queue_updated', [
            'machineId' => $machineId,
            'action'    => 'removed',
            'itemId'    => $itemId,
        ]);

        return response()->json(['success' => true]);
    }

    // ── Session / Live ────────────────────────────────────────────────────────

    /**
     * GET /api/production-monitor/session/{machineId}
     *
     * ดึง active session (status != finished/cancelled)
     * Response: { session: {...} | null }
     */
    public function getSession(string $machineId): JsonResponse
    {
        $session = ProductionSession::where('machine_id', $machineId)
            ->whereNotIn('status', ['finished', 'cancelled'])
            ->first();

        return response()->json([
            'session' => $session ? $session->toFrontendState() : null,
        ]);
    }

    /**
     * POST /api/production-monitor/start/{machineId}
     *
     * StartNow: สร้าง/อัปเดต session เป็น live ใน DB
     *           mark queue item started, broadcast session_updated + production_updated
     *
     * Body: { queueItemId?, orderId, productCode, productName, targetQty, remainingQty,
     *         planDate, sheetName, ledIp, peType?, size?, length?, pn?, brand?,
     *         colorStripe?, stdWeight?, minWeight?, maxWeight? }
     */
    public function startSession(Request $request, string $machineId): JsonResponse
    {
        $data = $request->only([
            'queueItemId', 'orderId', 'productCode', 'productName',
            'targetQty', 'remainingQty', 'planDate', 'sheetName', 'ledIp',
            'peType', 'size', 'length', 'pn', 'brand', 'colorStripe',
            'stdWeight', 'minWeight', 'maxWeight',
        ]);

        if (empty($data['orderId'])) {
            return response()->json(['success' => false, 'message' => 'orderId required'], 422);
        }

        $now = now();
        $ts  = (int) ($now->timestamp * 1000);

        $sessionData = [
            'machine_id'   => $machineId,
            'order_id'     => $data['orderId'],
            'product_code' => $data['productCode'] ?? '',
            'product_name' => $data['productName'] ?? '',
            'target_qty'   => (int) ($data['targetQty'] ?? 0),
            'remaining_qty'=> (int) ($data['remainingQty'] ?? $data['targetQty'] ?? 0),
            'plan_date'    => $data['planDate'] ?? '',
            'sheet_name'   => $data['sheetName'] ?? '',
            'led_ip'       => $data['ledIp'] ?? '',
            'pe_type'      => $data['peType'] ?? null,
            'size'         => isset($data['size']) ? (float) $data['size'] : null,
            'length'       => isset($data['length']) ? (float) $data['length'] : null,
            'pn'           => isset($data['pn']) ? (float) $data['pn'] : null,
            'brand'        => $data['brand'] ?? null,
            'color_stripe' => $data['colorStripe'] ?? null,
            'std_weight'   => isset($data['stdWeight']) ? (float) $data['stdWeight'] : null,
            'min_weight'   => isset($data['minWeight']) ? (float) $data['minWeight'] : null,
            'max_weight'   => isset($data['maxWeight']) ? (float) $data['maxWeight'] : null,
            'status'       => 'live',
            'source'       => 'web',
            'started_at'   => $now,
            'paused_at'    => null,
            'pipe_counter' => 0,
            'ng_count'     => 0,
            'total_good_weight' => 0,
            'total_ng_weight'   => 0,
            'ts'           => $ts,
        ];

        DB::transaction(function () use ($machineId, $data, $sessionData, $now) {
            // Finish any existing active session for this machine
            ProductionSession::where('machine_id', $machineId)
                ->whereNotIn('status', ['finished', 'cancelled'])
                ->update(['status' => 'finished', 'finished_at' => $now]);

            // Create new session
            ProductionSession::create($sessionData);

            // Mark the queue item as started
            if (!empty($data['queueItemId'])) {
                ProductionQueueItem::where('id', (int) $data['queueItemId'])
                    ->where('machine_id', $machineId)
                    ->update(['status' => 'started']);
            }
        });

        $session = ProductionSession::where('machine_id', $machineId)
            ->where('status', 'live')
            ->latest()
            ->first();

        $frontendState = $session ? $session->toFrontendState() : $sessionData;

        // Async dual-write to Google Sheet (create-order header row)
        if ($session) {
            // Create a temporary ProductionOrder record for the GAS createOrder call
            $tmpOrder = ProductionOrder::create([
                'machine_id'   => $machineId,
                'order_id'     => $session->order_id,
                'product_code' => $session->product_code,
                'product_name' => $session->product_name,
                'target_qty'   => $session->target_qty,
                'remaining_qty'=> $session->remaining_qty,
                'plan_date'    => $session->plan_date,
                'sheet_name'   => $session->sheet_name,
                'led_ip'       => $session->led_ip,
                'started_at'   => $session->started_at,
                'status'       => 'active',
                'gas_sync_status' => 'pending',
            ]);
            SyncOrderToGas::dispatch($tmpOrder->id, 'createOrder', $this->gasUrl)
                ->onQueue('gas-sync');
        }

        // Broadcast as production_updated to match existing frontend SSE handler
        $this->publishEvent('production_updated', [
            'machineId' => $machineId,
            'state'     => $frontendState,
        ]);
        $this->publishEvent('session_updated', [
            'machineId' => $machineId,
            'session'   => $frontendState,
        ]);

        return response()->json(['success' => true, 'session' => $frontendState]);
    }

    /**
     * POST /api/production-monitor/pause/{machineId}
     *
     * หยุดชั่วคราว: status → paused, เก็บ pausedOrder snapshot
     * Body: { pausedOrder?: {...} }
     */
    public function pauseSession(Request $request, string $machineId): JsonResponse
    {
        $session = ProductionSession::where('machine_id', $machineId)
            ->where('status', 'live')
            ->first();

        if (!$session) {
            return response()->json(['success' => false, 'message' => 'no live session'], 404);
        }

        $session->update([
            'status'       => 'paused',
            'paused_at'    => now(),
            'paused_order' => $request->input('pausedOrder'),
            'ts'           => (int) (now()->timestamp * 1000),
        ]);

        $state = $session->fresh()->toFrontendState();

        $this->publishEvent('session_updated', ['machineId' => $machineId, 'session' => $state]);
        $this->publishEvent('production_updated', ['machineId' => $machineId, 'state' => $state]);

        return response()->json(['success' => true, 'session' => $state]);
    }

    /**
     * POST /api/production-monitor/finish/{machineId}
     *
     * จบงาน: status → finished, คัดลอกข้อมูลไป production_orders
     * Body: { goodCount?, ngCount?, totalGoodWeight?, totalNgWeight? }
     */
    public function finishSession(Request $request, string $machineId): JsonResponse
    {
        $session = ProductionSession::where('machine_id', $machineId)
            ->whereIn('status', ['live', 'paused'])
            ->first();

        if (!$session) {
            return response()->json(['success' => false, 'message' => 'no active session'], 404);
        }

        $now = now();

        // Allow frontend to override counters (e.g., final sync before finish)
        $goodCount       = (int) ($request->input('goodCount',       $session->pipe_counter));
        $ngCount         = (int) ($request->input('ngCount',         $session->ng_count));
        $totalGoodWeight = (float) ($request->input('totalGoodWeight', $session->total_good_weight));
        $totalNgWeight   = (float) ($request->input('totalNgWeight',  $session->total_ng_weight));

        DB::transaction(function () use ($session, $machineId, $now, $goodCount, $ngCount, $totalGoodWeight, $totalNgWeight) {
            $session->update([
                'status'      => 'finished',
                'finished_at' => $now,
                'pipe_counter'      => $goodCount,
                'ng_count'          => $ngCount,
                'total_good_weight' => $totalGoodWeight,
                'total_ng_weight'   => $totalNgWeight,
                'ts'          => (int) ($now->timestamp * 1000),
            ]);

            // Write summary to production_orders (for history queries)
            $prodOrder = ProductionOrder::create([
                'machine_id'        => $machineId,
                'order_id'          => $session->order_id,
                'product_code'      => $session->product_code,
                'product_name'      => $session->product_name,
                'target_qty'        => $session->target_qty,
                'remaining_qty'     => max(0, $session->target_qty - $goodCount),
                'plan_date'         => $session->plan_date,
                'sheet_name'        => $session->sheet_name,
                'led_ip'            => $session->led_ip,
                'shift'             => $session->shift,
                'employee_id'       => $session->employee_id,
                'good_count'        => $goodCount,
                'ng_count'          => $ngCount,
                'total_good_weight' => $totalGoodWeight,
                'total_ng_weight'   => $totalNgWeight,
                'pe_type'           => $session->pe_type,
                'size'              => $session->size,
                'length'            => $session->length,
                'brand'             => $session->brand,
                'color_stripe'      => $session->color_stripe,
                'std_weight'        => $session->std_weight,
                'started_at'        => $session->started_at,
                'finished_at'       => $now,
                'status'            => 'finished',
                'gas_sync_status'   => 'pending',
            ]);
        });

        // Dispatch async GAS dual-write for order close
        SyncOrderToGas::dispatch($prodOrder->id, 'closeOrder', $this->gasUrl)
            ->onQueue('gas-sync');

        $state = $session->fresh()->toFrontendState();

        $this->publishEvent('session_updated', ['machineId' => $machineId, 'session' => $state]);
        $this->publishEvent('production_updated', ['machineId' => $machineId, 'state' => $state]);

        return response()->json(['success' => true, 'session' => $state]);
    }

    /**
     * GET /api/production-monitor/history-db
     *
     * ดึงประวัติการผลิตจาก DB แทน GAS
     * Query: ?machineId=&orderId=&from=YYYY-MM-DD&to=YYYY-MM-DD&page=1&perPage=50
     */
    public function getHistoryDb(Request $request): JsonResponse
    {
        $query = ProductionOrder::query()->orderByDesc('started_at');

        if ($machineId = $request->input('machineId')) {
            $query->where('machine_id', $machineId);
        }
        if ($orderId = $request->input('orderId')) {
            $query->where('order_id', $orderId);
        }
        if ($from = $request->input('from')) {
            $query->whereDate('started_at', '>=', $from);
        }
        if ($to = $request->input('to')) {
            $query->whereDate('started_at', '<=', $to);
        }

        $perPage = min((int) $request->input('perPage', 50), 200);
        $orders  = $query->paginate($perPage);

        return response()->json([
            'data'         => $orders->items(),
            'total'        => $orders->total(),
            'current_page' => $orders->currentPage(),
            'last_page'    => $orders->lastPage(),
        ]);
    }
}
