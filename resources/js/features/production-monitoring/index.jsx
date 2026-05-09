import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useLanguage } from '../../contexts/LanguageContext';
import { useTranslation } from '../../utils/translations';
import LanguageSwitcher from '../../components/LanguageSwitcher';
import {
  queueLedCommand,
  LED_BREAKDOWN_PAYLOAD,
  LED_PREP_PAYLOAD,
  buildProductionLedCommand,
  storeScaleLive,
  storeMachineSession,
  fetchAllMachineSessions,
  logWeightEvent,
  appendMachineLog,
  fetchDailyPlan,
} from './api/productionApi';
import { useRealtimeSync } from './hooks/useRealtimeSync';
import { SSE_EVENTS } from './SSE_EVENTS';

// ─── withRetry — retry async fn สูงสุด N ครั้ง ด้วย delay แบบ linear backoff ──
const withRetry = async (fn, retries = 3, baseDelayMs = 1500) => {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === retries - 1) throw err;
      await new Promise((r) => setTimeout(r, baseDelayMs * (attempt + 1)));
    }
  }
};

// ─── Machine Log helpers ──────────────────────────────────────────────────────
function _fmtDateForLog(d = new Date()) {
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

function _fmtTimeForLog(d = new Date()) {
  const h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')}:00 ${ampm}`;
}

/**
 * ส่ง log สถานะ "เปิด" เมื่อกด Start Now — fire-and-forget
 */
function logStartNow({ machineId, machineLabel, productCode, shift }) {
  const now = new Date();
  appendMachineLog({
    machine:     machineLabel || machineId,
    date:        _fmtDateForLog(now),
    status:      'เปิด ဖွင့်သည်။',
    time:        _fmtTimeForLog(now),
    cause:       'เดินตามแผน အစီအစဉ်အတိုင်း ထုတ်လုပ်မှု',
    team:        shift ?? '',
    reporter:    'อัตโนมัติ',
    productCode: productCode ?? '',
    detail:      '',
    fix:         '',
  }).catch((err) => {
    console.warn('[StartNow] appendMachineLog failed (non-critical):', err?.message ?? err);
  });
}

/**
 * ส่ง log สถานะ "อยู่ระหว่างเตรียมการผลิต" เมื่อกด Pause Order / Finished Order — fire-and-forget
 */
function logPauseOrClose({ machineLabel, productCode, shift }) {
  const now = new Date();
  appendMachineLog({
    machine:     machineLabel || '',
    date:        _fmtDateForLog(now),
    status:      'อยู่ระหว่างเตรียมการผลิต',
    time:        _fmtTimeForLog(now),
    cause:       'ออเดอร์ครบ / รอออเดอร์ အော်ဒါဖြည့်ဆည်း',
    team:        shift ?? '',
    reporter:    'อัตโนมัติ',
    productCode: productCode ?? '',
    detail:      '',
    fix:         '',
  }).catch((err) => {
    console.warn('[PauseOrClose] appendMachineLog failed (non-critical):', err?.message ?? err);
  });
}
import MachineSidebar from './components/MachineSidebar';
import SetupMode from './components/SetupMode';
import LiveMonitoring from './components/LiveMonitoring';
import HistoryView from './components/HistoryView';
import ProductionPlanView from './components/ProductionPlanView';
import DashboardView from './components/DashboardView';
import LedSignView from './components/LedSignView';
import { useProductionStates } from './hooks/useProductionStates';
import { useMachineSettings } from './hooks/useMachineSettings';
import { useProductionPlan } from './hooks/useProductionPlan';
import ScheduleView from './components/ScheduleView';

// ─── Sub-components ────────────────────────────────────────────────────────────

const SpinnerIcon = ({ className = 'w-4 h-4' }) => (
  <svg className={`${className} animate-spin`} fill="none" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
  </svg>
);

/** Full-area loading splash shown on first fetch */
const LoadingSplash = () => {
  const { language } = useLanguage();
  const { t } = useTranslation(language);
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 text-gray-500">
      <SpinnerIcon className="w-8 h-8 text-cyan-500" />
      <p className="text-sm">{t('production.loadingMachines')}</p>
    </div>
  );
};

/** Full-area error state shown when first fetch fails and no machines are cached */
const ErrorSplash = ({ message, raw, onRetry }) => {
  const [showRaw, setShowRaw] = React.useState(false);
  const { language } = useLanguage();
  const { t } = useTranslation(language);

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-5 px-8 py-10 text-center overflow-y-auto">
      {/* Icon */}
      <div className="w-14 h-14 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center flex-shrink-0">
        <svg className="w-7 h-7 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
      </div>

      {/* Title + message */}
      <div className="max-w-md">
        <p className="text-base font-semibold text-red-300 mb-2">{t('production.errorTitle')}</p>
        <p className="text-sm text-gray-400 leading-relaxed">{message}</p>
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap items-center justify-center gap-3">
        <button
          onClick={onRetry}
          className="flex items-center gap-2 text-sm font-semibold text-cyan-400 hover:text-cyan-200 border border-cyan-500/40 hover:border-cyan-400 px-4 py-2 rounded-lg transition-all"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          {t('production.retry')}
        </button>

        <a
          href="/api/production-monitor/debug"
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 text-sm font-semibold text-amber-400 hover:text-amber-200 border border-amber-500/40 hover:border-amber-400 px-4 py-2 rounded-lg transition-all"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
            />
          </svg>
          {t('production.openDebug')}
        </a>
      </div>

      {/* Fix hint */}
      <div className="max-w-md bg-gray-800/60 border border-gray-700/50 rounded-xl p-4 text-left">
        <p className="text-xs font-semibold text-gray-300 mb-2">{t('production.howToFix')}</p>
        <ol className="text-xs text-gray-500 space-y-1.5 list-decimal list-inside">
          <li>เปิด Google Apps Script ของคุณ</li>
          <li>เพิ่ม function <code className="text-cyan-400 bg-gray-900 px-1 rounded">doGet(e)</code> ที่ return JSON จาก Settings sheet</li>
          <li>Deploy ใหม่เป็น Web App (Execute as: Me, Access: Anyone)</li>
          <li>กด <span className="text-cyan-400">Retry</span> หรือ <span className="text-amber-400">Open Debug Info</span> เพื่อตรวจสอบ</li>
        </ol>
        <pre className="mt-3 text-[10px] text-green-400 bg-gray-950 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap leading-relaxed">
{`function doGet(e) {
  var action = e.parameter.action;
  if (action === 'getSettings') {
    var sheet = SpreadsheetApp.getActiveSpreadsheet()
                  .getSheetByName('Settings');
    var rows  = sheet.getDataRange().getValues();
    var keys  = rows[0];
    var data  = rows.slice(1).map(function(row) {
      var obj = {};
      keys.forEach(function(k, i) { obj[k] = row[i]; });
      return obj;
    });
    return ContentService
      .createTextOutput(JSON.stringify(data))
      .setMimeType(ContentService.MimeType.JSON);
  }
  return ContentService
    .createTextOutput(JSON.stringify({ error: 'unknown action' }))
    .setMimeType(ContentService.MimeType.JSON);
}`}
        </pre>
      </div>

      {/* Collapsible raw GAS response */}
      {raw && (
        <div className="max-w-2xl w-full">
          <button
            onClick={() => setShowRaw((v) => !v)}
            className="flex items-center gap-2 text-xs text-gray-500 hover:text-gray-300 transition mb-2"
          >
            <svg
              className={`w-3.5 h-3.5 transition-transform ${showRaw ? 'rotate-90' : ''}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            {showRaw ? t('production.hideRaw') : t('production.showRaw')}
          </button>
          {showRaw && (
            <pre className="text-[10px] text-gray-500 bg-gray-900 border border-gray-700/50 rounded-xl p-4 text-left overflow-x-auto max-h-48 whitespace-pre-wrap break-all">
              {raw}
            </pre>
          )}
        </div>
      )}
    </div>
  );
};

// ─── Mobile sidebar drawer wrapper ─────────────────────────────────────────────

const SidebarDrawer = ({ open, onClose, children }) => (
  <>
    {/* Backdrop (mobile only) */}
    <div
      className={`fixed inset-0 z-30 bg-black/60 transition-opacity duration-300 md:hidden ${
        open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
      }`}
      onClick={onClose}
    />
    {/* Sidebar: fixed-left drawer on mobile, static inline on desktop */}
    <div className={[
      'fixed inset-y-0 left-0 z-40 transition-transform duration-300',
      'md:static md:inset-auto md:z-auto md:transform-none',
      open ? 'translate-x-0' : '-translate-x-full',
    ].join(' ')}>
      {children}
    </div>
  </>
);

// ─── Main component ────────────────────────────────────────────────────────────

const ProductionMonitoring = () => {
  const { machineId: urlLedMachineId } = useParams();
  const navigate = useNavigate();
  const isLedPage = Boolean(urlLedMachineId);
  const { language } = useLanguage();
  const { t } = useTranslation(language);

  const [sseStatus, setSseStatus] = useState('connecting'); // 'connecting' | 'open' | 'error' | 'closed'
  const [ledChangedMachineIds, setLedChangedMachineIds] = useState(new Set());

  const { machines, loading, syncing, error, errorRaw, lastSyncAt, refresh } = useMachineSettings();
  const {
    allStates,
    getMachineState,
    updateMachineState,
    resetMachineState,
    addToQueue,
    removeFromQueue,
    pauseOrder,
    resumeOrder,
    clearPausedOrder,
    mergeServerStates,
  } = useProductionStates();

  const [selectedMachineId, setSelectedMachineId] = useState(null);
  const [view, setView] = useState('machines'); // 'machines' | 'history' | 'plan' | 'dashboard'
  const [sidebarOpen, setSidebarOpen] = useState(false);

  /** ซิงค์จาก URL เฉพาะเมื่อ segment ใน URL เปลี่ยนจริง (ลิงก์แชร์ / กดปุ่มป้ายไฟ / browser back) — ไม่รันซ้ำทุกครั้งที่ `machines` เป็น array ใหม่ */
  const lastLedUrlSegmentRef = useRef(undefined);

  // เลือกเครื่องจาก sidebar: บนหน้า LED อัปเดต URL ที่นี่เท่านั้น — ห้ามใช้ useEffect + navigate วนกับ state (ทำให้ browser throttle navigation)
  const handleSelectMachine = useCallback(
    (id) => {
      setSelectedMachineId(id);
      setSidebarOpen(false); // ปิด drawer หลังเลือกบน mobile
      if (isLedPage) {
        navigate(`/production-monitoring/led-sign/${encodeURIComponent(id)}`, { replace: true });
      }
    },
    [isLedPage, navigate]
  );

  // Auto-select first machine once the list loads (ยกเว้นตอนเปิดจากลิงก์ /led-sign/:id)
  useEffect(() => {
    if (machines.length > 0 && selectedMachineId === null) {
      if (urlLedMachineId) return;
      setSelectedMachineId(machines[0].id);
    }
  }, [machines, selectedMachineId, urlLedMachineId]);

  // /led-sign/:machineId → เลือกเครื่องตาม URL (เมื่อ URL segment หรือรายการเครื่องพร้อมใช้งาน)
  useEffect(() => {
    if (!urlLedMachineId) {
      lastLedUrlSegmentRef.current = undefined;
      return;
    }
    if (machines.length === 0) return;
    const found = machines.find((m) => m.id === urlLedMachineId);
    if (!found) return;
    if (lastLedUrlSegmentRef.current === urlLedMachineId) return;
    lastLedUrlSegmentRef.current = urlLedMachineId;
    setSelectedMachineId(found.id);
  }, [urlLedMachineId, machines]);

  // machineId ใน URL ไม่มีในรายการ → ใช้เครื่องแรก
  useEffect(() => {
    if (!urlLedMachineId || machines.length === 0) return;
    const found = machines.find((m) => m.id === urlLedMachineId);
    if (!found) {
      navigate(`/production-monitoring/led-sign/${encodeURIComponent(machines[0].id)}`, { replace: true });
    }
  }, [urlLedMachineId, machines, navigate]);

  // Prefetch plan data in background as soon as a machine is selected.
  // Data is cached module-level, so switching tabs shows it instantly.
  const planData = useProductionPlan({ machineId: selectedMachineId });

  const selectedMachine = machines.find((m) => m.id === selectedMachineId) ?? null;
  const machineState = selectedMachineId ? getMachineState(selectedMachineId) : null;
  const isLive = machineState?.mode === 'live';

  const liveCount = Object.values(allStates).filter((s) => s?.mode === 'live').length;

  /** สร้าง payload สำหรับ scale-live — ถ้า live=true แนบข้อมูล session เต็ม */
  const buildScaleLivePayload = useCallback((machineId, isLive) => {
    if (!isLive) return { live: false };
    const st = getMachineState(machineId);
    return {
      live:         true,
      orderId:      st.orderId      ?? '',
      productCode:  st.productCode  ?? '',
      productName:  st.productName  ?? '',
      targetQty:    st.targetQty    ?? 0,
      shift:        st.shift        ?? '',
      employeeId:   st.employeeId   ?? '',
      sheetName:    st.sheetName    ?? '',
      // Bug 2 fix: ส่ง pipeCounter เพื่อให้ตาชั่ง restore ยอดนับที่ถูกต้องหลัง reboot
      pipeCounter:  st.pipeCounter  ?? 0,
      // ข้อมูลผลิตภัณฑ์สำหรับแสดง LCD บนตาชั่ง
      stdWeight:   st.stdWeight   ?? 0,
      minWeight:   st.minWeight   ?? 0,
      maxWeight:   st.maxWeight   ?? 0,
      productLen:  st.length      ?? 0,
    };
  }, [getMachineState]);

  /** Sync Live ↔ Laravel cache — ตาชั่ง ESP32 poll เพื่อ restore session หลัง reboot / WiFi หลุด */
  const scaleLivePrevRef = useRef({});
  const scaleLiveHydratedRef = useRef(false);

  // ── logWeightEvent retry queue — flush ทุก 20 วินาที ──────────────────────
  // เมื่อ GAS timeout/fail ระหว่างผลิต event จะถูกเก็บไว้แล้ว retry อัตโนมัติ
  const weightRetryQueueRef = useRef([]); // [{ params, attempts }]
  useEffect(() => {
    const id = setInterval(async () => {
      if (weightRetryQueueRef.current.length === 0) return;
      const batch = weightRetryQueueRef.current.splice(0); // drain queue
      for (const item of batch) {
        try {
          await logWeightEvent(item.params);
        } catch {
          if (item.attempts < 4) {
            weightRetryQueueRef.current.push({ ...item, attempts: item.attempts + 1 });
          } else {
            console.warn('[logWeightEvent] dropped after max retries:', item.params);
          }
        }
      }
    }, 20_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    Object.entries(allStates).forEach(([mid, st]) => {
      const live = Boolean(st?.mode === 'live');
      const prev = scaleLivePrevRef.current[mid];
      if (prev === undefined) {
        scaleLivePrevRef.current[mid] = live;
        return;
      }
      if (prev === live) return;
      scaleLivePrevRef.current[mid] = live;
      // retry 3 ครั้ง — ตาชั่ง poll ก่อน cache ถูก set ทำให้ session ไม่ restore
      withRetry(() => storeScaleLive(mid, buildScaleLivePayload(mid, live)))
        .catch((err) => console.warn('[scaleLive] sync failed after retries:', mid, err?.message));
    });
  }, [allStates, buildScaleLivePayload]);

  useEffect(() => {
    if (scaleLiveHydratedRef.current || machines.length === 0) return;
    const t = setTimeout(() => {
      if (scaleLiveHydratedRef.current) return;
      scaleLiveHydratedRef.current = true;
      Object.entries(allStates).forEach(([mid, st]) => {
        const live = Boolean(st?.mode === 'live');
        scaleLivePrevRef.current[mid] = live;
        withRetry(() => storeScaleLive(mid, buildScaleLivePayload(mid, live)))
          .catch((err) => console.warn('[scaleLive] hydration failed after retries:', mid, err?.message));
      });
    }, 1200);
    return () => clearTimeout(t);
  }, [machines.length, allStates, buildScaleLivePayload]);

  // ── Shared State Sync ─────────────────────────────────────────────────────────
  // SSE (real-time push) replaces polling.
  // Fallback poll at 15s handles edge-cases where SSE misses an event.

  // sessionSyncTsRef เก็บ _ts ล่าสุดที่ sync ขึ้น server
  // เพื่อป้องกัน sync loop: SSE push → merge → allStates เปลี่ยน → push กลับ → ∞
  const sessionSyncTsRef = useRef({});

  const allStatesRef = useRef(allStates);
  useEffect(() => { allStatesRef.current = allStates; }, [allStates]);

  // Dedup tracker for scale_weight events received via SSE
  // (each browser has its own seen-set — server keeps all events, clients dedup locally)
  const seenScaleEventsRef = useRef(new Set());

  const mergeServerStatesRef = useRef(mergeServerStates);
  useEffect(() => { mergeServerStatesRef.current = mergeServerStates; }, [mergeServerStates]);

  // Push local changes to server (debounced 600ms per machine)
  const pushDebounceRef = useRef({});
  useEffect(() => {
    Object.entries(allStates).forEach(([mid, st]) => {
      const ts = st?._ts ?? 0;
      if (!ts || ts === sessionSyncTsRef.current[mid]) return;
      sessionSyncTsRef.current[mid] = ts;
      if (pushDebounceRef.current[mid]) clearTimeout(pushDebounceRef.current[mid]);
      pushDebounceRef.current[mid] = setTimeout(() => {
        storeMachineSession(mid, allStatesRef.current[mid] ?? st)
          .catch((err) => console.warn('[machineSession] sync failed:', mid, err?.message));
      }, 600);
    });
  }, [allStates]);

  // SSE handler for machine_session events (push from other browsers/devices)
  const handleSseMachineSession = useCallback(({ machineId, state }) => {
    if (!machineId || !state) return;
    const serverTs = Number(state._ts) || 0;
    const localTs  = Number(allStatesRef.current[machineId]?._ts) || 0;
    if (serverTs > localTs) {
      sessionSyncTsRef.current[machineId] = serverTs;
      mergeServerStatesRef.current({ [machineId]: state });
    }
  }, []);

  // SSE handler for production_updated — after weight event GAS write completes
  // Updates machine state immediately without waiting for the 15s polling cycle.
  const handleSseProductionUpdated = useCallback(({ machineId, qty_good, qty_remaining, total_weight, _ts }) => {
    if (!machineId) return;
    const ts = Number(_ts) || 0;
    const localTs = Number(allStatesRef.current[machineId]?._ts) || 0;
    if (ts > 0 && ts <= localTs) return; // already up-to-date

    updateMachineState(machineId, (prev) => {
      const patch = {};
      if (typeof qty_good === 'number' && qty_good > (prev.pipeCounter ?? 0)) {
        patch.pipeCounter = qty_good;
      }
      if (typeof qty_remaining === 'number' && qty_remaining >= 0) {
        patch.remainingQty = qty_remaining;
      }
      if (typeof total_weight === 'number' && total_weight > (prev.totalGoodWeight ?? 0)) {
        patch.totalGoodWeight = total_weight;
      }
      return patch;
    });

    if (ts > 0) sessionSyncTsRef.current[machineId] = ts;

    // Dispatch so LedSignView can re-push LED without polling
    window.dispatchEvent(new CustomEvent('sse:production_updated', {
      detail: { machineId, qty_good, qty_remaining, total_weight, _ts: ts },
    }));
  }, [updateMachineState]);

  // SSE handler for session_confirmed — ESP32 operator confirmed shift + employee ID
  const handleSseSessionConfirmed = useCallback(({ machineId, shift, employee_id, confirmed_at }) => {
    if (!machineId) return;
    // Mark machine as live if it was in setup mode waiting for scale confirmation
    const current = allStatesRef.current[machineId];
    if (current?.mode === 'live') {
      // Already live — just sync shift/employee_id if different
      if (shift || employee_id) {
        updateMachineState(machineId, {
          shift:      shift      ?? current.shift,
          employeeId: employee_id ?? current.employeeId,
        });
      }
    }
    // Dispatch so LiveMonitoring can react (show badge / switch to live mode)
    window.dispatchEvent(new CustomEvent('sse:session_confirmed', {
      detail: { machineId, shift, employee_id, confirmed_at },
    }));
    // Notify sidebar for machines not currently viewed
    if (machineId !== selectedMachineId) {
      window.dispatchEvent(new CustomEvent('sse:session_confirmed_other', {
        detail: { machineId },
      }));
    }
  }, [updateMachineState, selectedMachineId]);

  // SSE handler for scale_weight events (real-time weight from scale ESP32)
  const handleSseScaleWeight = useCallback(({ machineId, event: ev }) => {
    if (!machineId || !ev) return;
    const dedupKey = (ev.pressedAt || '') + '_' + (ev.weight || '') + '_' + (ev.type || '');
    if (seenScaleEventsRef.current.has(dedupKey)) return;
    seenScaleEventsRef.current.add(dedupKey);
    window.dispatchEvent(new CustomEvent('sse:scale_weight', {
      detail: { machineId, event: ev },
    }));
  }, []);

  // SSE handler for led_updated — another browser changed LED config
  const handleSseLedUpdated = useCallback(({ machineId }) => {
    if (!machineId || machineId === selectedMachineId) return;
    // Show a subtle indicator in the sidebar for that machine
    setLedChangedMachineIds((prev) => {
      if (prev.has(machineId)) return prev;
      const next = new Set(prev);
      next.add(machineId);
      return next;
    });
  }, [selectedMachineId]);

  // On reconnect — re-fetch state snapshot to fill the gap during disconnection
  const handleSseReconnect = useCallback(async () => {
    try {
      const data = await fetchAllMachineSessions();
      if (!data?.sessions) return;
      Object.entries(data.sessions).forEach(([mid, serverState]) => {
        const serverTs = Number(serverState?._ts) || 0;
        if (serverTs > 0) sessionSyncTsRef.current[mid] = serverTs;
      });
      mergeServerStatesRef.current(data.sessions);
    } catch { /* network error — polling will catch up */ }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Attach SSE — real-time push for all events
  useRealtimeSync({
    onMachineSession:    handleSseMachineSession,
    onScaleWeight:       handleSseScaleWeight,
    onProductionUpdated: handleSseProductionUpdated,
    onSessionConfirmed:  handleSseSessionConfirmed,
    onLedUpdated:        handleSseLedUpdated,
    onStatusChange:      setSseStatus,
    onReconnect:         handleSseReconnect,
    // LED state is handled inside LedSignView directly
  });

  // Clear LED changed badge when user selects that machine
  useEffect(() => {
    if (!selectedMachineId) return;
    setLedChangedMachineIds((prev) => {
      if (!prev.has(selectedMachineId)) return prev;
      const next = new Set(prev);
      next.delete(selectedMachineId);
      return next;
    });
  }, [selectedMachineId]);

  // Fallback poll every 15s — catches any events SSE may have missed
  // (e.g. server restart, browser wake from sleep, SSE gap during reconnect)
  useEffect(() => {
    const doFallbackPoll = async () => {
      try {
        const data = await fetchAllMachineSessions();
        if (!data?.sessions) return;

        Object.entries(data.sessions).forEach(([mid, serverState]) => {
          const serverTs = Number(serverState?._ts) || 0;
          const localTs  = Number(allStatesRef.current[mid]?._ts) || 0;
          if (serverTs > localTs) {
            sessionSyncTsRef.current[mid] = serverTs;
          }
        });

        mergeServerStatesRef.current(data.sessions);
      } catch { /* network error — ignore */ }
    };

    // Initial load (state starts empty — must populate from server)
    doFallbackPoll();

    const id = setInterval(doFallbackPoll, 15_000);
    return () => clearInterval(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-fetch remainingQty จาก Daily Plan เมื่อ remainingQty = 0 ───────────
  // กรณี production ถูก start ก่อน remainingQty feature พร้อมใช้งาน
  // หรือถูก start จาก queue ที่ไม่มีข้อมูล remaining → ดึงจาก GAS แทน
  const remainingFetchedRef = useRef({});
  useEffect(() => {
    Object.entries(allStates).forEach(([mid, st]) => {
      if (st?.mode !== 'live') return;
      if ((st.remainingQty ?? 0) > 0) return;   // มีแล้ว ไม่ต้อง fetch
      if (!st.orderId) return;
      if (remainingFetchedRef.current[mid] === st.orderId) return; // fetch ไปแล้ว
      remainingFetchedRef.current[mid] = st.orderId;

      fetchDailyPlan({ machine: mid, jobNo: st.orderId })
        .then((rows) => {
          const row = Array.isArray(rows)
            ? rows.find((r) => String(r.jobNo ?? r.orderId ?? '').trim() === String(st.orderId).trim())
            : null;
          const remaining = Number(row?.remaining ?? row?.remainingQty ?? 0);
          if (remaining > 0) {
            updateMachineState(mid, { remainingQty: remaining });
            // ส่ง LED command ใหม่ทันทีด้วย remainingQty ที่ถูกต้อง
            const updatedState = { ...st, remainingQty: remaining };
            const cmd = buildProductionLedCommand(updatedState, updatedState.pipeCounter ?? 0);
            if (cmd) {
              queueLedCommand(mid, cmd).catch(() => {});
              // อนุญาตให้ ledRequeueRef re-queue ได้อีกครั้งด้วยค่าใหม่
              ledRequeueRef.current[mid] = false;
            }
          }
        })
        .catch(() => {});
    });
  }, [allStates, updateMachineState]);

  // ── Fix ปัญหา LED แสดง เป้า/กะ แทน ค้างผลิต ────────────────────────────────
  // เมื่อเปิดหน้าป้ายไฟ และเครื่องอยู่ในโหมด live พร้อม remainingQty
  // re-queue LED command เพื่ออัปเดต target บนป้ายให้ถูกต้อง
  const ledRequeueRef = useRef({});
  useEffect(() => {
    if (!isLedPage || !selectedMachineId) return;
    const st = getMachineState(selectedMachineId);
    if (st?.mode !== 'live') return;
    const alreadyRequested = ledRequeueRef.current[selectedMachineId];
    if (alreadyRequested) return;
    ledRequeueRef.current[selectedMachineId] = true;
    const cmd = buildProductionLedCommand(st, st.pipeCounter ?? 0);
    if (cmd) {
      queueLedCommand(selectedMachineId, cmd)
        .catch(() => { ledRequeueRef.current[selectedMachineId] = false; });
    }
  }, [isLedPage, selectedMachineId, getMachineState]);

  /** ส่งป้าย "เตรียมการ" เมื่อ Pause / Finished Order */
  const pushPrepLed = useCallback((machineId) => {
    if (!machineId) return;
    queueLedCommand(machineId, LED_PREP_PAYLOAD).catch(() => {});
  }, []);

  /** Pause จาก Live Monitor → setup + ป้าย "เตรียมการ" */
  const pauseLiveToSetup = useCallback(
    (machineId, nextItem = null) => {
      pauseOrder(machineId, nextItem);
      if (!nextItem) pushPrepLed(machineId);
    },
    [pauseOrder, pushPrepLed]
  );

  const queueProductionLedForMachine = useCallback((machineId, orderLike, pipeCounter) => {
    const cmd = buildProductionLedCommand(orderLike, pipeCounter);
    if (!cmd || !machineId) return Promise.resolve();
    return queueLedCommand(machineId, cmd);
  }, []);

  const resumeOrderWithLed = useCallback(
    async (machineId) => {
      const paused = getMachineState(machineId)?.pausedOrder;
      resumeOrder(machineId);
      if (!paused) return;
      try {
        await queueProductionLedForMachine(machineId, paused, paused.pipeCounter ?? 0);
      } catch {
        /* ignore */
      }
    },
    [getMachineState, resumeOrder, queueProductionLedForMachine]
  );

  // Map ของ items ที่อยู่ในคิวแล้ว: `${machineId}::${orderId}` → { machineId, queueId }
  const queuedMap = useMemo(() => {
    const map = new Map();
    Object.entries(allStates).forEach(([mid, state]) => {
      (state?.queue ?? []).forEach((item) => {
        map.set(`${mid}::${item.orderId}`, { machineId: mid, queueId: item.queueId });
      });
    });
    return map;
  }, [allStates]);

  // Dashboard renders full-screen, replacing the normal layout entirely
  if (view === 'dashboard') {
    return (
      <DashboardView
        machines={machines}
        allStates={allStates}
        getMachineState={getMachineState}
        lastSyncAt={lastSyncAt}
        onClose={() => {
          navigate('/production-monitoring');
          setView('machines');
        }}
      />
    );
  }

  // views ที่แสดง sidebar
  const hasSidebar = isLedPage || view === 'plan' || view === 'machines';

  return (
    <div className="flex flex-col h-[100dvh] bg-gray-950 text-white overflow-hidden">

      {/* ── Top bar ───────────────────────────────────────────────────────── */}
      <header className="flex-shrink-0 bg-gray-900 border-b border-gray-700/50">

        {/* ── Row 1: brand + hamburger + back ── */}
        <div className="h-12 sm:h-14 px-3 sm:px-5 flex items-center gap-2">
          {/* Hamburger — mobile only */}
          {hasSidebar && (
            <button
              onClick={() => setSidebarOpen((v) => !v)}
              className="md:hidden flex-shrink-0 p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
              aria-label={t('production.ariaToggleMachineList')}
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
          )}

          {/* Brand */}
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <svg className="w-5 h-5 text-cyan-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
              />
            </svg>
            <span className="font-bold text-white tracking-tight text-sm truncate">{t('production.title')}</span>
            <span className="text-sm text-gray-500 hidden lg:block flex-shrink-0">· {t('production.subtitle')}</span>
          </div>

          {/* Right: active count (desktop) + SSE status + language switcher + back */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* SSE connection status badge */}
            <div className="hidden sm:flex items-center gap-1.5 px-2 py-1 rounded-lg border text-[11px] font-semibold flex-shrink-0"
              style={{
                background:   sseStatus === 'open'       ? 'rgba(34,197,94,0.07)'  : sseStatus === 'connecting' ? 'rgba(251,191,36,0.07)'  : 'rgba(239,68,68,0.07)',
                borderColor:  sseStatus === 'open'       ? 'rgba(34,197,94,0.3)'   : sseStatus === 'connecting' ? 'rgba(251,191,36,0.3)'   : 'rgba(239,68,68,0.3)',
                color:        sseStatus === 'open'       ? '#4ade80'               : sseStatus === 'connecting' ? '#fbbf24'                : '#f87171',
              }}
            >
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                sseStatus === 'open'       ? 'bg-green-400'
                : sseStatus === 'connecting' ? 'bg-yellow-400 animate-pulse'
                : 'bg-red-400 animate-pulse'
              }`} />
              {sseStatus === 'open' ? 'Live' : sseStatus === 'connecting' ? 'Reconnecting…' : 'Offline'}
            </div>

            {!loading && machines.length > 0 && (
              <div className="hidden sm:flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                <span className="text-xs text-gray-400">{liveCount}/{machines.length}</span>
                {/* Sync (อยู่กับ HDPE Lines x/x) */}
                <button
                  onClick={refresh}
                  disabled={syncing || loading}
                  title={t('production.titleRefetchMachines')}
                  className="flex-shrink-0 flex items-center gap-1.5 text-xs font-semibold text-cyan-400 hover:text-cyan-200 border border-cyan-500/30 hover:border-cyan-400/60 bg-cyan-500/5 hover:bg-cyan-500/10 px-2.5 py-1.5 rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
                >
                  {syncing ? <SpinnerIcon className="w-3.5 h-3.5" /> : (
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                      />
                    </svg>
                  )}
                  {syncing ? t('production.syncing') : t('production.sync')}
                </button>
              </div>
            )}
            {lastSyncAt && !syncing && (
              <span className="text-[11px] text-gray-600 hidden xl:block">
                {t('production.syncedAt')} {lastSyncAt.toLocaleTimeString()}
              </span>
            )}
            <div className="hidden sm:block">
              <LanguageSwitcher variant="dark" />
            </div>
            <a
              href="/"
              className="text-xs text-gray-500 hover:text-gray-200 transition px-2.5 py-1.5 rounded-lg border border-gray-700 hover:border-gray-500 whitespace-nowrap"
            >
              {t('production.back')}
            </a>
          </div>
        </div>

        {/* ── Row 2: nav tabs — always visible, scrollable ── */}
        <div className="flex items-center gap-1.5 px-3 sm:px-5 pb-2 overflow-x-auto scrollbar-none">
          {/* LED Sign */}
          <button
            onClick={() => {
              if (isLedPage) {
                navigate('/production-monitoring');
                return;
              }
              const id = selectedMachineId || machines[0]?.id;
              if (id) navigate(`/production-monitoring/led-sign/${encodeURIComponent(id)}`);
            }}
            title={t('production.titleLedControl')}
            className={`flex-shrink-0 flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg transition-all border whitespace-nowrap ${
              isLedPage
                ? 'text-indigo-200 border-indigo-500/50 bg-indigo-500/15'
                : 'border-gray-700 text-gray-500 hover:text-gray-200 hover:border-gray-500 bg-gray-900/10 hover:bg-gray-900/20'
            }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
              />
            </svg>
            {t('production.ledSign')}
          </button>

          {/* Dashboard */}
          <button
            onClick={() => { navigate('/production-monitoring'); setView((v) => (v === 'dashboard' ? 'machines' : 'dashboard')); }}
            className={`flex-shrink-0 flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg border transition-all whitespace-nowrap ${
              view === 'dashboard' ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300' : 'border-gray-700 text-gray-500 hover:text-gray-200 hover:border-gray-500'
            }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
            </svg>
            {t('production.dashboard')}
          </button>

          {/* Plan */}
          <button
            onClick={() => { navigate('/production-monitoring'); setView((v) => (v === 'plan' ? 'machines' : 'plan')); }}
            className={`flex-shrink-0 flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg border transition-all whitespace-nowrap ${
              view === 'plan' ? 'bg-amber-500/20 border-amber-500/50 text-amber-300' : 'border-gray-700 text-gray-500 hover:text-gray-200 hover:border-gray-500'
            }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
            </svg>
            {t('production.plan')}
          </button>

          {/* Schedule — cross-machine daily plan */}
          <button
            onClick={() => { navigate('/production-monitoring'); setView((v) => (v === 'schedule' ? 'machines' : 'schedule')); }}
            className={`flex-shrink-0 flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg border transition-all whitespace-nowrap ${
              view === 'schedule' ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300' : 'border-gray-700 text-gray-500 hover:text-gray-200 hover:border-gray-500'
            }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            {t('production.schedule')}
          </button>

          {/* History */}
          <button
            onClick={() => { navigate('/production-monitoring'); setView((v) => (v === 'history' ? 'machines' : 'history')); }}
            className={`flex-shrink-0 flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg border transition-all whitespace-nowrap ${
              view === 'history' ? 'bg-purple-500/20 border-purple-500/50 text-purple-300' : 'border-gray-700 text-gray-500 hover:text-gray-200 hover:border-gray-500'
            }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
            </svg>
            {t('production.history')}
          </button>

          {/* Language switcher (mobile — shown inline in nav row) */}
          <div className="sm:hidden ml-auto">
            <LanguageSwitcher variant="dark" />
          </div>
        </div>
      </header>

      {/* ── Body ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* LED sign — หน้าเต็ม + ลิงก์แชร์ /production-monitoring/led-sign/:machineId */}
        {isLedPage && (
          <>
            <SidebarDrawer open={sidebarOpen} onClose={() => setSidebarOpen(false)}>
              <MachineSidebar
                machines={machines}
                selectedMachineId={selectedMachineId}
                onSelectMachine={handleSelectMachine}
                allStates={allStates}
                loading={loading}
                onClose={() => setSidebarOpen(false)}
                ledChangedMachineIds={ledChangedMachineIds}
              />
            </SidebarDrawer>
            <div className="flex-1 flex flex-col overflow-hidden min-w-0">
              {loading && <LoadingSplash />}
              {!loading && machines.length > 0 && (
                <LedSignView
                  machines={machines}
                  selectedMachineId={selectedMachineId}
                  allMachineStates={allStates}
                  onPauseOrder={(mid) => pauseOrder(mid)}
                  onResumeOrder={(mid) => resumeOrderWithLed(mid)}
                  onBack={() => navigate('/production-monitoring')}
                />
              )}
              {!loading && machines.length === 0 && (
                <div className="flex-1 flex items-center justify-center text-gray-600">
                  <p className="text-sm">{t('production.noMachinesFound')}</p>
                </div>
              )}
            </div>
          </>
        )}

        {/* History view (full width, replaces machine panel) */}
        {!isLedPage && view === 'history' && (
          <div className="flex-1 overflow-hidden flex flex-col bg-gray-900/20">
            <HistoryView machines={machines} />
          </div>
        )}

        {/* Schedule view — cross-machine daily production table (full width) */}
        {!isLedPage && view === 'schedule' && (
          <div className="flex-1 overflow-hidden flex flex-col bg-gray-900/20">
            {loading ? (
              <LoadingSplash />
            ) : (
              <ScheduleView
                machines={machines}
                queuedMap={queuedMap}
                onAddToQueue={(machineId, item) => {
                  const m = machines.find((mc) => mc.id === machineId);
                  addToQueue(machineId, {
                    ...item,
                    sheetName: item.sheetName || m?.sheetName || machineId,
                    ledIp:     item.ledIp     || m?.ledIp     || '',
                  });
                }}
                onRemoveFromQueue={removeFromQueue}
              />
            )}
          </div>
        )}

        {/* Plan view — sidebar + ProductionPlanView */}
        {!isLedPage && view === 'plan' && <>
          <SidebarDrawer open={sidebarOpen} onClose={() => setSidebarOpen(false)}>
            <MachineSidebar
              machines={machines}
              selectedMachineId={selectedMachineId}
              onSelectMachine={handleSelectMachine}
              allStates={allStates}
              loading={loading}
              onClose={() => setSidebarOpen(false)}
              ledChangedMachineIds={ledChangedMachineIds}
            />
          </SidebarDrawer>
          <div className="flex-1 flex flex-col overflow-hidden min-w-0">
            {loading && <LoadingSplash />}
            {!loading && machines.length > 0 && (
              <ProductionPlanView
                selectedMachine={selectedMachine}
                planData={planData}
              />
            )}
            {!loading && machines.length === 0 && (
              <div className="flex-1 flex items-center justify-center text-gray-600">
                <p className="text-sm">{t('production.noMachinesFound')}</p>
              </div>
            )}
          </div>
        </>}

        {/* Machine sidebar + content (hidden when history is active) */}
        {!isLedPage && view === 'machines' && <>
        <SidebarDrawer open={sidebarOpen} onClose={() => setSidebarOpen(false)}>
          <MachineSidebar
            machines={machines}
            selectedMachineId={selectedMachineId}
            onSelectMachine={handleSelectMachine}
            allStates={allStates}
            loading={loading}
            onClose={() => setSidebarOpen(false)}
            ledChangedMachineIds={ledChangedMachineIds}
          />
        </SidebarDrawer>

        {/* Main content panel */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">

          {/* ── Loading state (first fetch) ── */}
          {loading && <LoadingSplash />}

          {/* ── Error state (fetch failed, no machines available) ── */}
          {!loading && error && machines.length === 0 && (
            <ErrorSplash message={error} raw={errorRaw} onRetry={refresh} />
          )}

          {/* ── Soft error banner (re-sync failed but machines still cached) ── */}
          {!loading && error && machines.length > 0 && (
            <div className="flex-shrink-0 flex items-center gap-2.5 bg-amber-500/10 border-b border-amber-500/20 px-4 py-2.5 text-amber-300 text-xs">
              <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
              <span>
                {t('production.syncFailed')} <span className="font-mono">{error}</span> {t('production.showingLastKnown')}
              </span>
            </div>
          )}

          {/* ── Normal content (machines loaded) ── */}
          {!loading && machines.length > 0 && selectedMachine && machineState && (
            <>
              {/* Content sub-header */}
              <div className="flex-shrink-0 bg-gray-900/50 border-b border-gray-700/30 px-4 sm:px-6 md:px-8 py-3 flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-gray-300">
                    {selectedMachine.label}
                  </span>
                  <span
                    className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${
                      isLive
                        ? 'text-green-400 bg-green-400/10 border-green-400/30'
                        : 'text-gray-500 bg-gray-700/40 border-gray-600/40'
                    }`}
                  >
                    {isLive ? t('production.liveStatus') : t('production.setupStatus')}
                  </span>

                  {/* Zone badge */}
                  {selectedMachine.zone && (
                    <span className="flex items-center gap-1 text-[11px] font-mono text-gray-400 bg-gray-800/80 border border-gray-700/60 px-2 py-0.5 rounded-full">
                      <svg className="w-3 h-3 text-gray-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      {selectedMachine.zone}
                    </span>
                  )}

                  {/* Machine Status badge */}
                  {selectedMachine.status && (
                    <span
                      className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${
                        selectedMachine.status.toLowerCase() === 'unactive'
                          ? 'text-red-400 bg-red-500/10 border-red-500/30'
                          : 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30'
                      }`}
                    >
                      {selectedMachine.status.toLowerCase() === 'unactive' ? t('production.inactiveStatus') : t('production.activeStatus')}
                    </span>
                  )}
                </div>
                {isLive && (
                  <p className="text-xs text-gray-500 font-mono truncate max-w-[50%]">{machineState.productName}</p>
                )}
              </div>

              {/* Scrollable content */}
              <main className="flex-1 overflow-y-auto p-3 sm:p-5 lg:p-8">
                {isLive ? (
                  <LiveMonitoring
                    machineId={selectedMachineId}
                    machineLabel={selectedMachine.label}
                    machineState={machineState}
                    onWeightUpdate={(type, weight, ev) => {
                      // pressedAt = เวลากดปุ่มที่ตาชั่ง (จาก NTP ESP32)
                      const pressedAt = ev?.pressedAt ?? new Date().toISOString();
                      const entry = { weight, pressedAt };
                      const mid = selectedMachineId;
                      // snapshot ก่อน update — เพื่อคำนวณ seq ถูกต้อง
                      const snap = getMachineState(mid);
                      const seq  = (snap.pipeCounter ?? 0) + (snap.ngCount ?? 0) + 1;

                      if (type === 'good') {
                        updateMachineState(mid, (prev) => ({
                          pipeCounter:      (prev.pipeCounter      ?? 0) + 1,
                          totalGoodWeight:  (prev.totalGoodWeight  ?? 0) + weight,
                          lastGoodWeight:   weight,
                          lastGoodAt:       pressedAt,
                          goodEvents:       [...(prev.goodEvents ?? []), entry],
                        }));
                      } else {
                        updateMachineState(mid, (prev) => ({
                          ngCount:          (prev.ngCount          ?? 0) + 1,
                          totalNgWeight:    (prev.totalNgWeight    ?? 0) + weight,
                          lastNgWeight:     weight,
                          lastNgAt:         pressedAt,
                          ngEvents:         [...(prev.ngEvents ?? []), entry],
                        }));
                      }

                      // บันทึกรายการน้ำหนักลง GAS Sheet — retry ถ้า fail
                      if (snap.sheetName && snap.orderId) {
                        const evParams = {
                          machineId: mid,
                          sheetName: snap.sheetName,
                          orderId:   snap.orderId,
                          seq,
                          type,
                          weight,
                          pressedAt,
                        };
                        logWeightEvent(evParams).catch(() => {
                          // GAS timeout / ไม่ตอบ → เข้า retry queue, flush ทุก 20 วิ
                          weightRetryQueueRef.current.push({ params: evParams, attempts: 1 });
                        });
                      }
                    }}
                    onCloseOrder={() => {
                      pushPrepLed(selectedMachineId);
                      resetMachineState(selectedMachineId);
                      logPauseOrClose({
                        machineLabel: selectedMachine.label,
                        productCode:  machineState?.productCode ?? '',
                        shift:        machineState?.shift       ?? '',
                      });
                      // Push ทันที (bypass debounce) เพื่อให้ browser อื่นรับ Finish Order เร็วสุด
                      const mid = selectedMachineId;
                      if (pushDebounceRef.current[mid]) clearTimeout(pushDebounceRef.current[mid]);
                      setTimeout(() => {
                        storeMachineSession(mid, allStatesRef.current[mid])
                          .catch(() => {});
                      }, 50);
                    }}
                    onPauseOrder={() => {
                      pauseLiveToSetup(selectedMachineId);
                      logPauseOrClose({
                        machineLabel: selectedMachine.label,
                        productCode:  machineState?.productCode ?? '',
                        shift:        machineState?.shift       ?? '',
                      });
                    }}
                    onPauseAndStart={(item) => {
                      pauseLiveToSetup(selectedMachineId, {
                        ...item,
                        sheetName: item.sheetName ?? selectedMachine.sheetName,
                        ledIp:     item.ledIp     ?? selectedMachine.ledIp,
                      });
                      queueProductionLedForMachine(selectedMachineId, { ...item }, 0).catch(() => {});
                    }}
                    onAddToQueue={(item) => addToQueue(selectedMachineId, item)}
                    onCancelOrder={() => {
                      // ยกเลิกการผลิต — reset state ทันที ไม่บันทึกลง GAS
                      pushPrepLed(selectedMachineId);
                      resetMachineState(selectedMachineId);
                      const mid = selectedMachineId;
                      if (pushDebounceRef.current[mid]) clearTimeout(pushDebounceRef.current[mid]);
                      setTimeout(() => {
                        storeMachineSession(mid, allStatesRef.current[mid]).catch(() => {});
                      }, 50);
                    }}
                    onCloseAndStart={(item) => {
                      if (item.queueId) removeFromQueue(selectedMachineId, item.queueId);
                      updateMachineState(selectedMachineId, {
                        orderId:      item.orderId,
                        productCode:  item.productCode || '',
                        productName:  item.productName,
                        targetQty:    item.targetQty,
                        remainingQty: item.remainingQty ?? 0,
                        planDate:     item.planDate     ?? '',
                        sheetName:    item.sheetName ?? selectedMachine.sheetName,
                        ledIp:        item.ledIp     ?? selectedMachine.ledIp,
                        mode:         'live',
                        pipeCounter:  0,
                        lastWeight:   null,
                        lastWeightAt: null,
                        startedAt:    new Date().toISOString(),
                        pausedOrder:  null,
                      });
                      queueProductionLedForMachine(selectedMachineId, { ...item }, 0).catch(() => {});
                      logStartNow({
                        machineId:    selectedMachineId,
                        machineLabel: selectedMachine.label,
                        productCode:  item.productCode || '',
                        shift:        item.shift       || '',
                      });
                    }}
                  />
                ) : (
                  <SetupMode
                    machineId={selectedMachineId}
                    machineLabel={selectedMachine.label}
                    sheetName={selectedMachine.sheetName}
                    ledIp={selectedMachine.ledIp}
                    queue={machineState.queue ?? []}
                    pausedOrder={machineState.pausedOrder ?? null}
                    onAddToQueue={(item) => addToQueue(selectedMachineId, item)}
                    onRemoveFromQueue={(queueId) => removeFromQueue(selectedMachineId, queueId)}
                    onResumeOrder={() => { void resumeOrderWithLed(selectedMachineId); }}
                    onResumeWithScaleConfirm={(shift, employeeId) => {
                      const mid = selectedMachineId;
                      const paused = getMachineState(mid)?.pausedOrder;
                      resumeOrder(mid);
                      updateMachineState(mid, { shift: shift || '', employeeId: employeeId || '' });
                      if (paused) {
                        queueProductionLedForMachine(mid, paused, paused.pipeCounter ?? 0).catch(() => {});
                      }
                    }}
                    onClosePausedOrder={() => clearPausedOrder(selectedMachineId)}
                    onStartProduction={(data) => {
                      if (data.queueId) removeFromQueue(selectedMachineId, data.queueId);
                      updateMachineState(selectedMachineId, {
                        orderId:      data.orderId,
                        productCode:  data.productCode || '',
                        productName:  data.productName,
                        targetQty:    data.targetQty,
                        remainingQty: data.remainingQty ?? 0,
                        planDate:     data.planDate     ?? '',
                        sheetName:    data.sheetName,
                        ledIp:        data.ledIp,
                        shift:        data.shift      || '',
                        employeeId:   data.employeeId || '',
                        mode:         'live',
                        pipeCounter:  0,
                        lastWeight:   null,
                        lastWeightAt: null,
                        startedAt:    new Date().toISOString(),
                        // ข้อมูลจาก Sheet Product
                        peType:      data.peType      ?? '',
                        size:        data.size        ?? null,
                        length:      data.length      ?? null,
                        pn:          data.pn          ?? null,
                        brand:       data.brand       ?? '',
                        colorStripe: data.colorStripe ?? '',
                        stdWeight:   data.stdWeight   ?? null,
                        minWeight:   data.minWeight   ?? null,
                        maxWeight:   data.maxWeight   ?? null,
                      });
                      queueProductionLedForMachine(selectedMachineId, data, 0).catch(() => {});
                      logStartNow({
                        machineId:    selectedMachineId,
                        machineLabel: selectedMachine.label,
                        productCode:  data.productCode || '',
                        shift:        data.shift       || '',
                      });
                    }}
                  />
                )}
              </main>
            </>
          )}
        </div>
        </>}
      </div>
    </div>
  );
};

export default ProductionMonitoring;
