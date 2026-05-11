import { useState, useCallback } from 'react';

export const DEFAULT_MACHINE_STATE = {
  mode: 'setup',       // 'setup' | 'live'
  orderId: '',
  productCode: '',
  productName: '',
  targetQty: 0,
  remainingQty: 0,
  planDate: '',
  shift: '',
  employeeId: '',
  // ข้อมูลผลิตภัณฑ์จาก Sheet Product
  peType: '',
  size: null,
  length: null,
  pn: null,
  brand: '',
  colorStripe: '',
  stdWeight: null,
  minWeight: null,
  maxWeight: null,
  // Good item tracking (ของดี)
  pipeCounter: 0,       // = goodCount, used for progress bar
  totalGoodWeight: 0,
  lastGoodWeight: null,
  lastGoodAt: null,
  // NG item tracking (ของเสีย)
  ngCount: 0,
  totalNgWeight: 0,
  lastNgWeight: null,
  lastNgAt: null,
  startedAt: null,
  /** true เมื่อ DB status = awaiting_scale (รอยืนยันที่ตาชั่งหลัง Start Now) */
  waitingScale: false,
  // Stored at order-start so live actions work even if settings re-fetch fails
  sheetName: null,
  ledIp: null,
  // Pending orders waiting to be started
  queue: [],
  // Snapshot of a running order that was "paused" to let another order run first
  pausedOrder: null,
  // รายการน้ำหนักแต่ละรายการ (กดปุ่มตาชั่ง) — ใช้แสดง popup
  goodEvents: [],   // [{ weight, pressedAt, seq }]
  ngEvents:   [],   // [{ weight, pressedAt, seq }]
  // Timestamp ของ mutation ล่าสุด — ใช้ตัดสินว่า server หรือ local ใหม่กว่า
  _ts: 0,
  // Per Start Now run — aligns with Laravel production_sessions.session_run_ulid
  sessionRunUlid: null,
};

// State is server-only. localStorage has been removed as primary storage
// to ensure every device (PC, mobile, tablet) always reads the same truth.
// Initial state is loaded from /api/production-monitor/machine-sessions via
// mergeServerStates() called in index.jsx on mount.

/** สร้าง next state สำหรับ machine เดียว พร้อม timestamp */
const stamp = (machineState) => ({ ...machineState, _ts: Date.now() });

/**
 * Manages production state for all HDPE machines.
 * Single source of truth is the server (Laravel Cache via machine-sessions API).
 * State is initialised empty and populated by mergeServerStates() on mount.
 *
 * _ts (millisecond timestamp) บน state ของแต่ละเครื่องใช้ตัดสิน
 * ว่า server หรือ local เปลี่ยนล่าสุด เมื่อ mergeServerStates ถูกเรียก
 */
export const useProductionStates = () => {
  // Start empty — server state is merged in via useRealtimeSync / fetchAllMachineSessions
  const [allStates, setAllStates] = useState({});

  const getMachineState = useCallback(
    (machineId) => allStates[machineId] ?? { ...DEFAULT_MACHINE_STATE },
    [allStates],
  );

  /**
   * @param {string} machineId
   * @param {object | function} patch - plain object or updater fn (prev) => patch
   */
  const updateMachineState = useCallback((machineId, patch) => {
    setAllStates((prev) => {
      const current = prev[machineId] ?? { ...DEFAULT_MACHINE_STATE };
      const changes = typeof patch === 'function' ? patch(current) : patch;
      if (changes === null) return prev;
      return { ...prev, [machineId]: stamp({ ...current, ...changes }) };
    });
  }, []);

  /** Reset to setup mode, preserving queue and pausedOrder. */
  const resetMachineState = useCallback((machineId) => {
    setAllStates((prev) => {
      const current = prev[machineId] ?? { ...DEFAULT_MACHINE_STATE };
      return {
        ...prev,
        [machineId]: stamp({
          ...DEFAULT_MACHINE_STATE,
          queue:           current.queue           ?? [],
          pausedOrder:     current.pausedOrder      ?? null,
          // จำ orderId ที่เพิ่งปิด เพื่อกัน stale 'live' push จาก browser อื่น
          finishedOrderId: current.orderId          || null,
        }),
      };
    });
  }, []);

  // ── Queue management ─────────────────────────────────────────────────────────

  /** Append a new pending order to a machine's queue. */
  const addToQueue = useCallback((machineId, item) => {
    setAllStates((prev) => {
      const current = prev[machineId] ?? { ...DEFAULT_MACHINE_STATE };
      const entry = {
        ...item,
        // เคารพ queueId จาก caller (คิว DB / optimistic) — อย่าสุ่มทับ เดี๋ยว dedupe กับ SSE พัง
        queueId:
          item.queueId ??
          item.queue_id ??
          `q_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        addedAt: item.addedAt ?? new Date().toISOString(),
      };
      return {
        ...prev,
        [machineId]: stamp({ ...current, queue: [...(current.queue ?? []), entry] }),
      };
    });
  }, []);

  /** Remove a pending order from a machine's queue by its queueId. */
  const removeFromQueue = useCallback((machineId, queueId) => {
    setAllStates((prev) => {
      const current = prev[machineId] ?? { ...DEFAULT_MACHINE_STATE };
      return {
        ...prev,
        [machineId]: stamp({
          ...current,
          queue: (current.queue ?? []).filter((item) => item.queueId !== queueId),
        }),
      };
    });
  }, []);

  // ── Pause / Resume ───────────────────────────────────────────────────────────

  /**
   * Freeze the currently running order as pausedOrder and return to setup mode.
   * Optionally pass a queueItem to atomically start it as the new live order.
   *
   * @param {string} machineId
   * @param {{ orderId, productName, targetQty, sheetName, ledIp, queueId? }} [nextItem]
   *   If provided, the machine immediately transitions to live with nextItem.
   */
  const pauseOrder = useCallback((machineId, nextItem = null) => {
    setAllStates((prev) => {
      const current = prev[machineId] ?? { ...DEFAULT_MACHINE_STATE };
      if (current.mode !== 'live') return prev;

      const snapshot = {
        orderId:         current.orderId,
        productCode:     current.productCode,
        productName:     current.productName,
        targetQty:       current.targetQty,
        remainingQty:    current.remainingQty ?? 0,
        planDate:        current.planDate     ?? '',
        pipeCounter:     current.pipeCounter,
        totalGoodWeight: current.totalGoodWeight ?? 0,
        ngCount:         current.ngCount     ?? 0,
        totalNgWeight:   current.totalNgWeight ?? 0,
        goodEvents:      current.goodEvents  ?? [],
        ngEvents:        current.ngEvents    ?? [],
        lastWeight:      current.lastWeight,
        lastWeightAt:    current.lastWeightAt,
        startedAt:       current.startedAt,
        sheetName:       current.sheetName,
        ledIp:           current.ledIp,
        shift:           current.shift      ?? '',
        employeeId:      current.employeeId ?? '',
      };

      const newQueue = nextItem?.queueId
        ? (current.queue ?? []).filter((q) => q.queueId !== nextItem.queueId)
        : (current.queue ?? []);

      return {
        ...prev,
        [machineId]: stamp(nextItem
          ? {
              ...DEFAULT_MACHINE_STATE,
              mode:         'live',
              orderId:      nextItem.orderId,
              productCode:  nextItem.productCode || '',
              productName:  nextItem.productName,
              targetQty:    nextItem.targetQty,
              remainingQty: nextItem.remainingQty ?? 0,
              planDate:     nextItem.planDate     ?? '',
              pipeCounter:  0,
              lastWeight:   null,
              lastWeightAt: null,
              startedAt:    new Date().toISOString(),
              sheetName:    nextItem.sheetName,
              ledIp:        nextItem.ledIp,
              queue:        newQueue,
              pausedOrder:  snapshot,
            }
          : {
              ...DEFAULT_MACHINE_STATE,
              queue:       current.queue ?? [],
              pausedOrder: snapshot,
            }),
      };
    });
  }, []);

  /** Restore a paused order back to live mode. */
  const resumeOrder = useCallback((machineId) => {
    setAllStates((prev) => {
      const current = prev[machineId] ?? { ...DEFAULT_MACHINE_STATE };
      if (!current.pausedOrder) return prev;
      const p = current.pausedOrder;
      return {
        ...prev,
        [machineId]: stamp({
          ...current,
          ...p,
          mode:        'live',
          pausedOrder: null,
          goodEvents:  p.goodEvents  ?? current.goodEvents  ?? [],
          ngEvents:    p.ngEvents    ?? current.ngEvents    ?? [],
        }),
      };
    });
  }, []);

  /** Discard the paused order without resuming it (used after manually closing it). */
  const clearPausedOrder = useCallback((machineId) => {
    setAllStates((prev) => {
      const current = prev[machineId] ?? { ...DEFAULT_MACHINE_STATE };
      return { ...prev, [machineId]: stamp({ ...current, pausedOrder: null }) };
    });
  }, []);

  /**
   * รับ sessions จาก server แล้ว merge เข้า local state
   * กฎ: server state จะชนะถ้า server._ts > local._ts (server ใหม่กว่า)
   * goodEvents / ngEvents จะถูก preserve จาก local เสมอ (ไม่ sync ขึ้น server)
   *
   * @param {{ [machineId]: object }} sessions  — จาก fetchAllMachineSessions
   */
  const mergeServerStates = useCallback((sessions) => {
    if (!sessions || typeof sessions !== 'object') return;
    setAllStates((prev) => {
      let changed = false;
      const next = { ...prev };
      Object.entries(sessions).forEach(([mid, serverState]) => {
        if (!serverState || typeof serverState !== 'object') return;
        const localState = prev[mid];
        const serverTs = Number(serverState._ts) || 0;
        const localTs  = Number(localState?._ts)  || 0;

        const serverGood = Array.isArray(serverState.goodEvents) ? serverState.goodEvents : [];
        const localGood  = Array.isArray(localState?.goodEvents) ? localState.goodEvents  : [];
        const serverNg   = Array.isArray(serverState.ngEvents)   ? serverState.ngEvents   : [];
        const localNg    = Array.isArray(localState?.ngEvents)   ? localState.ngEvents    : [];
        const mergedGood = serverGood.length >= localGood.length ? serverGood : localGood;
        const mergedNg   = serverNg.length   >= localNg.length   ? serverNg   : localNg;

        // ── Rule 1: server ปิด/pause งาน → รับทันทีโดยไม่ดู _ts ────────────────
        // ป้องกัน browser อื่นที่ยัง 'live' push ทับ state ที่ปิดแล้ว
        if (serverState.mode !== 'live' && localState?.mode === 'live' && serverTs > 0) {
          next[mid] = {
            ...serverState,
            goodEvents: mergedGood,
            ngEvents:   mergedNg,
          };
          changed = true;
          return;
        }

        // ── Rule 2: local ปิดงานนี้แล้ว แต่ server ส่ง 'live' orderId เดิมมา ──
        // ป้องกัน stale push จาก browser ที่ยังไม่รู้ว่า Finish Order ไปแล้ว
        if (
          serverState.mode === 'live' &&
          localState?.finishedOrderId &&
          serverState.orderId === localState.finishedOrderId
        ) {
          return; // ไม่รับ — ถือว่างานปิดแล้ว
        }

        // ── Rule 3: LWW มาตรฐาน + counter ───────────────────────────────────────
        if (serverTs <= localTs) return;

        // snapshot จาก production_sessions (_db) เป็นหลัก — อย่าทำ max กับเลขที่ GAS/UI ทำให้พอง
        const trustCounters = Boolean(serverState._db);
        const pipeCounter = trustCounters
          ? (serverState.pipeCounter ?? 0)
          : Math.max(serverState.pipeCounter ?? 0, localState?.pipeCounter ?? 0);
        const ngCount = trustCounters
          ? (serverState.ngCount ?? 0)
          : Math.max(serverState.ngCount ?? 0, localState?.ngCount ?? 0);
        const totalGoodWeight = trustCounters
          ? (serverState.totalGoodWeight ?? 0)
          : Math.max(serverState.totalGoodWeight ?? 0, localState?.totalGoodWeight ?? 0);
        const totalNgWeight = trustCounters
          ? (serverState.totalNgWeight ?? 0)
          : Math.max(serverState.totalNgWeight ?? 0, localState?.totalNgWeight ?? 0);

        next[mid] = {
          ...serverState,
          pipeCounter,
          ngCount,
          totalGoodWeight,
          totalNgWeight,
          goodEvents: mergedGood,
          ngEvents:   mergedNg,
        };
        changed = true;
      });
      return changed ? next : prev;
    });
  }, []);

  // ── DB-first helpers ─────────────────────────────────────────────────────────

  /**
   * Replace the queue for a machine with a fresh list from DB.
   * Called on mount and on SSE reconnect.
   */
  const setQueueFromDb = useCallback((machineId, dbItems) => {
    if (!Array.isArray(dbItems)) return;
    setAllStates((prev) => {
      const current = prev[machineId] ?? { ...DEFAULT_MACHINE_STATE };
      return { ...prev, [machineId]: { ...current, queue: dbItems } };
    });
  }, []);

  /**
   * Apply a queue_updated SSE event from the DB.
   * { machineId, action: 'added'|'removed', item?, itemId? }
   */
  const applyDbQueueUpdate = useCallback(({ machineId, action, item, itemId }) => {
    setAllStates((prev) => {
      const current = prev[machineId] ?? { ...DEFAULT_MACHINE_STATE };
      let nextQueue = current.queue ?? [];
      if (action === 'added' && item) {
        // Dedupe vs optimistic row + SSE: match DB id OR same queueId (server stores queue_key as queueId)
        const exists = nextQueue.some((q) => {
          if (q.id != null && item.id != null && Number(q.id) === Number(item.id)) return true;
          if (q.queueId && item.queueId && String(q.queueId) === String(item.queueId))
            return true;
          return false;
        });
        if (!exists) nextQueue = [...nextQueue, item];
      } else if (action === 'removed') {
        const idNum = Number(itemId);
        nextQueue = nextQueue.filter((q) => {
          if (Number.isFinite(idNum) && q.id != null && Number(q.id) === idNum) return false;
          if (q.queueId != null && itemId != null && String(q.queueId) === String(itemId))
            return false;
          return true;
        });
      }
      return { ...prev, [machineId]: { ...current, queue: nextQueue } };
    });
  }, []);

  /**
   * Apply a session_updated SSE event from the DB.
   * { machineId, session } — session is DB frontendState shape
   */
  const applyDbSessionUpdate = useCallback(({ machineId, session }) => {
    if (!session || typeof session !== 'object') return;
    setAllStates((prev) => {
      const current = prev[machineId] ?? { ...DEFAULT_MACHINE_STATE };
      // Always trust DB session — it's authoritative
      return {
        ...prev,
        [machineId]: {
          ...current,
          ...session,
          // Preserve in-memory events (not persisted in DB state snapshot)
          goodEvents: current.goodEvents ?? [],
          ngEvents:   current.ngEvents   ?? [],
          // ...session มี pipeCounter/ng/น้ำหนักจาก DB — ห้าม Math.max เลข UI (GAS พอง) มีชนะ
          // ค้างผลิตจากแผน — ไม่ลดเมื่อผลิดี; ค่าใน DB เป็นหลักเมื่อ sync มา
          remainingQty:
            typeof session.remainingQty === 'number'
              ? session.remainingQty
              : (current.remainingQty ?? 0),
        },
      };
    });
  }, []);

  return {
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
    setQueueFromDb,
    applyDbQueueUpdate,
    applyDbSessionUpdate,
  };
};
