/**
 * Production Monitor API
 *
 * All requests go through the Laravel proxy at /api/production-monitor/
 * instead of calling Google Apps Script directly from the browser.
 * This eliminates CORS entirely — the server-to-server leg has no
 * browser-side restrictions.
 *
 * Endpoint map:
 *   GET  /api/production-monitor/get-settings   ← GAS doGet?action=getSettings
 *   POST /api/production-monitor/create-order   ← GAS doPost action=createOrder
 *   POST /api/production-monitor/update-weight  ← GAS doPost action=updateWeight
 *   POST /api/production-monitor/close-order    ← GAS doPost action=closeOrder
 */

const BASE = '/api/production-monitor';

// ─── Transport helpers ────────────────────────────────────────────────────────

/**
 * Builds a rich Error that also carries the raw GAS response body.
 * Consumers can read `err.raw` to surface diagnostic info in the UI.
 */
const buildError = (data, status) => {
  const err = new Error(data.message ?? `HTTP ${status}`);
  err.raw        = data.raw   ?? data.debug ?? null;
  err.httpStatus = status;
  return err;
};

/** Fetch พร้อม AbortController timeout — ป้องกัน GAS ช้าทำ UI ค้างไม่มีกำหนด */
const fetchWithTimeout = (url, options = {}, timeoutMs = 30_000) => {
  const ctrl = new AbortController();
  const id    = setTimeout(() => ctrl.abort(), timeoutMs);
  return fetch(url, { ...options, signal: ctrl.signal })
    .catch((err) => {
      if (err.name === 'AbortError') {
        throw new Error(`Request timeout (>${timeoutMs / 1000}s) — GAS อาจช้า ลองใหม่อีกครั้ง`);
      }
      throw err;
    })
    .finally(() => clearTimeout(id));
};

const get = async (endpoint) => {
  const response = await fetchWithTimeout(`${BASE}${endpoint}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });

  const data = await response
    .json()
    .catch(() => ({ success: false, message: response.statusText }));

  if (!response.ok) {
    throw buildError(data, response.status);
  }

  return data;
};

const getCsrfToken = () =>
  document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') ?? '';

const post = async (endpoint, body) => {
  const response = await fetchWithTimeout(`${BASE}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-CSRF-TOKEN': getCsrfToken(),
    },
    body: JSON.stringify(body),
  });

  const data = await response
    .json()
    .catch(() => ({ success: false, message: response.statusText }));

  if (!response.ok) {
    throw buildError(data, response.status);
  }

  return data;
};

// ─── Data normalisation ───────────────────────────────────────────────────────

/**
 * Converts the raw GAS Settings-sheet rows into the internal machine shape
 * used throughout the dashboard.
 *
 * GAS row  → { MachineID, SheetName, LED_IP, Status, ... }
 * Internal → { id, label, ledIp, sheetName }
 *
 * Handles every response shape the GAS script might return:
 *   1. Plain array      : [{ MachineID, … }, …]
 *   2. { machines: […] } ← our GAS doGet returns this
 *   3. { settings: […] }
 *   4. { data: […] }
 */
const normaliseMachines = (raw) => {
  const rows = Array.isArray(raw)
    ? raw
    : (raw?.machines ?? raw?.settings ?? raw?.data ?? []);

  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('Settings sheet returned an empty machine list.');
  }

  return rows
    .filter((row) => row.MachineID) // skip blank trailing rows
    .map((row) => ({
      id:        row.MachineID,
      label:     String(row.MachineID).replace(/_/g, ' '),
      ledIp:     row.LED_IP    ?? '',
      sheetName: row.SheetName ?? row.MachineID,
      zone:      (row.Zone     ?? '').toString().trim(),
      status:    (row.Status   ?? 'Active').toString().trim(),
    }));
};

// ─── Exported API functions ───────────────────────────────────────────────────

/**
 * GET /api/production-monitor/get-settings
 *
 * Fetches the machine list from the GAS Settings sheet via the Laravel
 * proxy and returns a normalised array ready for the dashboard sidebar.
 *
 * @returns {Promise<Array<{ id: string, label: string, ledIp: string, sheetName: string }>>}
 */
export const fetchMachineSettings = async () => {
  const raw = await get('/get-settings');
  return normaliseMachines(raw);
};

/**
 * POST /api/production-monitor/create-order
 *
 * @param {{ machineId: string, sheetName: string, ledIp?: string,
 *           orderId: string, productName: string, targetQty: number }} params
 */
export const createOrder = (params) => post('/create-order', params);

/**
 * POST /api/production-monitor/update-weight
 *
 * @param {{ machineId: string, sheetName: string, orderId: string,
 *           type: 'good'|'ng', weight: number }} params
 */
export const updateWeight = (params) => post('/update-weight', params);

/**
 * POST /api/production-monitor/close-order
 *
 * @param {{ machineId: string, sheetName: string, orderId: string,
 *           goodCount: number, totalGoodWeight: number,
 *           ngCount: number, totalNgWeight: number }} params
 */
export const closeOrder = (params) => post('/close-order', params);

/**
 * POST /api/production-monitor/log-weight-event
 *
 * บันทึกรายการกดปุ่มตาชั่ง (น้ำหนัก + เวลาที่กด) ลง GAS Sheet — fire-and-forget
 *
 * @param {{ machineId, sheetName, orderId, seq, type: 'good'|'ng', weight, pressedAt }} params
 */
export const logWeightEvent = (params) => post('/log-weight-event', params);

/**
 * POST /api/production-monitor/update-daily-produced
 * อัปเดตช่องกะ A/B/C ใน Daily sheet หลังกด Finished Order
 * @param {{ machineId, jobNo, date, shift, produced }} params
 */
/**
 * POST /api/production-monitor/update-plan-produced
 *
 * บวกสะสมจำนวนผลิตได้ / น้ำหนัก / รหัสพนักงาน ลง Sheet แผนการผลิต
 * @param {{ jobNo, date, goodCount, goodWeight, ngWeight, employeeId }} params
 */
export const updatePlanProduced = async (params) => {
  const response = await fetchWithTimeout(`${BASE}/update-plan-produced`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-CSRF-TOKEN': getCsrfToken(),
    },
    body: JSON.stringify(params),
  }, 90_000);
  const data = await response.json().catch(() => ({ success: false, message: response.statusText }));
  if (!response.ok) throw buildError(data, response.status);
  return data;
};

export const updateDailyProduced = async (params) => {
  const response = await fetchWithTimeout(`${BASE}/update-daily-produced`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-CSRF-TOKEN': getCsrfToken(),
    },
    body: JSON.stringify(params),
  }, 90_000); // GAS cold start อาจนานถึง 60-90s
  const data = await response.json().catch(() => ({ success: false, message: response.statusText }));
  if (!response.ok) throw buildError(data, response.status);
  return data;
};

/**
 * GET /api/production-monitor/history?sheetName=Machine_01
 *
 * Fetches production records from GAS sheets.
 * If sheetName is omitted, all machine sheets are returned.
 *
 * @param {string} [sheetName]
 * @returns {Promise<Array<{ machine, timestamp, orderId, productName, targetQty, weight, status }>>}
 */
export const fetchHistory = async (sheetName = null) => {
  const endpoint = sheetName ? `/history?sheetName=${encodeURIComponent(sheetName)}` : '/history';
  const raw = await get(endpoint);
  const rows = Array.isArray(raw) ? raw : (raw?.history ?? raw?.data ?? []);
  return rows;
};

/**
 * GET /api/production-monitor/order-detail?sheetName=...&orderId=...
 *
 * Returns per-order details (weight events between Started → Completed).
 *
 * @param {string} sheetName
 * @param {string} orderId
 */
export const fetchOrderDetail = async (sheetName, orderId, startedAt = null) => {
  const qs = new URLSearchParams({
    sheetName: String(sheetName ?? ''),
    orderId: String(orderId ?? ''),
  });
  if (startedAt) qs.append('startedAt', String(startedAt));
  const endpoint = `/order-detail?${qs.toString()}`;
  const raw = await get(endpoint);
  return raw?.detail ?? raw?.data ?? raw;
};

// ─── LED Sign ────────────────────────────────────────────────────────────────

/**
 * POST /api/production-monitor/led
 *
 * Sends a display command to an ESP32 LED sign via the Laravel proxy.
 * Routing through Laravel avoids browser CORS / Private-Network-Access
 * restrictions that block direct fetch() calls to LAN IP addresses.
 *
 * @param {{ ledIp: string, text: string, r: number, g: number, b: number, fontSize: number }} params
 */
/** POST /api/production-monitor/led — direct push (ต้องอยู่ network เดียวกัน) */
export const sendLedCommand = (params) => post('/led', params);

/** GET /api/production-monitor/led-ping?ledIp=... — ทดสอบเชื่อมต่อ ESP32 (single IP) */
export const pingLed = (ledIp) => get(`/led-ping?ledIp=${encodeURIComponent(ledIp)}`);

/**
 * ทดสอบ ping ESP32 จากหลาย IP พร้อมกัน — คืน IP แรกที่ตอบสนอง
 *
 * รองรับ ledIp แบบ comma-separated: "192.168.3.108,192.168.103.108"
 * ทุก IP จะถูก ping พร้อมกัน (parallel) แล้วเอาอันที่เร็วที่สุด
 *
 * @param {string} ledIpString  IP เดียว หรือ comma-separated เช่น "a.b.c.d,e.f.g.h"
 * @returns {Promise<{ ip: string, machineId?: string, text?: string }>}
 */
export const pingLedMulti = async (ledIpString) => {
  const ips = String(ledIpString ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (ips.length === 0) throw new Error('ยังไม่ได้ตั้งค่า LED_IP ในชีต Settings');

  const races = ips.map(async (ip) => {
    const res  = await pingLed(ip);
    const body = res?.body ?? res;
    return { ip, ...(typeof body === 'object' ? body : { raw: body }) };
  });

  // Promise.any → เอา IP แรกที่สำเร็จ; ถ้าทุกตัว fail → AggregateError
  return Promise.any(races).catch(() => {
    throw new Error(`ไม่สามารถเชื่อมต่อ ESP32 ได้เลย (ลอง ${ips.length} IP${ips.length > 1 ? 's' : ''})`);
  });
};

/**
 * POST /api/production-monitor/led-command/{machineId}
 *
 * เก็บคำสั่งลง Laravel Cache — ESP32 จะมา poll ดึงเอง
 * ใช้แทน sendLedCommand เมื่อ PC กับ ESP32 ไม่ได้อยู่ network เดียวกัน
 *
 * @param {string} machineId  รหัสเครื่อง เช่น "EM20"
 * @param {{ text: string, r: number, g: number, b: number, fontSize: number }} params
 */
export const queueLedCommand = (machineId, params) =>
  post(`/led-command/${encodeURIComponent(machineId)}`, params);

/**
 * GET /api/production-monitor/led-status/{machineId}
 *
 * ดึงสถานะล่าสุดของป้ายไฟ (last command sent from web UI)
 * ใช้แสดงใน Modal ว่าตอนนี้ป้ายไฟแสดงอะไรอยู่ — persistent แม้รีเฟรชหน้า
 */
export const getLedStatus = (machineId) =>
  get(`/led-status/${encodeURIComponent(machineId)}`);

/**
 * GET /api/production-monitor/led-heartbeat/{machineId}
 *
 * เช็คสถานะ WiFi ของป้ายไฟจาก heartbeat (timestamp ล่าสุดที่ ESP32 poll /led-command)
 * ใช้แทนการ ping IP โดยตรง — ทำงานได้แม้ PC กับ ESP32 อยู่คนละ subnet
 *
 * Response: { success, machineId, online: bool, lastSeenAt: string|null, secondsAgo: number|null }
 */
export const getLedHeartbeat = (machineId) =>
  get(`/led-heartbeat/${encodeURIComponent(machineId)}`);

/** ข้อความป้ายไฟเมื่อหยุด / Pause จากการแก้ข้อความในหน้า LED */
export const LED_BREAKDOWN_PAYLOAD = {
  text: 'Break Down',
  r: 255,
  g: 0,
  b: 0,
  fontSize: 1,
  speed: 50,
  actual: '0',
  target: '0',
};

/** ข้อความป้ายไฟเมื่อ Pause Order / Finished Order (เตรียมการ - สีน้ำเงิน) */
export const LED_PREP_PAYLOAD = {
  text: 'เตรียมการ',
  r: 0,
  g: 136,
  b: 255,
  fontSize: 1,
  speed: 50,
  actual: '0',
  target: '0',
};

/**
 * ข้อความบรรทัดเดียวสำหรับป้ายระหว่างผลิต (รหัส — ชื่อ ฯลฯ)
 * @param {{ productCode?: string, productName?: string, orderId?: string }} data
 */
export const buildProductionLedText = (data) => {
  const code = String(data?.productCode ?? '').trim();
  const pname = String(data?.productName ?? '').trim();
  if (code && pname) return `${code} — ${pname}`;
  if (code) return code;
  if (pname) return pname;
  return String(data?.orderId ?? '');
};

/**
 * Payload สำหรับ queueLedCommand ตอนรันงาน (สีฟ้า + actual/target)
 * @param {{ productCode?: string, productName?: string, orderId?: string, targetQty?: number }} data
 * @param {number} [pipeCounter] ถ้าไม่ส่ง จะใช้จาก data.pipeCounter / data.actual
 * @returns {object|null}
 */
export const buildProductionLedCommand = (data, pipeCounter) => {
  const text = buildProductionLedText(data);
  if (!text) return null;
  const actual =
    pipeCounter !== undefined && pipeCounter !== null
      ? String(pipeCounter)
      : String(data?.pipeCounter ?? data?.actual ?? 0);
  return {
    text,
    r: 0,
    g: 255,
    b: 255,
    fontSize: 1,
    speed: 50,
    actual,
    target: String(data?.remainingQty ?? data?.targetQty ?? 0),
  };
};

// ─── Machine Log ─────────────────────────────────────────────────────────────

/**
 * POST /api/machine-log/append
 *
 * บันทึกสถานะเครื่องจักรลง Machine Log spreadsheet
 * @param {{ machine, date, status, time, cause, team, reporter, productCode, detail, fix }} payload
 */
export const appendMachineLog = async (payload) => {
  const response = await fetchWithTimeout('/api/machine-log/append', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-CSRF-TOKEN': getCsrfToken(),
    },
    body: JSON.stringify(payload),
  }, 90_000); // GAS cold start อาจใช้เวลาถึง 60-90s
  const data = await response.json().catch(() => ({ success: false }));
  return data;
};

const MACHINE_LOG_API = '/api/machine-log';

/**
 * GET /api/machine-log/reporters
 * @returns {Promise<Array<{ id: number, name: string }>>}
 */
export const fetchMachineLogReporters = async () => {
  const response = await fetchWithTimeout(`${MACHINE_LOG_API}/reporters`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  const data = await response.json().catch(() => ({ reporters: [] }));
  if (!response.ok) {
    throw buildError(data, response.status);
  }
  return Array.isArray(data.reporters) ? data.reporters : [];
};

/**
 * POST /api/machine-log/reporters
 * @param {string} name
 * @returns {Promise<{ id: number, name: string }>}
 */
export const storeMachineLogReporter = async (name) => {
  const response = await fetchWithTimeout(`${MACHINE_LOG_API}/reporters`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-CSRF-TOKEN': getCsrfToken(),
    },
    body: JSON.stringify({ name }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw buildError(data, response.status);
  }
  if (!data.reporter) {
    throw new Error('Invalid response from server');
  }
  return data.reporter;
};

/**
 * DELETE /api/machine-log/reporters/{id}
 */
export const deleteMachineLogReporter = async (id) => {
  const response = await fetchWithTimeout(`${MACHINE_LOG_API}/reporters/${id}`, {
    method: 'DELETE',
    headers: {
      Accept: 'application/json',
      'X-CSRF-TOKEN': getCsrfToken(),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw buildError(data, response.status);
  }
};

// ─── Production Plan (แผนการผลิต / Monthly / Daily) ─────────────────────────

/**
 * GET /api/production-monitor/plan
 *
 * Fetches rows from the "แผนการผลิต" sheet.
 * Each row includes core order fields + dailyProduction map (date → qty).
 *
 * @param {{ machine?: string, status?: 'Complete'|'Inprocess' }} [params]
 * @returns {Promise<Array<PlanOrder>>}
 */
export const fetchProductionPlan = async ({ machine, status } = {}) => {
  const qs = new URLSearchParams();
  if (machine) qs.append('machine', machine);
  if (status)  qs.append('status', status);
  const endpoint = '/plan' + (qs.toString() ? '?' + qs.toString() : '');
  const raw = await get(endpoint);
  return Array.isArray(raw) ? raw : (raw?.plan ?? []);
};

/**
 * GET /api/production-monitor/monthly-plan
 *
 * Fetches rows from the "Monthly" sheet.
 *
 * @param {{ machine?: string, jobNo?: string }} [params]
 * @returns {Promise<Array>}
 */
export const fetchMonthlyPlan = async ({ machine, jobNo } = {}) => {
  const qs = new URLSearchParams();
  if (machine) qs.append('machine', machine);
  if (jobNo)   qs.append('jobNo', jobNo);
  const endpoint = '/monthly-plan' + (qs.toString() ? '?' + qs.toString() : '');
  const raw = await get(endpoint);
  return Array.isArray(raw) ? raw : (raw?.monthly ?? []);
};

/**
 * GET /api/production-monitor/daily-plan
 *
 * Fetches rows from the "Daily" sheet (per-shift production records).
 *
 * @param {{ machine?: string, jobNo?: string }} [params]
 * @returns {Promise<Array>}
 */
export const fetchDailyPlan = async ({ machine, jobNo, sinceDate } = {}) => {
  const qs = new URLSearchParams();
  if (machine)    qs.append('machine',   machine);
  if (jobNo)      qs.append('jobNo',     jobNo);
  if (sinceDate)  qs.append('sinceDate', sinceDate);
  const endpoint = '/daily-plan' + (qs.toString() ? '?' + qs.toString() : '');
  const raw = await get(endpoint);
  return Array.isArray(raw) ? raw : (raw?.daily ?? []);
};

/**
 * GET /api/production-monitor/product-lookup
 *
 * Fetches a { productCode: productName } map from the Chaiyo Data Center sheet.
 * Cached 30 min server-side. Returns {} on error.
 *
 * @returns {Promise<Record<string, string>>}
 */
export const fetchProductLookup = async () => {
  try {
    const raw = await get('/product-lookup');
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
    return {};
  } catch {
    return {};
  }
};

/**
 * GET /api/production-monitor/product-details
 *
 * Returns full product detail map from Sheet "Product".
 * @returns {Promise<Record<string, {
 *   name: string, peType: string, size: number|null, length: number|null,
 *   pn: number|null, brand: string, colorStripe: string,
 *   stdWeight: number|null, minWeight: number|null, maxWeight: number|null
 * }>>}
 */
export const fetchProductDetails = async () => {
  try {
    const raw = await get('/product-details');
    if (raw && typeof raw === 'object' && !Array.isArray(raw) && !raw._error) return raw;
    return {};
  } catch {
    return {};
  }
};

// ─── Scale ESP32 ─────────────────────────────────────────────────────────────

/**
 * POST /api/production-monitor/scale-command/{machineId}
 *
 * Web ส่งข้อมูลงานให้ Scale ESP32 — ESP32 จะ poll มาดึงเอง
 *
 * @param {string} machineId
 * @param {{ orderId: string, productCode: string, targetQty: number, sheetName: string }} payload
 */
export const storeScaleCommand = (machineId, payload) =>
  post(`/scale-command/${encodeURIComponent(machineId)}`, payload);

/**
 * GET /api/production-monitor/scale-confirm/{machineId}
 *
 * Web poll รอการยืนยันจาก Scale ESP32 (หลังกด D บน Keypad)
 * Response: { pending: true, shift: "A"|"B"|"C", employeeId: "123456" }
 *        หรือ { pending: false }
 *
 * @param {string} machineId
 */
export const fetchScaleConfirm = (machineId) =>
  get(`/scale-confirm/${encodeURIComponent(machineId)}`);

/**
 * POST /api/production-monitor/scale-weight/{machineId}
 *
 * Scale ESP32 ส่งน้ำหนัก+ประเภท (ปกติเรียกจาก ESP32 ไม่ใช่ web)
 * แต่ expose ไว้เผื่อทดสอบ
 *
 * @param {string} machineId
 * @param {{ orderId, sheetName, type, weight, employeeId, shift, actualCount }} payload
 */
export const storeScaleWeight = (machineId, payload) =>
  post(`/scale-weight/${encodeURIComponent(machineId)}`, payload);

/**
 * GET /api/production-monitor/scale-weight/{machineId}[?since=<ISO>]
 *
 * Web poll รับ weight events จาก Scale ESP32 (READ-ONLY — server ไม่ลบ events)
 * ส่ง since=<ISO timestamp> เพื่อรับเฉพาะ events ที่ใหม่กว่านั้น
 *
 * Response: { events: [...], latestTs: string|null }
 *
 * @param {string} machineId
 * @param {string|null} [since]  ISO timestamp — ถ้าส่งมา จะรับเฉพาะ events ใหม่กว่านี้
 */
export const fetchScaleWeights = (machineId, since = null) => {
  const qs = since ? `?since=${encodeURIComponent(since)}` : '';
  return get(`/scale-weight/${encodeURIComponent(machineId)}${qs}`);
};

/**
 * POST /api/production-monitor/scale-live/{machineId}
 *
 * ซิงค์สถานะ Live ของเครื่องพร้อม session ข้อมูลงาน
 * ตาชั่ง ESP32 ดึง session นี้หลัง reboot / WiFi หลุด เพื่อ restore อัตโนมัติ
 *
 * @param {string} machineId
 * @param {{ live: boolean, orderId?, productCode?, productName?, targetQty?, shift?, employeeId?, sheetName? }} payload
 */
export const storeScaleLive = (machineId, payload) =>
  post(`/scale-live/${encodeURIComponent(machineId)}`, payload);

// ─── Machine Session Sync (Shared State across all browsers) ─────────────────

/**
 * POST /api/production-monitor/machine-session/{machineId}
 *
 * Sync สถานะเครื่องขึ้น Laravel Cache เพื่อให้ browser อื่นๆ poll รับได้
 * goodEvents / ngEvents ถูก strip ออกเพื่อลด payload size
 *
 * @param {string} machineId
 * @param {object} state  — machine state จาก useProductionStates
 */
export const storeMachineSession = (machineId, state) => {
  // Strip heavy event arrays ก่อน sync (ไม่จำเป็นสำหรับ viewer device)
  const { goodEvents: _g, ngEvents: _n, ...rest } = state ?? {};
  const stripped = { ...rest };
  if (stripped.pausedOrder) {
    const { goodEvents: _pg, ngEvents: _pn, ...pausedRest } = stripped.pausedOrder;
    stripped.pausedOrder = pausedRest;
  }
  return post(`/machine-session/${encodeURIComponent(machineId)}`, { state: stripped });
};

/**
 * GET /api/production-monitor/machine-sessions
 *
 * Browser poll รับ shared state ของทุกเครื่อง (ทุก 5 วินาที)
 * Response: { sessions: { [machineId]: state } }
 */
export const fetchAllMachineSessions = () => get('/machine-sessions');

// ─── New endpoints (P1-P5 bug fixes) ─────────────────────────────────────────

/**
 * GET /api/production-monitor/state-snapshot
 *
 * Full state snapshot of all machines — called on SSE reconnect to fill
 * any gap during disconnection. Equivalent to machine-sessions but
 * intended for delta-sync (server may include only changed entries).
 *
 * Response: { sessions: { [machineId]: state }, serverTime: number }
 */
export const fetchMachinesStateSnapshot = () => get('/state-snapshot');

/**
 * POST /api/production-monitor/push-to-scale/{machineId}
 *
 * StartNow: push the FULL current job payload to the ESP32 scale immediately.
 * The scale firmware MUST overwrite any cached/NVS data with this payload (no merge).
 *
 * Request body: {
 *   order_id, product_name, target_weight, qty_target, qty_good,
 *   qty_remaining, shift, employee_id
 * }
 * Response: { success: bool, queued: bool }
 *
 * If the scale is offline, Laravel queues the push and retries every 10s.
 *
 * @param {string} machineId
 * @param {{
 *   order_id: string,
 *   product_name: string,
 *   target_weight: number,
 *   qty_target: number,
 *   qty_good: number,
 *   qty_remaining: number,
 *   shift: string,
 *   employee_id: string,
 * }} payload
 */
export const pushToScale = (machineId, payload) =>
  post(`/push-to-scale/${encodeURIComponent(machineId)}`, payload);

/**
 * POST /api/production-monitor/session-confirm/{machineId}
 *
 * Called by ESP32 scale when operator presses D (confirm).
 * Laravel stores the confirmation and broadcasts SSE `session_confirmed` to
 * ALL connected browsers so they can mark the machine as "Live Monitoring Active".
 *
 * Request body: { shift: string, employee_id: string, confirmed_at: number (epoch ms) }
 * Response: { success: bool }
 *
 * @param {string} machineId
 * @param {{ shift: string, employee_id: string, confirmed_at: number }} payload
 */
export const storeScaleSessionConfirm = (machineId, payload) =>
  post(`/session-confirm/${encodeURIComponent(machineId)}`, payload);
