import React, { useState, useRef, useEffect } from 'react';
import {
  createOrder,
  closeOrder,
  storeScaleCommand,
  fetchScaleConfirm,
  dbStartSession,
  dbCancelSession,
} from '../api/productionApi';
import { useLanguage } from '../../../contexts/LanguageContext';
import { useTranslation } from '../../../utils/translations';

// ─── Shared styles ────────────────────────────────────────────────────────────

const FIELD_CLASS =
  'w-full bg-gray-900 border border-gray-600 rounded-lg px-4 py-3 text-white placeholder-gray-600 ' +
  'focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/40 transition';

// ─── Small reusable pieces ────────────────────────────────────────────────────

const Spinner = () => (
  <svg className="w-4 h-4 animate-spin flex-shrink-0" fill="none" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
  </svg>
);

const NoticeBanner = ({ notice }) =>
  notice ? (
    <div
      className={`flex items-start gap-2.5 rounded-lg px-4 py-3 text-sm ${
        notice.type === 'error'
          ? 'bg-red-500/10 border border-red-500/30 text-red-300'
          : 'bg-amber-500/10 border border-amber-500/30 text-amber-300'
      }`}
    >
      <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
      <span>{notice.text}</span>
    </div>
  ) : null;

// ─── Queue row ────────────────────────────────────────────────────────────────

/** เวลาสูงสุดรอกดยืนยันที่ตาชั่ง (นับจากเวลาเริ่มเซสชันฝั่งเซิร์ฟเวอร์ หรือจากครั้งที่กด Start Now) */
const SCALE_CONFIRM_WAIT_MS = 10 * 60 * 1000;

/** แถบด้านบนเมื่อมีเซสชัน awaiting_scale — ให้เห็นชัดระหว่างรอตาชั่งหลังรีเฟรช */
const MachineScaleWaitBanner = ({ t, sessionWait }) => {
  const [, pulse] = useState(0);
  useEffect(() => {
    if (!sessionWait?.active) return undefined;
    const id = setInterval(() => pulse((x) => x + 1), 1000);

    return () => clearInterval(id);
  }, [sessionWait?.active]);

  if (!sessionWait?.active) return null;

  const parsed = sessionWait.startedAt ? Date.parse(sessionWait.startedAt) : NaN;
  const end = Number.isFinite(parsed)
    ? parsed + SCALE_CONFIRM_WAIT_MS
    : Date.now() + SCALE_CONFIRM_WAIT_MS;
  const sec = Math.max(0, Math.ceil((end - Date.now()) / 1000));
  const mm = String(Math.floor(sec / 60)).padStart(2, '0');
  const ss = String(sec % 60).padStart(2, '0');

  return (
    <div className="flex items-start gap-3 rounded-xl border border-amber-500/35 bg-amber-500/10 px-4 py-3">
      <Spinner />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-amber-200">{t('production.machineWaitingScaleTitle')}</p>
        <p className="text-[11px] text-amber-300/85 mt-0.5">
          {(sessionWait.orderId ?? '') !== ''
            ? t('production.machineWaitingScaleOrder', {
              orderId: sessionWait.orderId,
              label: sessionWait.productName || sessionWait.productCode || '',
            })
            : t('production.scaleWaitingDetail')}
        </p>
        <p className="text-[11px] font-mono text-amber-300/75 mt-0.5">
          {t('production.scaleConfirmCountdown', { mm, ss })}
        </p>
        <p className="text-[11px] text-amber-400/65 mt-0.5">{t('production.scaleInstruction')}</p>
      </div>
    </div>
  );
};

const QueueRow = ({
  item,
  position,
  machineId,
  sheetName,
  ledIp,
  interactive = true,
  onStart,
  onRemove,
  serverAwaitingScale = false,
  serverSessionStartedAt = null,
}) => {
  // 'idle' | 'waiting' | 'timeout'
  const [phase, setPhase]   = useState('idle');
  const [notice, setNotice] = useState(null);
  const [, setTickPulse] = useState(0); // รีเรนเดอร์เหลือเวลาเมื่อ phase = waiting
  const { language } = useLanguage();
  const { t } = useTranslation(language);

  const pollRef    = useRef(null);
  const timeoutRef = useRef(null);
  const waitEndsAtRef = useRef(0);
  /** true = เริ่มรอจาก UI ครั้งนี้แล้ว — อย่านับ polling/timeout ซ้ำจาก useEffect hydrate */
  const hydratedAwaitingRef = useRef(false);

  // หยุด polling ทั้งหมด
  const stopPolling = () => {
    clearInterval(pollRef.current);
    clearTimeout(timeoutRef.current);
    pollRef.current    = null;
    timeoutRef.current = null;
  };

  // cleanup เมื่อ unmount
  useEffect(() => () => stopPolling(), []);

  const scheduleWaitExpiry = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    const delay = Math.max(0, waitEndsAtRef.current - Date.now());
    if (delay === 0) {
      timeoutRef.current = null;
      void handleWaitExpired();

      return;
    }
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      void handleWaitExpired();
    }, delay);
  };

  // countdown ในเฟส waiting
  useEffect(() => {
    if (phase !== 'waiting') return undefined;
    const id = setInterval(() => setTickPulse((x) => x + 1), 1000);

    return () => clearInterval(id);
  }, [phase]);

  // รีเฟรช / ผสานจาก DB: มี awaiting_scale — ฟื้น polling เว้นแต่เริ่มจากปุ่ม Start แล้ว
  useEffect(() => {
    if (!serverAwaitingScale) {
      hydratedAwaitingRef.current = false;

      return;
    }
    if (hydratedAwaitingRef.current) return;
    hydratedAwaitingRef.current = true;
    setPhase('waiting');
    setNotice(null);
    const parsed = serverSessionStartedAt ? Date.parse(serverSessionStartedAt) : NaN;
    waitEndsAtRef.current = Number.isFinite(parsed)
      ? parsed + SCALE_CONFIRM_WAIT_MS
      : Date.now() + SCALE_CONFIRM_WAIT_MS;
    scheduleWaitExpiry();

    const tickPoll = async () => {
      try {
        const res = await fetchScaleConfirm(machineId);
        if (res?.pending) {
          stopPolling();
          hydratedAwaitingRef.current = false;
          await handleConfirmed(res.shift, res.employeeId);
        }
      } catch {
        /* รอ tick ถัดไป */
      }
    };

    pollRef.current = setInterval(() => void tickPoll(), 2500);
    void tickPoll();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- hydrate one-shot when serverAwaitingScale flips true
  }, [serverAwaitingScale, serverSessionStartedAt]);

  const handleWaitExpired = async () => {
    stopPolling();
    hydratedAwaitingRef.current = false;
    try {
      const last = await fetchScaleConfirm(machineId);
      if (last?.pending) {
        await handleConfirmed(last.shift, last.employeeId);

        return;
      }
    } catch {
      /* เดินหน้ายกเลิก */
    }
    try {
      await dbCancelSession(machineId);
    } catch (err) {
      console.warn('[QueueRow] dbCancelSession after timeout:', err?.message);
    }
    setPhase('timeout');
    setNotice({ type: 'warn', text: t('production.scaleConfirmTimeout') });
  };

  // ─── กดปุ่ม Start Now ──────────────────────────────────────────────
  const handleStart = async () => {
    hydratedAwaitingRef.current = true;
    setPhase('waiting');
    setNotice(null);

    // สร้างเซสชันใน DB ก่อน — GET scale-confirm อ่านจาก production_sessions เท่านั้น
    try {
      await dbStartSession(machineId, {
        queueItemId:  item.id ?? null,
        orderId:      item.orderId,
        productCode:  item.productCode || '',
        productName:  item.productName,
        targetQty:    item.targetQty,
        remainingQty: item.remainingQty ?? 0,
        planDate:     item.planDate ?? '',
        sheetName,
        ledIp,
        peType:       item.peType ?? '',
        size:         item.size ?? null,
        length:       item.length ?? null,
        pn:           item.pn ?? null,
        brand:        item.brand ?? '',
        colorStripe:  item.colorStripe ?? '',
        stdWeight:    item.stdWeight ?? null,
        minWeight:    item.minWeight ?? null,
        maxWeight:    item.maxWeight ?? null,
      });
    } catch (err) {
      console.warn('[QueueRow] dbStartSession error:', err.message);
      setNotice({ type: 'warn', text: t('production.scaleSendFailed', { msg: err.message }) });
    }

    try {
      const scaleTarget = (item.remainingQty > 0) ? item.remainingQty : item.targetQty;
      await storeScaleCommand(machineId, {
        orderId:     item.orderId,
        productCode: item.productCode || '',
        targetQty:   scaleTarget,
        sheetName,
        stdWeight:   item.stdWeight   ?? 0,
        minWeight:   item.minWeight   ?? 0,
        maxWeight:   item.maxWeight   ?? 0,
        productLen:  item.length      ?? 0,
      });
    } catch (err) {
      console.warn('[QueueRow] storeScaleCommand error:', err.message);
      setNotice({ type: 'warn', text: t('production.scaleSendFailed', { msg: err.message }) });
    }

    waitEndsAtRef.current = Date.now() + SCALE_CONFIRM_WAIT_MS;
    scheduleWaitExpiry();

    const tickPoll = async () => {
      try {
        const res = await fetchScaleConfirm(machineId);
        if (res?.pending) {
          stopPolling();
          hydratedAwaitingRef.current = false;
          await handleConfirmed(res.shift, res.employeeId);
        }
      } catch {
        /* ชั่วคราว — ข้าม */
      }
    };

    pollRef.current = setInterval(() => void tickPoll(), 2500);
    void tickPoll();
  };

  const secondsLeftWaiting = phase === 'waiting'
    ? Math.max(0, Math.ceil((waitEndsAtRef.current - Date.now()) / 1000))
    : 0;

  const mmLeft = String(Math.floor(secondsLeftWaiting / 60)).padStart(2, '0');
  const ssLeft = String(secondsLeftWaiting % 60).padStart(2, '0');

  // ─── ยืนยันแล้ว (กะ + รหัสพนักงาน) ──────────────────────────────
  const handleConfirmed = async (shift, employeeId) => {
    hydratedAwaitingRef.current = false;
    stopPolling();
    // บันทึกแถวหัวออเดอร์ลงชีต GAS (วันที่ | เลขใบขอ | รหัสสินค้า | ชื่อสินค้า | เป้า/กะ | กะ | รหัสพนักงาน)
    try {
      await createOrder({
        machineId,
        sheetName,
        ledIp,
        orderId:     item.orderId,
        productCode: item.productCode || '',
        productName: item.productName || '',
        targetQty:   item.targetQty,
        shift,
        employeeId,
      });
    } catch (err) {
      console.warn('[QueueRow] createOrder error (proceeding locally):', err.message);
    }

    // ส่ง callback ไปยัง parent พร้อม shift + employeeId
    onStart(item, { shift, employeeId });
  };

  // ─── ยกเลิกการรอ ──────────────────────────────────────────────────
  const handleCancel = async () => {
    stopPolling();
    hydratedAwaitingRef.current = false;
    try {
      await dbCancelSession(machineId);
    } catch (err) {
      console.warn('[QueueRow] cancel wait:', err?.message);
    }
    setPhase('idle');
    setNotice(null);
  };

  // ─── เริ่มใหม่หลัง timeout ────────────────────────────────────────
  const handleRetry = () => {
    hydratedAwaitingRef.current = false;
    setPhase('idle');
    setNotice(null);
  };

  return (
    <div className="bg-gray-900/60 border border-gray-700/50 rounded-xl p-4 flex flex-col gap-3">
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          {/* Position badge */}
          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-gray-700 text-gray-400 text-[11px] font-bold flex items-center justify-center">
            {position}
          </span>

          {/* Order details */}
          <div className="min-w-0 flex-1 space-y-0.5">
            {/* เลขใบขอ */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[9px] font-semibold tracking-widest text-gray-600 uppercase">{t('production.orderReqNo')}</span>
              <span className="text-sm font-bold text-white font-mono">{item.orderId}</span>
            </div>

            {/* รหัสสินค้า */}
            {item.productCode && (
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] font-semibold tracking-widest text-gray-600 uppercase">{t('production.productCode')}</span>
                <span className="text-[11px] font-mono text-cyan-400/80">{item.productCode}</span>
              </div>
            )}

            {/* ชื่อสินค้า */}
            {item.productName && (
              <p className="text-xs text-gray-300 leading-snug" title={item.productName}>
                {item.productName}
              </p>
            )}

            {/* ข้อมูลรายละเอียดผลิตภัณฑ์จาก Sheet Product */}
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
              {item.peType && (
                <span className="text-[10px] text-gray-500">{item.peType}</span>
              )}
              {item.size != null && (
                <span className="text-[10px] text-gray-500">ขนาด <span className="text-gray-300 font-mono">{item.size}</span> มม.</span>
              )}
              {item.length != null && (
                <span className="text-[10px] text-gray-500">ยาว <span className="text-gray-300 font-mono">{item.length}</span> ม.</span>
              )}
              {item.pn != null && (
                <span className="text-[10px] text-gray-500">PN <span className="text-gray-300 font-mono">{item.pn}</span></span>
              )}
              {item.brand && (
                <span className="text-[10px] text-gray-500">ตรา <span className="text-gray-300">{item.brand}</span></span>
              )}
              {item.colorStripe && (
                <span className="text-[10px] text-gray-500">แถบสี <span className="text-gray-300">{item.colorStripe}</span></span>
              )}
            </div>
            {/* น้ำหนักมาตรฐาน + Min/Max */}
            {item.stdWeight > 0 && (
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                <span className="text-[10px] text-gray-600">น้ำหนัก/ม้วน:</span>
                <span className="text-[10px] font-mono text-amber-400">{item.stdWeight} kg</span>
                {item.minWeight > 0 && item.maxWeight > 0 && (
                  <span className="text-[10px] font-mono text-gray-500">
                    Min <span className="text-yellow-600">{item.minWeight}</span>
                    {' – '}Max <span className="text-yellow-600">{item.maxWeight}</span>
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ค้างผลิต / Target qty badge */}
        <div className="flex-shrink-0 flex flex-col items-end gap-0.5 self-start">
          <span className="text-[11px] font-mono font-bold bg-gray-800 border border-gray-700 text-cyan-400 px-2.5 py-1 rounded-full">
            ×{item.remainingQty > 0 ? item.remainingQty : item.targetQty}
          </span>
          {item.remainingQty > 0 && (
            <span className="text-[9px] text-gray-600">ค้างผลิต</span>
          )}
        </div>
      </div>

      {/* Notice */}
      {notice && <NoticeBanner notice={notice} />}

      {/* ── waiting: กำลังรอการยืนยัน ── */}
      {phase === 'waiting' && (
        <div className="flex items-center gap-3 bg-amber-500/8 border border-amber-500/30 rounded-lg px-4 py-3">
          <Spinner />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-amber-300">{t('production.waitingConfirm')}</p>
            <p className="text-[11px] text-amber-400/80 mt-0.5">{t('production.scaleWaitingDetail')}</p>
            <p className="text-[11px] font-mono text-amber-300/70 mt-0.5">
              {t('production.scaleConfirmCountdown', { mm: mmLeft, ss: ssLeft })}
            </p>
            <p className="text-[11px] text-amber-400/60 mt-0.5">{t('production.scaleInstruction')}</p>
          </div>
          {interactive && (
          <button
            type="button"
            onClick={handleCancel}
            title={t('production.cancel')}
            className="flex-shrink-0 text-xs text-gray-500 hover:text-red-400 transition-colors px-2 py-1 rounded"
          >
            {t('production.cancel')}
          </button>
          )}
        </div>
      )}

      {/* ── Action row (idle / timeout) ── */}
      {phase !== 'waiting' && interactive && (
        <div className="flex gap-2">
          <button
            onClick={phase === 'timeout' ? handleRetry : handleStart}
            className={`flex-1 flex items-center justify-center gap-2 font-semibold text-sm py-2 px-4 rounded-lg transition-all border ${
              phase === 'timeout'
                ? 'bg-amber-500/10 hover:bg-amber-500/20 border-amber-500/40 text-amber-400'
                : 'bg-green-500/10 hover:bg-green-500/20 active:bg-green-500/30 border-green-500/40 text-green-400'
            }`}
          >
            {phase === 'timeout' ? (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                {t('production.retryAction')}
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {t('production.startNow')}
              </>
            )}
          </button>

          <button
            onClick={() => onRemove(item.queueId)}
            title={t('production.titleRemoveFromQueue')}
            className="flex items-center justify-center w-10 bg-red-500/10 hover:bg-red-500/20 active:bg-red-500/30 border border-red-500/30 text-red-400 rounded-lg transition-all"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
};

// ─── Paused Order banner ──────────────────────────────────────────────────────

const PausedOrderBanner = ({
  pausedOrder,
  machineId,
  interactive = true,
  onResume,                    // () → resume ทันที (รหัสพนักงานเดิม)
  onResumeWithScaleConfirm,    // (shift, employeeId) → resume ด้วยข้อมูลใหม่
  onClosePaused,
}) => {
  // 'idle' | 'chooser' | 'waiting_scale' | 'timeout'
  const [phase, setPhase]   = useState('idle');
  const [notice, setNotice] = useState(null);
  const [closing, setClosing] = useState(false);
  const { language } = useLanguage();
  const { t } = useTranslation(language);

  const pollRef    = useRef(null);
  const timeoutRef = useRef(null);

  const stopPolling = () => {
    clearInterval(pollRef.current);
    clearTimeout(timeoutRef.current);
    pollRef.current = timeoutRef.current = null;
  };
  useEffect(() => () => stopPolling(), []);

  const handleClose = async () => {
    if (!window.confirm(t('production.confirmClosePaused', { orderId: pausedOrder.orderId })))
      return;
    setClosing(true);
    try {
      await closeOrder({ machineId, sheetName: pausedOrder.sheetName, orderId: pausedOrder.orderId });
    } catch (err) {
      console.warn('[PausedOrderBanner] closeOrder API error:', err.message);
    }
    onClosePaused();
    setClosing(false);
  };

  // ── ส่งไปตาชั่ง ─────────────────────────────────────────────────────────
  const handleSendToScale = async () => {
    setPhase('waiting_scale');
    setNotice(null);
    try {
      await storeScaleCommand(machineId, {
        orderId:     pausedOrder.orderId,
        productCode: pausedOrder.productCode || '',
        targetQty:   pausedOrder.targetQty,
        sheetName:   pausedOrder.sheetName || '',
      });
    } catch (err) {
      setNotice({ type: 'warn', text: t('production.scaleSendFailed', { msg: err.message }) });
    }

    pollRef.current = setInterval(async () => {
      try {
        const res = await fetchScaleConfirm(machineId);
        if (res?.pending) {
          stopPolling();
          setPhase('idle');
          onResumeWithScaleConfirm(res.shift, res.employeeId);
        }
      } catch { /* รอ tick ถัดไป */ }
    }, 2500);

    timeoutRef.current = setTimeout(() => {
      stopPolling();
      setPhase('timeout');
      setNotice({ type: 'warn', text: t('production.scaleConfirmTimeout') });
    }, SCALE_CONFIRM_WAIT_MS);
  };

  return (
    <>
      {/* ── Resume chooser modal ── */}
      {interactive && phase === 'chooser' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-sm bg-gray-900 border border-yellow-500/30 rounded-2xl shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="bg-yellow-500/8 px-6 py-5 border-b border-yellow-500/20">
              <div className="flex items-center gap-2 mb-1">
                <svg className="w-4 h-4 text-yellow-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <h3 className="text-base font-bold text-white">{t('production.resumeOrderTitle')}</h3>
              </div>
              <p className="text-xs text-gray-400 font-mono">{pausedOrder.orderId}</p>
              {pausedOrder.productCode && (
                <p className="text-xs text-cyan-400/80 font-mono">{pausedOrder.productCode}</p>
              )}
            </div>

            <div className="px-6 py-5 space-y-2.5">
              {/* Option 1 — รหัสพนักงานเดิม */}
              <button
                onClick={() => { setPhase('idle'); onResume(); }}
                className="w-full flex items-start gap-3 bg-yellow-500/10 hover:bg-yellow-500/20 border border-yellow-500/30 text-yellow-300 font-semibold text-sm px-4 py-3 rounded-xl transition-all text-left"
              >
                <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div>
                  <p>{t('production.resumeWithSameData')}</p>
                  {(pausedOrder.employeeId || pausedOrder.shift) && (
                    <p className="text-[11px] font-normal text-yellow-500/70 mt-0.5">
                      {[pausedOrder.employeeId, pausedOrder.shift ? `${t('production.shiftLabel')} ${pausedOrder.shift}` : ''].filter(Boolean).join(' · ')}
                    </p>
                  )}
                </div>
              </button>

              {/* Option 2 — ส่งไปตาชั่งใหม่ */}
              <button
                onClick={handleSendToScale}
                className="w-full flex items-start gap-3 bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/30 text-indigo-300 font-semibold text-sm px-4 py-3 rounded-xl transition-all text-left"
              >
                <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
                <div>
                  <p>{t('production.resumeWithScale')}</p>
                  <p className="text-[11px] font-normal text-indigo-400/60 mt-0.5">{t('production.scaleResumeInstruction')}</p>
                </div>
              </button>

              {/* Cancel */}
              <button
                onClick={() => setPhase('idle')}
                className="w-full text-sm text-gray-500 hover:text-gray-300 py-2 transition"
              >
                {t('production.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Banner ── */}
      <div className="bg-yellow-500/8 border border-yellow-500/30 rounded-2xl p-5">
        {/* Label */}
        <div className="flex items-center gap-2 mb-3">
          <svg className="w-4 h-4 text-yellow-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="text-[11px] font-bold tracking-widest text-yellow-400/80 uppercase">
            {t('production.pausedOrderLabel')}
          </span>
        </div>

        {/* Order details */}
        <div className="mb-4 space-y-0.5">
          <p className="text-base font-bold font-mono text-white">{pausedOrder.orderId}</p>
          {pausedOrder.productCode && (
            <p className="text-xs font-mono text-cyan-400/70">{pausedOrder.productCode}</p>
          )}
          <p className="text-sm text-gray-400">{pausedOrder.productName}</p>
          <p className="text-xs text-gray-600 font-mono mt-1">
            {pausedOrder.pipeCounter} / {pausedOrder.remainingQty > 0 ? pausedOrder.remainingQty : pausedOrder.targetQty} {t('production.pieces')}
            {(pausedOrder.employeeId || pausedOrder.shift) && (
              <span className="ml-2 text-indigo-400/60">
                · {[pausedOrder.employeeId, pausedOrder.shift ? `${t('production.shiftLabel')} ${pausedOrder.shift}` : ''].filter(Boolean).join(' ')}
              </span>
            )}
          </p>
        </div>

        {/* Notice */}
        {notice && <NoticeBanner notice={notice} />}

        {/* Waiting for scale */}
        {phase === 'waiting_scale' && (
          <div className="flex items-center gap-3 bg-indigo-500/8 border border-indigo-500/30 rounded-lg px-4 py-3 mb-3">
            <Spinner />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-indigo-300">{t('production.waitingScaleConfirm')}</p>
              <p className="text-[11px] text-indigo-400/60 mt-0.5">{t('production.scaleInstruction')}</p>
            </div>
            {interactive && (
            <button type="button" onClick={() => { stopPolling(); setPhase('idle'); setNotice(null); }}
              className="text-xs text-gray-500 hover:text-red-400 transition-colors px-2 py-1 rounded">
              {t('production.cancel')}
            </button>
            )}
          </div>
        )}

        {/* Actions */}
        {interactive && phase !== 'waiting_scale' && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPhase('chooser')}
              className="flex-1 flex items-center justify-center gap-2 bg-yellow-500/15 hover:bg-yellow-500/25 border border-yellow-500/40 text-yellow-300 font-semibold text-sm py-2 rounded-xl transition-all"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {t('production.resumeOrder')}
            </button>

            <button
              type="button"
              onClick={handleClose}
              disabled={closing}
              className="flex items-center justify-center gap-1.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 text-sm font-semibold px-4 py-2 rounded-xl transition-all disabled:opacity-40"
            >
              {closing
                ? <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                : t('production.closeOrder')
              }
            </button>
          </div>
        )}
        {!interactive && (
          <p className="text-xs text-gray-500 mt-2">ดูอย่างเดียว — บัญชีนี้ไม่มีสิทธิ์ควบคุมการผลิต</p>
        )}
      </div>
    </>
  );
};

const DEFAULT_SESSION_WAIT = Object.freeze({
  active: false,
  orderId: '',
  productCode: '',
  productName: '',
  startedAt: null,
});

const SetupMode = ({
  machineId,
  machineLabel,
  sheetName,
  ledIp,
  canManageProduction = true,
  queue,
  pausedOrder,
  sessionWait = DEFAULT_SESSION_WAIT,
  onAddToQueue,
  onRemoveFromQueue,
  onStartProduction,
  onResumeOrder,
  onResumeWithScaleConfirm,
  onClosePausedOrder,
}) => {
  const [form, setForm]     = useState({ orderId: '', productName: '', targetQty: '' });
  const [notice, setNotice] = useState(null);
  const { language } = useLanguage();
  const { t } = useTranslation(language);

  const handleChange = (e) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
    if (notice) setNotice(null);
  };

  const validate = () => {
    if (!form.orderId.trim()) return 'Order ID is required.';
    if (!form.productName.trim()) return 'Product Name is required.';
    const qty = parseInt(form.targetQty, 10);
    if (!form.targetQty || isNaN(qty) || qty < 1) return 'Target Quantity must be a positive number.';
    return null;
  };

  const handleAddToQueue = (e) => {
    e.preventDefault();
    const err = validate();
    if (err) { setNotice({ type: 'error', text: err }); return; }

    onAddToQueue({
      orderId:     form.orderId.trim(),
      productName: form.productName.trim(),
      targetQty:   parseInt(form.targetQty, 10),
    });

    // Reset form after adding
    setForm({ orderId: '', productName: '', targetQty: '' });
    setNotice(null);
  };

  return (
    <div className="max-w-full mx-auto space-y-6">

      {/* ── Header ── */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <span className="w-2.5 h-2.5 rounded-full bg-gray-500 flex-shrink-0" />
          <span className="text-[11px] font-semibold tracking-widest text-gray-500 uppercase">
            {t('production.setupMode')}
          </span>
        </div>
        <h2 className="text-xl font-bold text-white sm:text-2xl">{machineLabel}</h2>
        <p className="text-sm text-gray-400 mt-1">
          {t('production.setupHeaderHintPre')} <span className="text-green-400 font-semibold">{t('production.startNow')}</span> {t('production.setupHeaderHintPost')}
        </p>
      </div>

      <MachineScaleWaitBanner t={t} sessionWait={sessionWait} />

      {/* ── Paused Order banner ── */}
      {pausedOrder && (
        <PausedOrderBanner
          pausedOrder={pausedOrder}
          machineId={machineId}
          interactive={canManageProduction}
          onResume={onResumeOrder}
          onResumeWithScaleConfirm={onResumeWithScaleConfirm}
          onClosePaused={onClosePausedOrder}
        />
      )}

      {/* ── Add to Queue form ── */}
      {/* <div className="bg-gray-800/50 border border-gray-700/50 rounded-2xl p-5">
        <h3 className="text-xs font-semibold tracking-widest text-gray-500 uppercase mb-4">
          + เพิ่มรายการเข้าคิว
        </h3>
        <form onSubmit={handleAddToQueue} noValidate className="space-y-4">
          <div className="flex gap-3">
            <div className="flex-1 max-w-[200px]">
              <label className="block text-sm font-medium text-gray-300 mb-1.5">
                Order ID <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                name="orderId"
                value={form.orderId}
                onChange={handleChange}
                placeholder="e.g. ORD-2026-001"
                autoComplete="off"
                className={`${FIELD_CLASS} font-mono`}
              />
            </div>

            <div className="flex-[2] min-w-0">
              <label className="block text-sm font-medium text-gray-300 mb-1.5">
                Product Name <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                name="productName"
                value={form.productName}
                onChange={handleChange}
                placeholder="e.g. HDPE Pipe DN110 PN10"
                autoComplete="off"
                className={FIELD_CLASS}
              />
            </div>

           
            <div className="flex-1 max-w-[160px]">
              <label className="block text-sm font-medium text-gray-300 mb-1.5">
                Target Quantity <span className="text-xs text-gray-500">(pipes)</span>{' '}
                <span className="text-red-400">*</span>
              </label>
              <input
                type="number"
                name="targetQty"
                value={form.targetQty}
                onChange={handleChange}
                placeholder="e.g. 500"
                min="1"
                className={`${FIELD_CLASS} font-mono`}
              />
            </div>
          </div>

          <NoticeBanner notice={notice} />

          <button
            type="submit"
            className="w-full flex items-center justify-center gap-2 bg-cyan-500/10 hover:bg-cyan-500/20 active:bg-cyan-500/30 border border-cyan-500/40 text-cyan-400 font-bold py-2.5 px-6 rounded-xl transition-all"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add to Queue
          </button>
        </form>
      </div> */}

      {/* ── Queue list ── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold tracking-widest text-gray-500 uppercase">
            {t('production.productionQueue')}
          </h3>
          {queue.length > 0 && (
            <span className="text-[11px] font-bold bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 px-2 py-0.5 rounded-full">
              {queue.length} {t('production.items')}
            </span>
          )}
        </div>

        {queue.length === 0 ? (
          <div className="text-center py-10 text-gray-600 border border-dashed border-gray-700/50 rounded-xl">
            <svg className="w-8 h-8 mx-auto mb-2 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            <p className="text-sm">{t('production.emptyQueue')}</p>
            <p className="text-xs mt-1 opacity-70">{t('production.emptyQueueHint')}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {queue.map((item, index) => (
              <QueueRow
                key={item.queueId}
                item={item}
                position={index + 1}
                machineId={machineId}
                sheetName={sheetName}
                ledIp={ledIp}
                interactive={canManageProduction}
                serverAwaitingScale={Boolean(sessionWait.active && sessionWait.orderId === item.orderId)}
                serverSessionStartedAt={
                  sessionWait.active && sessionWait.orderId === item.orderId ? sessionWait.startedAt : null
                }
                onStart={(queueItem, confirmation = {}) => onStartProduction({
                  queueItemId:  queueItem.id ?? null,
                  orderId:     queueItem.orderId,
                  productCode: queueItem.productCode || '',
                  productName: queueItem.productName,
                  targetQty:   queueItem.targetQty,
                  remainingQty: queueItem.remainingQty ?? 0,
                  planDate:    queueItem.planDate ?? '',
                  peType:      queueItem.peType ?? '',
                  size:        queueItem.size ?? null,
                  length:      queueItem.length ?? null,
                  pn:          queueItem.pn ?? null,
                  brand:       queueItem.brand ?? '',
                  colorStripe: queueItem.colorStripe ?? '',
                  stdWeight:   queueItem.stdWeight ?? null,
                  minWeight:   queueItem.minWeight ?? null,
                  maxWeight:   queueItem.maxWeight ?? null,
                  sheetName,
                  ledIp,
                  queueId:     queueItem.queueId,
                  shift:       confirmation.shift      || '',
                  employeeId:  confirmation.employeeId || '',
                })}
                onRemove={onRemoveFromQueue}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default SetupMode;
