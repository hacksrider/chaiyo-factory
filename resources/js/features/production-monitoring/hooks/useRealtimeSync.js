/**
 * useRealtimeSync — SSE client hook for real-time production data
 *
 * Connects to GET /api/production-monitor/stream (Server-Sent Events).
 * Falls back to the 15-second polling cycle in index.jsx when SSE is unavailable.
 *
 * Features:
 * - Exponential backoff with ±20% jitter: 2s → 4s → 8s … cap 60s
 * - Heartbeat watchdog: force-reconnect if no message for 30s
 * - Delta sync: sends ?since=<_ts> on reconnect so server replays missed events
 * - Persists last seen _ts per machine in localStorage for cross-tab / refresh continuity
 * - onReconnect callback fires after a successful re-open so callers can fetch snapshots
 *
 * Events handled:
 *   connected          { latestId }
 *   machine_session    { machineId, state }
 *   led_state          { machineId, state }          ← legacy, kept for compat
 *   led_updated        { machineId, ledConfig }       ← new canonical
 *   production_updated { machineId, qty_good, qty_remaining, total_weight, _ts }
 *   session_confirmed  { machineId, shift, employee_id, confirmed_at }
 *   scale_weight       { machineId, event }
 *   queue_updated      { machineId, action, item?, itemId? }  ← DB queue
 *   session_updated    { machineId, session }                 ← DB session
 */

import { useEffect, useRef, useCallback } from 'react';
import { SSE_EVENTS } from '../SSE_EVENTS';

const SSE_URL       = '/api/production-monitor/stream';
const MIN_BACKOFF   = 2_000;   // 2 s — first retry
const MAX_BACKOFF   = 60_000;  // 60 s — ceiling
const DEAD_TIMEOUT  = 30_000;  // 30 s without any event = dead connection
const LS_TS_KEY     = 'prodmon_lastTs'; // localStorage key: JSON { [machineId]: number }

// ── Backoff helpers ───────────────────────────────────────────────────────────

/** Apply ±20% jitter to a delay value. */
const withJitter = (ms) => {
  const jitter = ms * 0.2;
  return Math.round(ms + (Math.random() * 2 - 1) * jitter);
};

/** Read the per-machine _ts map from localStorage. */
const readLastTs = () => {
  try {
    return JSON.parse(localStorage.getItem(LS_TS_KEY) ?? '{}') ?? {};
  } catch {
    return {};
  }
};

/** Persist a single machine's _ts into the localStorage map. */
const writeLastTs = (machineId, ts) => {
  try {
    const map = readLastTs();
    map[machineId] = ts;
    localStorage.setItem(LS_TS_KEY, JSON.stringify(map));
  } catch { /* storage full — ignore */ }
};

/**
 * @param {object} handlers
 * @param {function} [handlers.onMachineSession]     ({ machineId, state }) => void
 * @param {function} [handlers.onLedState]           ({ machineId, state }) => void   — legacy
 * @param {function} [handlers.onLedUpdated]         ({ machineId, ledConfig }) => void
 * @param {function} [handlers.onProductionUpdated]  ({ machineId, qty_good, qty_remaining, total_weight, _ts }) => void
 * @param {function} [handlers.onSessionConfirmed]   ({ machineId, shift, employee_id, confirmed_at }) => void
 * @param {function} [handlers.onScaleWeight]        ({ machineId, event }) => void
 * @param {function} [handlers.onQueueUpdated]       ({ machineId, action, item?, itemId? }) => void
 * @param {function} [handlers.onSessionUpdated]     ({ machineId, session }) => void
 * @param {function} [handlers.onConnected]          ({ latestId }) => void
 * @param {function} [handlers.onReconnect]          () => void — fires after every successful re-open (not first connect)
 * @param {function} [handlers.onStatusChange]       ('connecting'|'open'|'closed'|'error') => void
 *
 * @returns {{ statusRef: React.MutableRefObject<string>, reconnect: function }}
 */
export const useRealtimeSync = ({
  onMachineSession,
  onLedState,
  onLedUpdated,
  onProductionUpdated,
  onSessionConfirmed,
  onScaleWeight,
  onQueueUpdated,
  onSessionUpdated,
  onConnected,
  onReconnect,
  onStatusChange,
} = {}) => {
  const esRef             = useRef(null);
  const reconnectTimerRef  = useRef(null);
  const backoffRef         = useRef(MIN_BACKOFF);
  const lastEventIdRef     = useRef(0);
  const statusRef          = useRef('connecting');
  const deadTimerRef       = useRef(null);
  const mountedRef         = useRef(true);
  const isFirstConnectRef  = useRef(true); // suppresses onReconnect on initial open

  // ── Stable refs for callbacks — avoids re-subscribing on every render ────
  const cbRefs = useRef({});
  cbRefs.current.onMachineSession    = onMachineSession;
  cbRefs.current.onLedState          = onLedState;
  cbRefs.current.onLedUpdated        = onLedUpdated;
  cbRefs.current.onProductionUpdated = onProductionUpdated;
  cbRefs.current.onSessionConfirmed  = onSessionConfirmed;
  cbRefs.current.onScaleWeight       = onScaleWeight;
  cbRefs.current.onQueueUpdated      = onQueueUpdated;
  cbRefs.current.onSessionUpdated    = onSessionUpdated;
  cbRefs.current.onConnected         = onConnected;
  cbRefs.current.onReconnect         = onReconnect;
  cbRefs.current.onStatusChange      = onStatusChange;

  const setStatus = useCallback((s) => {
    statusRef.current = s;
    cbRefs.current.onStatusChange?.(s);
  }, []);

  const resetDeadTimer = useCallback(() => {
    if (deadTimerRef.current) clearTimeout(deadTimerRef.current);
    deadTimerRef.current = setTimeout(() => {
      if (!mountedRef.current) return;
      console.warn('[SSE] Dead connection (no event for 30s) — forcing reconnect');
      esRef.current?.close();
      esRef.current = null;
      scheduleReconnect(false); // eslint-disable-line no-use-before-define
    }, DEAD_TIMEOUT);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const scheduleReconnect = useCallback((immediate = false) => {
    if (!mountedRef.current) return;
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);

    const rawDelay = immediate ? 0 : backoffRef.current;
    const delay    = immediate ? 0 : withJitter(rawDelay);

    reconnectTimerRef.current = setTimeout(() => {
      if (!mountedRef.current) return;
      connect(); // eslint-disable-line no-use-before-define
    }, delay);

    if (!immediate) {
      backoffRef.current = Math.min(backoffRef.current * 2, MAX_BACKOFF);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Generic event parser — reduces boilerplate per-listener ──────────────
  const makeHandler = useCallback((cbKey) => (e) => {
    if (!mountedRef.current) return;
    resetDeadTimer();
    const id = parseInt(e.lastEventId, 10);
    if (!isNaN(id)) lastEventIdRef.current = Math.max(lastEventIdRef.current, id);
    try {
      const data = JSON.parse(e.data);
      // Persist _ts for delta sync on reconnect
      if (data?.machineId && data?._ts) {
        writeLastTs(data.machineId, Number(data._ts));
      }
      cbRefs.current[cbKey]?.(data);
    } catch (err) {
      console.error(`[SSE] ${cbKey} parse error:`, err);
    }
  }, [resetDeadTimer]); // eslint-disable-line react-hooks/exhaustive-deps

  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    setStatus('connecting');

    // Build URL with delta-sync `since` = oldest _ts among all known machines
    const tsMap  = readLastTs();
    const tsVals = Object.values(tsMap).filter((v) => typeof v === 'number' && v > 0);
    const since  = tsVals.length ? Math.min(...tsVals) : 0;
    const urlCore = since > 0
      ? `${SSE_URL}?lastId=${lastEventIdRef.current}&since=${since}`
      : `${SSE_URL}?lastId=${lastEventIdRef.current}`;
    let url = urlCore;
    try {
      const tok = localStorage.getItem('auth_token');
      if (tok) url = `${urlCore}&token=${encodeURIComponent(tok)}`;
    } catch { /* ignore */ }

    let es;
    try {
      es = new EventSource(url);
    } catch (err) {
      console.error('[SSE] EventSource creation failed:', err);
      scheduleReconnect(false);
      return;
    }

    esRef.current = es;
    resetDeadTimer();

    // ── connected ────────────────────────────────────────────────────────
    es.addEventListener(SSE_EVENTS.CONNECTED, (e) => {
      if (!mountedRef.current) return;
      resetDeadTimer();
      backoffRef.current = MIN_BACKOFF; // reset on success

      const wasFirst = isFirstConnectRef.current;
      isFirstConnectRef.current = false;
      setStatus('open');

      try {
        const data = JSON.parse(e.data);
        if (data.latestId) {
          lastEventIdRef.current = Math.max(lastEventIdRef.current, data.latestId);
        }
        cbRefs.current.onConnected?.(data);
      } catch { /* non-critical */ }

      if (!wasFirst) {
        cbRefs.current.onReconnect?.();
      }
    });

    // ── machine_session ──────────────────────────────────────────────────
    es.addEventListener(SSE_EVENTS.MACHINE_SESSION, makeHandler('onMachineSession'));

    // ── led_state (legacy) ───────────────────────────────────────────────
    es.addEventListener(SSE_EVENTS.LED_STATE, makeHandler('onLedState'));

    // ── led_updated (new canonical) ──────────────────────────────────────
    es.addEventListener(SSE_EVENTS.LED_UPDATED, makeHandler('onLedUpdated'));

    // ── production_updated ───────────────────────────────────────────────
    es.addEventListener(SSE_EVENTS.PRODUCTION_UPDATED, makeHandler('onProductionUpdated'));

    // ── session_confirmed ────────────────────────────────────────────────
    es.addEventListener(SSE_EVENTS.SESSION_CONFIRMED, makeHandler('onSessionConfirmed'));

    // ── scale_weight ─────────────────────────────────────────────────────
    es.addEventListener(SSE_EVENTS.SCALE_WEIGHT, makeHandler('onScaleWeight'));

    // ── queue_updated (DB-first queue) ────────────────────────────────────
    es.addEventListener(SSE_EVENTS.QUEUE_UPDATED, makeHandler('onQueueUpdated'));

    // ── session_updated (DB-first session) ───────────────────────────────
    es.addEventListener(SSE_EVENTS.SESSION_UPDATED, makeHandler('onSessionUpdated'));

    // ── Heartbeat event ───────────────────────────────────────────────────
    // Server sends "event: heartbeat" every 15s to keep the connection alive
    // and reset the 30-second dead-connection watchdog timer.
    es.addEventListener('heartbeat', () => resetDeadTimer());

    // Fallback: plain data messages (no event type) also reset the watchdog.
    es.onmessage = () => resetDeadTimer();

    // ── Connection opened ─────────────────────────────────────────────────
    es.onopen = () => {
      if (!mountedRef.current) return;
      resetDeadTimer();
      backoffRef.current = MIN_BACKOFF;
      setStatus('open');
    };

    // ── Error / disconnect ────────────────────────────────────────────────
    es.onerror = () => {
      if (!mountedRef.current) return;
      setStatus('error');
      es.close();
      esRef.current = null;
      scheduleReconnect(false);
    };
  }, [setStatus, resetDeadTimer, scheduleReconnect, makeHandler]);

  // ── Mount / unmount ───────────────────────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true;
    connect();

    return () => {
      mountedRef.current = false;
      esRef.current?.close();
      esRef.current = null;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (deadTimerRef.current)     clearTimeout(deadTimerRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Manual reconnect (called by parent when network comes back) ───────────
  const reconnect = useCallback(() => {
    backoffRef.current = MIN_BACKOFF;
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    connect();
  }, [connect]);

  return { statusRef, reconnect };
};

export default useRealtimeSync;
