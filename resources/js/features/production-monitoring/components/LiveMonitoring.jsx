import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { scaleEventDedupKey } from '../utils/scaleEventDedup';
import { isGoodWeightOutsideMinMax } from '../utils/weightRangeCheck';
import {
  formatProductionDateBangkok,
  formatProductionTimeBangkok,
  parseProductionInstant,
} from '../utils/formatProductionBangkok';
import StatCard from './StatCard';
import { updateWeight, closeOrder, createOrder, fetchScaleWeights, updateDailyProduced, updatePlanProduced, dbFinishSession, storeScaleLive } from '../api/productionApi';
import { useLanguage } from '../../../contexts/LanguageContext';
import { useTranslation } from '../../../utils/translations';

// ─── Elapsed timer hook ───────────────────────────────────────────────────────

const useElapsedTime = (startedAt) => {
  const [elapsed, setElapsed] = useState('00:00:00');
  useEffect(() => {
    if (!startedAt) return;
    const tick = () => {
      const diff = Date.now() - new Date(startedAt).getTime();
      const h = Math.floor(diff / 3_600_000).toString().padStart(2, '0');
      const m = Math.floor((diff % 3_600_000) / 60_000).toString().padStart(2, '0');
      const s = Math.floor((diff % 60_000) / 1_000).toString().padStart(2, '0');
      setElapsed(`${h}:${m}:${s}`);
    };
    tick();
    const id = setInterval(tick, 1_000);
    return () => clearInterval(id);
  }, [startedAt]);
  return elapsed;
};

// ─── Toast ────────────────────────────────────────────────────────────────────

const Toast = ({ toast }) => {
  if (!toast) return null;
  const ok = toast.type === 'success';
  return (
    <div className={`flex items-center gap-2.5 px-4 py-2.5 rounded-lg text-sm font-medium ${
      ok ? 'bg-green-500/10 border border-green-500/30 text-green-300'
         : 'bg-amber-500/10 border border-amber-500/30 text-amber-300'
    }`}>
      {ok
        ? <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
        : <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
      }
      <span>{toast.message}</span>
    </div>
  );
};

const Spinner = ({ className = 'w-4 h-4' }) => (
  <svg className={`${className} animate-spin`} fill="none" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
  </svg>
);

// ─── Switch Order modal ───────────────────────────────────────────────────────
// Shown when user clicks "Start" on a queued item while an order is live.

const SwitchOrderModal = ({
  targetItem,           // queue item the user wants to start
  currentOrderId,       // currently running order id
  machineId,
  sheetName,
  ledIp,
  onPauseAndStart,      // (targetItem) → pause current, start target
  onCloseAndStart,      // (targetItem) → close current in GAS, start target
  onCancel,
}) => {
  const [action, setAction] = useState(null); // 'pause' | 'close'
  const [busy, setBusy]     = useState(false);
  const busyLockRef         = useRef(false);
  const [warn, setWarn]     = useState(null);
  const { language } = useLanguage();
  const { t } = useTranslation(language);

  const run = async (mode) => {
    if (busyLockRef.current) return;
    busyLockRef.current = true;
    setBusy(true);
    setAction(mode);
    setWarn(null);

    if (mode === 'close') {
      try {
        await closeOrder({ machineId, sheetName, orderId: currentOrderId });
      } catch (err) {
        setWarn(`Close API failed (${err.message}) — closing locally.`);
        await new Promise((r) => setTimeout(r, 800));
      }
    }

    try {
      await createOrder({
        machineId,
        sheetName: targetItem.sheetName ?? sheetName,
        ledIp:     targetItem.ledIp     ?? ledIp,
        orderId:      targetItem.orderId,
        productName:  targetItem.productName,
        targetQty:    targetItem.targetQty,
      });
    } catch (err) {
      // GAS fail — หยุด ไม่เปลี่ยน order เพื่อป้องกัน order ใหม่หาย
      setWarn(t('production.switchOrderCreateFailed', { msg: err.message }));
      setBusy(false);
      busyLockRef.current = false;
      return;
    }

    if (mode === 'pause') onPauseAndStart(targetItem);
    else                  onCloseAndStart(targetItem);

    setBusy(false);
    busyLockRef.current = false;
  };

  return (
    // Backdrop
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-sm bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="px-6 pt-6 pb-4">
          <div className="flex items-center gap-2 mb-3">
            <svg className="w-5 h-5 text-amber-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
            <h3 className="text-base font-bold text-white">{t('production.switchOrder')}</h3>
          </div>

          {/* Current → Target */}
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2 bg-gray-800/80 border border-gray-700/60 rounded-xl px-3 py-2.5">
              <span className="text-[10px] font-bold text-gray-500 uppercase w-14 flex-shrink-0">{t('production.switchOrderCurrentLabel')}</span>
              <span className="font-mono text-red-300 truncate">{currentOrderId}</span>
            </div>
            <div className="flex justify-center">
              <svg className="w-4 h-4 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
              </svg>
            </div>
            <div className="flex items-center gap-2 bg-gray-800/80 border border-green-500/30 rounded-xl px-3 py-2.5">
              <span className="text-[10px] font-bold text-gray-500 uppercase w-14 flex-shrink-0">{t('production.switchOrderStartLabel')}</span>
              <div className="min-w-0">
                <p className="font-mono text-green-300 truncate">{targetItem.orderId}</p>
                <p className="text-xs text-gray-500 truncate">{targetItem.productName} · ×{targetItem.remainingQty > 0 ? targetItem.remainingQty : targetItem.targetQty}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Warning */}
        {warn && (
          <div className="mx-6 mb-3 text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
            {warn}
          </div>
        )}

        {/* Options */}
        <div className="px-6 pb-6 space-y-2">
          <p className="text-xs text-gray-500 mb-3">{t('production.whatToDoWithCurrent')}</p>

          {/* Pause */}
          <button
            onClick={() => run('pause')}
            disabled={busy}
            className="w-full flex items-center gap-3 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-300 font-semibold text-sm px-4 py-3 rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy && action === 'pause' ? <Spinner /> : (
              <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            )}
            <div className="text-left">
              <p>{t('production.pauseCurrentOrder')}</p>
              <p className="text-[11px] font-normal text-amber-500/70">{t('production.pauseCurrentDesc')}</p>
            </div>
          </button>

          {/* Close */}
          <button
            onClick={() => run('close')}
            disabled={busy}
            className="w-full flex items-center gap-3 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-300 font-semibold text-sm px-4 py-3 rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy && action === 'close' ? <Spinner /> : (
              <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0zM9 10a1 1 0 00-1 1v2a1 1 0 001 1h6a1 1 0 001-1v-2a1 1 0 00-1-1H9z" />
              </svg>
            )}
            <div className="text-left">
              <p>{t('production.closeCurrentOrder')}</p>
              <p className="text-[11px] font-normal text-red-500/70">{t('production.closeCurrentDesc')}</p>
            </div>
          </button>

          {/* Cancel */}
          <button
            onClick={onCancel}
            disabled={busy}
            className="w-full text-sm text-gray-500 hover:text-gray-300 py-2 transition disabled:opacity-40"
          >
            {t('production.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Add to Queue popup modal ─────────────────────────────────────────────────

const FIELD = 'w-full bg-gray-800 border border-gray-600 rounded-lg px-4 py-3 text-white ' +
  'placeholder-gray-600 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/40 transition';

// const AddToQueueModal = ({ onAdd, onClose }) => {
//   const [form, setForm]   = useState({ orderId: '', productName: '', targetQty: '' });
//   const [error, setError] = useState(null);

//   const handleChange = (e) => {
//     setForm((p) => ({ ...p, [e.target.name]: e.target.value }));
//     if (error) setError(null);
//   };

//   const handleSubmit = (e) => {
//     e.preventDefault();
//     if (!form.orderId.trim())     { setError('Order ID is required.');                  return; }
//     if (!form.productName.trim()) { setError('Product Name is required.');               return; }
//     const qty = parseInt(form.targetQty, 10);
//     if (!form.targetQty || isNaN(qty) || qty < 1) { setError('Target Qty must be a positive number.'); return; }

//     onAdd({ orderId: form.orderId.trim(), productName: form.productName.trim(), targetQty: qty });
//     onClose();
//   };

//   return (
//     <div
//       className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
//       onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
//     >
//       <div className="w-full max-w-md bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl overflow-hidden">
//         {/* Header */}
//         <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700/60">
//           <div className="flex items-center gap-2">
//             <svg className="w-4 h-4 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
//               <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
//             </svg>
//             <h3 className="text-base font-bold text-white">เพิ่มรายการเข้าคิว</h3>
//           </div>
//           <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition p-1">
//             <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
//               <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
//             </svg>
//           </button>
//         </div>

//         {/* Form */}
//         <form onSubmit={handleSubmit} noValidate className="px-6 py-5 space-y-4">
//           <div>
//             <label className="block text-sm font-medium text-gray-300 mb-1.5">
//               Order ID <span className="text-red-400">*</span>
//             </label>
//             <input type="text" name="orderId" value={form.orderId} onChange={handleChange}
//               placeholder="e.g. ORD-2026-002" autoComplete="off"
//               className={`${FIELD} font-mono`} autoFocus />
//           </div>
//           <div>
//             <label className="block text-sm font-medium text-gray-300 mb-1.5">
//               Product Name <span className="text-red-400">*</span>
//             </label>
//             <input type="text" name="productName" value={form.productName} onChange={handleChange}
//               placeholder="e.g. HDPE Pipe DN110 PN10" autoComplete="off" className={FIELD} />
//           </div>
//           <div>
//             <label className="block text-sm font-medium text-gray-300 mb-1.5">
//               Target Quantity <span className="text-xs text-gray-500">(pipes)</span>{' '}
//               <span className="text-red-400">*</span>
//             </label>
//             <input type="number" name="targetQty" value={form.targetQty} onChange={handleChange}
//               placeholder="e.g. 500" min="1" className={`${FIELD} font-mono`} />
//           </div>

//           {error && (
//             <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2.5">
//               {error}
//             </p>
//           )}

//           <div className="flex gap-3 pt-1">
//             <button type="submit"
//               className="flex-1 flex items-center justify-center gap-2 bg-cyan-500 hover:bg-cyan-400 active:bg-cyan-600 text-gray-950 font-bold py-2.5 rounded-xl transition-all"
//             >
//               <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
//                 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
//               </svg>
//               Add to Queue
//             </button>
//             <button type="button" onClick={onClose}
//               className="px-5 text-sm text-gray-400 hover:text-gray-200 border border-gray-700 hover:border-gray-500 rounded-xl transition"
//             >
//               Cancel
//             </button>
//           </div>
//         </form>
//       </div>
//     </div>
//   );
// };

// ─── WeightEventListModal — รายการกดตาชั่งแต่ละครั้ง ─────────────────────────

const WeightEventListModal = ({ type, events, totalWeight, minWeight, maxWeight, onClose }) => {
  const isGood = type === 'good';
  const { language } = useLanguage();
  const { t } = useTranslation(language);

  const liveEvInstant = (ev) => ev?.occurredAt ?? ev?.pressedAt ?? ev?.receivedAt ?? null;

  const title  = isGood ? t('production.goodListTitle') : t('production.ngListTitle');
  const accent = isGood
    ? { bg: 'bg-green-500/8', border: 'border-green-500/25', header: 'bg-green-500/10 border-green-500/20', title: 'text-green-300', badge: 'bg-green-500/15 border-green-500/30 text-green-400', dot: 'bg-green-400', row: 'text-green-200', rowBg: 'bg-green-500/5 border-green-500/15' }
    : { bg: 'bg-red-500/8',   border: 'border-red-500/20',   header: 'bg-red-500/10 border-red-500/20',   title: 'text-red-300',   badge: 'bg-red-500/15   border-red-500/30   text-red-400',   dot: 'bg-red-400',   row: 'text-red-200',   rowBg: 'bg-red-500/5   border-red-500/15'   };

  // sort: 'desc' = ล่าสุดอยู่บน, 'asc' = เวลาเก่าอยู่บน (default)
  const [sortMode, setSortMode] = useState('asc');

  const toTsEv = (ev) => {
    const iso = liveEvInstant(ev);
    const d = parseProductionInstant(iso);

    return d ? d.getTime() : NaN;
  };

  const typ = isGood ? 'good' : 'ng';

  /** ซ้ายขวาเหตุเดียวกันใน state (SSE + poll) — badge/รายการไม่ควรคูณสอง */
  const uniqueEvents = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const raw of events ?? []) {
      const k = scaleEventDedupKey({ ...raw, type: typ });
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(raw);
    }
    return out;
  }, [events, typ]);

  const base = [...uniqueEvents];
  base.sort((a, b) => {
    const ta = toTsEv(a);
    const tb = toTsEv(b);
    // ถ้า parse ไม่ได้ → คงลำดับเดิม
    if (Number.isNaN(ta) || Number.isNaN(tb)) return 0;
    return sortMode === 'asc' ? (ta - tb) : (tb - ta);
  });

  const list = base;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className={`w-full max-w-md bg-gray-900 border ${accent.border} rounded-2xl shadow-2xl flex flex-col max-h-[85vh]`}>

        {/* Header */}
        <div className={`flex items-center justify-between px-5 py-4 border-b ${accent.header} flex-shrink-0`}>
          <div className="flex items-center gap-2.5 min-w-0">
            <span className={`w-2.5 h-2.5 rounded-full ${accent.dot} flex-shrink-0`} />
            <h3 className={`text-base font-bold ${accent.title}`}>{title}</h3>
            <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${accent.badge}`}>
              {uniqueEvents.length} {t('production.items')}
            </span>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Sort toggle */}
            <div className="flex items-center bg-gray-900/40 border border-gray-800 rounded-lg p-0.5">
              <button
                type="button"
                onClick={() => setSortMode('desc')}
                className={[
                  'text-[11px] font-semibold px-2.5 py-1 rounded-md transition',
                  sortMode === 'desc'
                    ? 'bg-gray-800 text-white'
                    : 'text-gray-500 hover:text-gray-200',
                ].join(' ')}
                title={t('production.sortLatestFirstTitle')}
              >
                {t('production.latest')}
              </button>
              <button
                type="button"
                onClick={() => setSortMode('asc')}
                className={[
                  'text-[11px] font-semibold px-2.5 py-1 rounded-md transition',
                  sortMode === 'asc'
                    ? 'bg-gray-800 text-white'
                    : 'text-gray-500 hover:text-gray-200',
                ].join(' ')}
                title={t('production.sortOldestFirstTitle')}
              >
                {t('production.byTime')}
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="text-gray-500 hover:text-gray-200 transition p-1 rounded-lg hover:bg-gray-800"
              aria-label="Close"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Summary row */}
        <div className={`flex-shrink-0 px-5 py-3 border-b border-gray-800 flex items-center justify-between`}>
          <span className="text-xs text-gray-500">{t('production.totalWeight')}</span>
          <span className={`text-lg font-bold font-mono ${accent.row}`}>
            {(totalWeight ?? 0).toFixed(2)} <span className="text-sm font-normal text-gray-500">kg</span>
          </span>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          {list.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-gray-600 text-sm">
              {t('production.noItems')}
            </div>
          ) : (
            list.map((ev, idx) => {
              const when = liveEvInstant(ev);
              const datePart = formatProductionDateBangkok(when);
              const outOfRange = isGood
                && isGoodWeightOutsideMinMax(ev.weight, minWeight, maxWeight);
              const weightClass = outOfRange ? 'text-red-400' : accent.row;

              return (
              <div
                key={scaleEventDedupKey({ ...ev, type: typ }) || `row-${idx}`}
                className={`flex items-center gap-3 rounded-xl border px-4 py-2.5 ${accent.rowBg}`}
              >
                {/* Sequence number */}
                <span className="flex-shrink-0 w-7 h-7 rounded-full bg-gray-800 text-gray-400 text-[11px] font-bold flex items-center justify-center">
                  {sortMode === 'asc' ? (idx + 1) : (list.length - idx)}
                </span>
                <div className="flex-1 min-w-0">
                  <p
                    className={`text-sm font-mono font-semibold ${weightClass}`}
                    title={outOfRange ? t('production.goodWeightOutOfRangeHint') : undefined}
                  >
                    {parseFloat(ev.weight).toFixed(3)} kg
                  </p>
                  <p className="text-[11px] text-gray-500 mt-0.5">
                    {datePart && (
                      <span className="mr-1.5">{datePart}</span>
                    )}
                    {formatProductionTimeBangkok(when)}
                  </p>
                </div>
              </div>
            );
            })
          )}
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 px-5 py-3 border-t border-gray-800">
          <button
            type="button"
            onClick={onClose}
            className="w-full text-sm font-semibold text-gray-400 hover:text-white bg-gray-800/60 hover:bg-gray-700/60 border border-gray-700 rounded-xl py-2.5 transition"
          >
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Finished Order summary modal ────────────────────────────────────────────

const FinishedOrderModal = ({ machineState, machineId, onConfirm, onCancel }) => {
  const [closing,   setClosing]   = useState(false);
  const [closeErr,  setCloseErr]  = useState(null);
  const { language } = useLanguage();
  const { t } = useTranslation(language);
  const goodCount       = machineState.pipeCounter   ?? 0;
  const ngCount         = machineState.ngCount        ?? 0;
  const totalGoodWeight = machineState.totalGoodWeight ?? 0;
  const totalNgWeight   = machineState.totalNgWeight   ?? 0;
  const totalItems      = goodCount + ngCount;

  const confirmLockRef = useRef(false);

  const handleConfirm = async () => {
    if (confirmLockRef.current || closing) return;
    confirmLockRef.current = true;
    setClosing(true);
    setCloseErr(null);
    try {
      // 1) บันทึกสรุปลง production sheet (machine-specific)
      await closeOrder({
        machineId,
        sheetName:        machineState.sheetName,
        orderId:          machineState.orderId,
        goodCount,
        totalGoodWeight,
        ngCount,
        totalNgWeight,
      });
    } catch (err) {
      // GAS/API fail — แสดง error ไม่ reset state เพื่อให้ลอง retry ได้
      setCloseErr(t('production.finishSaveSheetFailed', { msg: err.message }));
      setClosing(false);
      confirmLockRef.current = false;
      return;
    }

    try {
      await dbFinishSession(machineId, {
        goodCount,
        ngCount,
        totalGoodWeight,
        totalNgWeight,
        skipGasDispatch: true,
      });
      await storeScaleLive(machineId, { live: false });
    } catch (err) {
      setCloseErr(t('production.finishDbSessionFailed', { msg: err?.message ?? '' }));
      setClosing(false);
      confirmLockRef.current = false;
      return;
    }

    // 2) อัปเดตช่องกะใน Daily sheet + แผนการผลิต (fire-and-forget — ไม่ block)
    if (machineState.orderId && machineState.shift) {
      // ใช้ planDate (วันที่ของแถว Plan ที่กดเพิ่มคิว) ก่อน
      // fallback → startedAt → วันนี้
      const prodDate = machineState.planDate
        || (machineState.startedAt ? machineState.startedAt.slice(0, 10) : '')
        || new Date().toISOString().slice(0, 10);

      // 2a) Daily sheet — กะ A/B/C (เหมือนเดิม)
      updateDailyProduced({
        machineId,
        jobNo:    machineState.orderId,
        date:     prodDate,
        shift:    machineState.shift,
        produced: goodCount,
      }).catch(() => {});

      // 2b) แผนการผลิต sheet — บวกสะสมจำนวน + น้ำหนัก + รหัสพนักงาน
      updatePlanProduced({
        jobNo:       machineState.orderId,
        date:        prodDate,
        goodCount:   goodCount,
        goodWeight:  totalGoodWeight,
        ngWeight:    totalNgWeight,
        employeeId:  machineState.employeeId ?? '',
      }).catch(() => {});
    }

    onConfirm();
    setClosing(false);
    confirmLockRef.current = false;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-sm bg-gray-900 border border-green-500/30 rounded-2xl shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="bg-green-500/10 px-6 pt-6 pb-5 text-center">
          <div className="w-12 h-12 rounded-full bg-green-500/20 border border-green-400/30 flex items-center justify-center mx-auto mb-3">
            <svg className="w-6 h-6 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h3 className="text-lg font-bold text-white">{t('production.productionSummary')}</h3>
          <p className="text-xs text-gray-400 mt-1 font-mono">{machineState.orderId}</p>
        </div>

        {/* Summary grid */}
        <div className="px-6 py-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            {/* Total */}
            <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-3 text-center">
              <p className="text-[11px] text-gray-500 uppercase tracking-wider mb-1">{t('production.totalProduced')}</p>
              <p className="text-2xl font-bold font-mono text-white">{totalItems}</p>
              <p className="text-[11px] text-gray-600">{t('production.items')}</p>
            </div>
            {/* Good count */}
            <div className="bg-green-500/8 border border-green-500/25 rounded-xl p-3 text-center">
              <p className="text-[11px] text-green-500/80 uppercase tracking-wider mb-1">{t('production.goodItems')}</p>
              <p className="text-2xl font-bold font-mono text-green-300">{goodCount}</p>
              <p className="text-[11px] text-green-600">{totalGoodWeight.toFixed(2)} kg {t('production.totalWeight')}</p>
            </div>
          </div>

          {/* NG */}
          <div className="bg-red-500/8 border border-red-500/20 rounded-xl p-3 flex items-center justify-between">
            <div>
              <p className="text-[11px] text-red-400/70 uppercase tracking-wider">{t('production.ngItems')}</p>
              <p className="text-sm font-mono text-red-300 font-bold mt-0.5">{ngCount} {t('production.items')}</p>
            </div>
            <p className="text-lg font-bold font-mono text-red-300">{totalNgWeight.toFixed(2)} <span className="text-sm font-normal text-red-500">kg</span></p>
          </div>
        </div>

        {/* Error banner */}
        {closeErr && (
          <div className="mx-6 mb-4 px-4 py-3 bg-red-500/15 border border-red-500/30 rounded-xl">
            <p className="text-xs text-red-300 font-semibold mb-0.5">{t('production.saveFailed')}</p>
            <p className="text-xs text-red-400/80">{closeErr}</p>
            <p className="text-xs text-red-500/60 mt-1">{t('production.saveFailedHint')}</p>
          </div>
        )}

        {/* Buttons */}
        <div className="px-6 pb-6 flex gap-3">
          <button
            onClick={handleConfirm}
            disabled={closing}
            className="flex-1 flex items-center justify-center gap-2 bg-green-500 hover:bg-green-400 active:bg-green-600 disabled:opacity-50 text-gray-950 font-bold py-2.5 rounded-xl transition-all"
          >
            {closing ? <><Spinner /> {t('production.finishing')}</> : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                {t('production.confirmFinish')}
              </>
            )}
          </button>
          <button
            onClick={onCancel}
            disabled={closing}
            className="px-4 text-sm text-gray-400 hover:text-gray-200 border border-gray-700 hover:border-gray-500 rounded-xl transition disabled:opacity-40"
          >
            {t('production.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Main component ───────────────────────────────────────────────────────────

const LiveMonitoring = ({
  machineId,
  machineLabel,
  machineState,
  resumeScalePollSinceId, // GET scale-weight incremental cursor หลัง hydrate จากหน้า index (กัน poll ซ้ำรายการเก่า)
  canManageProduction = true,
  onWeightUpdate,   // (type: 'good'|'ng', weight: number, event) → update state
  onCloseOrder,
  onPauseAndStart,
  onCloseAndStart,
  onAddToQueue,
  onRemoveFromQueue, // optional: ลบรายการคิวออกจาก DB เมื่อ Live
  onCancelOrder,
}) => {
  const { language } = useLanguage();
  const { t } = useTranslation(language);
  const [showFinish, setShowFinish]         = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [toast, setToast]               = useState(null);
  const [switchTarget, setSwitchTarget] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showGoodList, setShowGoodList] = useState(false);
  const [showNgList,   setShowNgList]   = useState(false);

  const pollRef           = useRef(null);
  // ref เพื่อให้ tick ใน setInterval อ้างถึง onWeightUpdate เวอร์ชั่นล่าสุดเสมอ (ป้องกัน stale closure)
  const onWeightUpdateRef = useRef(onWeightUpdate);
  useEffect(() => { onWeightUpdateRef.current = onWeightUpdate; });

  // dedup — ป้องกัน server คืน event เดิมซ้ำ (pressedAt / eventId)
  const seenEventsRef = useRef(new Set());
  const sessionDedupKey = `${machineState?.orderId ?? ''}|${machineState?.sessionRunUlid ?? ''}`;
  useEffect(() => {
    seenEventsRef.current.clear();
  }, [sessionDedupKey]);

  const elapsed = useElapsedTime(machineState.startedAt);
  const queue   = machineState.queue ?? [];

  const goodCount       = machineState.pipeCounter    ?? 0;
  const ngCount         = machineState.ngCount         ?? 0;
  const totalGoodWeight = machineState.totalGoodWeight ?? 0;
  const totalNgWeight   = machineState.totalNgWeight   ?? 0;

  const showToast = (type, message, ms = 3500) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), ms);
  };

  // ค้างผลิต: ใช้ remainingQty จากแผน (คงที่) — ถ้าไม่มีใช้ targetQty ให้สอดคล้อง sidebar/แดชบอร์ด
  const backlog =
    (machineState.remainingQty ?? 0) > 0
      ? machineState.remainingQty
      : (machineState.targetQty ?? 0);
  const displayTarget = backlog ?? 0;

  const progress   = displayTarget > 0
    ? Math.min(100, Math.round((goodCount / displayTarget) * 100))
    : 0;
  const isComplete = displayTarget > 0 && goodCount >= displayTarget;

  // (pace indicator ถูกลบออก — ไม่เหมาะสำหรับงานหลายประเภทที่ความเร็วต่างกัน)

  // ── Process a single scale weight event (dedup + dispatch) ──────────────
  const processScaleEvent = useCallback((ev) => {
    const dedupKey = scaleEventDedupKey(ev);
    if (!dedupKey || seenEventsRef.current.has(dedupKey)) return;
    seenEventsRef.current.add(dedupKey);

    const weight = parseFloat(ev.weight) || 0;
    const type   = ev.type === 'good' ? 'good' : 'ng';
    onWeightUpdateRef.current(type, weight, ev);
    if (type === 'good') {
      showToast('success', `ของดี ✓  ${weight} kg`);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Listen for SSE-pushed scale_weight events (real-time, <300ms) ───────
  // These arrive from index.jsx via window CustomEvent
  useEffect(() => {
    if (!machineId) return;
    const handler = (e) => {
      if (e.detail?.machineId !== machineId) return;
      const ev = e.detail?.event;
      if (ev) processScaleEvent(ev);
    };
    window.addEventListener('sse:scale_weight', handler);
    return () => window.removeEventListener('sse:scale_weight', handler);
  }, [machineId, processScaleEvent]);

  // ── Listen for production_updated (GAS write confirmed) ──────────────────
  // index.jsx broadcasts this after the backend emits the SSE event.
  // machineState is already updated by index.jsx; we show a toast here.
  useEffect(() => {
    if (!machineId) return;
    const handler = (e) => {
      if (e.detail?.machineId !== machineId) return;
      const { qty_good, qty_remaining } = e.detail ?? {};
      if (typeof qty_good === 'number') {
        showToast('success', `ยืนยันแล้ว ✓  ดี ${qty_good}  ค้าง ${qty_remaining ?? '?'} ชิ้น`);
      }
    };
    window.addEventListener('sse:production_updated', handler);
    return () => window.removeEventListener('sse:production_updated', handler);
  }, [machineId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Listen for session_confirmed (operator confirmed on scale) ────────────
  // Shows a "Live Monitoring Active" toast on the currently viewed machine.
  useEffect(() => {
    if (!machineId) return;
    const handler = (e) => {
      if (e.detail?.machineId !== machineId) return;
      const { shift, employee_id } = e.detail ?? {};
      showToast(
        'success',
        `✓ ตาชั่งยืนยัน — กะ ${shift ?? '?'}  พนักงาน ${employee_id ?? '?'}`,
        5000,
      );
    };
    window.addEventListener('sse:session_confirmed', handler);
    return () => window.removeEventListener('sse:session_confirmed', handler);
  }, [machineId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fallback poll — ดึง events จาก production_weight_events ผ่าน API (incremental sinceId)
  const scaleEventsSinceIdRef = useRef(0);
  useEffect(() => {
    scaleEventsSinceIdRef.current = 0;
  }, [machineId, machineState?.sessionRunUlid, machineState?.orderId]);

  /** จาก ProductionMonitoring — เริ่ม poll จาก id ล่าสุดที่ hydrate จาก DB แล้ว */
  useEffect(() => {
    const n = Number(resumeScalePollSinceId);
    if (Number.isFinite(n) && n > 0 && n > scaleEventsSinceIdRef.current) {
      scaleEventsSinceIdRef.current = n;
    }
  }, [
    machineId,
    machineState?.sessionRunUlid,
    machineState?.orderId,
    resumeScalePollSinceId,
  ]);

  useEffect(() => {
    if (!machineId) return;

    const tick = async () => {
      try {
        const res = await fetchScaleWeights(machineId, {
          sinceId: scaleEventsSinceIdRef.current,
        });
        const events = res?.events ?? [];
        if (typeof res?.latestEventId === 'number' && res.latestEventId > scaleEventsSinceIdRef.current) {
          scaleEventsSinceIdRef.current = res.latestEventId;
        }
        for (const ev of events) processScaleEvent(ev);
      } catch {
        // ignore — SSE is primary
      }
    };

    pollRef.current = setInterval(tick, 5000);
    return () => clearInterval(pollRef.current);
  }, [machineId, machineState?.sessionRunUlid, machineState?.orderId, processScaleEvent]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="w-full max-w-[1600px] mx-auto space-y-3 xs:space-y-4 sm:space-y-5 lg:space-y-6 3xl:max-w-[1920px]">

      {/* Switch Order modal */}
      {canManageProduction && switchTarget && (
        <SwitchOrderModal
          targetItem={switchTarget}
          currentOrderId={machineState.orderId}
          machineId={machineId}
          sheetName={machineState.sheetName}
          ledIp={machineState.ledIp}
          onPauseAndStart={(item) => { setSwitchTarget(null); onPauseAndStart(item); }}
          onCloseAndStart={(item) => { setSwitchTarget(null); onCloseAndStart(item); }}
          onCancel={() => setSwitchTarget(null)}
        />
      )}

      {/* Finished Order summary modal */}
      {canManageProduction && showFinish && (
        <FinishedOrderModal
          machineState={machineState}
          machineId={machineId}
          onConfirm={() => { setShowFinish(false); onCloseOrder(); }}
          onCancel={() => setShowFinish(false)}
        />
      )}

      {/* Cancel Production confirm modal */}
      {canManageProduction && showCancelConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-gray-900 border border-red-500/40 rounded-2xl p-6 max-w-sm w-full shadow-2xl">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-red-500/15 flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
              </div>
              <h3 className="text-base font-bold text-red-300">{t('production.cancelOrder')}</h3>
            </div>
            <p className="text-sm text-gray-300 mb-1">
              Order: <span className="font-mono text-white">{machineState?.orderId}</span>
            </p>
            <p className="text-xs text-gray-500 mb-5">
              {language === 'mm'
                ? 'ဤ order ကိုဖျက်သိမ်းမည်။ မည်သည့် data မှ Google Sheet သို့ မသွားပါ။'
                : 'งานนี้จะถูกยกเลิกทั้งหมด ไม่มีการบันทึกข้อมูลใดๆ ลง Google Sheet'}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setShowCancelConfirm(false)}
                className="flex-1 py-2 rounded-xl border border-gray-600 text-gray-300 hover:bg-gray-800 text-sm font-medium transition-all"
              >
                {t('production.cancel')}
              </button>
              <button
                onClick={() => { setShowCancelConfirm(false); onCancelOrder?.(); }}
                className="flex-1 py-2 rounded-xl bg-red-500/20 hover:bg-red-500/30 border border-red-500/50 text-red-300 hover:text-red-100 text-sm font-semibold transition-all"
              >
                {language === 'mm' ? 'ဖျက်သိမ်းမည်' : 'ยืนยัน ยกเลิกงาน'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Weight event list — ของดี */}
      {showGoodList && (
        <WeightEventListModal
          type="good"
          events={machineState.goodEvents ?? []}
          totalWeight={machineState.totalGoodWeight ?? 0}
          minWeight={machineState.minWeight}
          maxWeight={machineState.maxWeight}
          onClose={() => setShowGoodList(false)}
        />
      )}

      {/* Weight event list — ของเสีย */}
      {showNgList && (
        <WeightEventListModal
          type="ng"
          events={machineState.ngEvents ?? []}
          totalWeight={machineState.totalNgWeight ?? 0}
          onClose={() => setShowNgList(false)}
        />
      )}


      {/* ── Header (compact) ── */}
      <div className="rounded-xl border border-gray-700/40 bg-gray-800/30 p-2.5 xs:p-3 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <div className="relative flex-shrink-0">
              <span className="block h-2.5 w-2.5 rounded-full bg-green-400 sm:h-3 sm:w-3" />
              <span className="absolute inset-0 h-2.5 w-2.5 animate-ping rounded-full bg-green-400 opacity-60 sm:h-3 sm:w-3" />
            </div>
            <div className="min-w-0">
              <span className="text-[9px] font-semibold uppercase tracking-widest text-green-400 xs:text-[10px] sm:text-[11px]">
                {t('production.liveMonitoring')}
              </span>
              <h2 className="truncate text-base font-bold text-white xs:text-lg sm:text-xl lg:text-2xl 3xl:text-3xl">
                {machineLabel}
              </h2>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2 rounded-lg border border-gray-700/50 bg-gray-900/70 px-2.5 py-1.5">
            <span className="text-[9px] uppercase tracking-wider text-gray-500 xs:text-[10px]">
              {t('production.runtime')}
            </span>
            <span className="font-mono text-sm font-bold tabular-nums text-gray-200 xs:text-base sm:text-lg lg:text-xl 3xl:text-2xl">
              {elapsed}
            </span>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-gray-700/30 pt-2 text-[11px] text-gray-400 xs:text-xs sm:text-sm">
          <span className="shrink-0">{t('production.order')}:</span>
          <span className="min-w-0 truncate font-mono text-white">{machineState.orderId}</span>
          {machineState.startedAt && (
            <>
              <span className="hidden text-gray-600 xs:inline">·</span>
              <span className="shrink-0 text-gray-500">
                {t('production.started')}{' '}
                <span className="font-mono text-gray-400">
                  {formatProductionTimeBangkok(machineState.startedAt)}
                </span>
              </span>
            </>
          )}
          {(machineState.employeeId || machineState.shift) && (
            <span className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
              {machineState.employeeId && (
                <span className="inline-flex items-center gap-1 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 font-mono text-[10px] text-indigo-300">
                  <svg className="h-3 w-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                  {machineState.employeeId}
                </span>
              )}
              {machineState.shift && (
                <span className="inline-flex items-center rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 font-mono text-[10px] text-violet-300">
                  {t('production.shiftLabel')} {machineState.shift}
                </span>
              )}
            </span>
          )}
        </div>
      </div>
      {/* Toast */}
      <Toast toast={toast} />


      {/* ── Stat cards ── */}
      <div className="grid grid-cols-2 gap-2 xs:gap-2.5 sm:gap-3 lg:grid-cols-12 lg:gap-4">
        <div className="col-span-2 lg:col-span-6">
          <StatCard
            label={t('production.productCodeLabel')}
            value={String(machineState.productCode || '').trim() || '—'}
            accent="cyan"
            numeric={false}
            compact
            subtext={
              [
                machineState.productName,
                machineState.size != null && `ขนาด ${machineState.size} มม.`,
                machineState.length != null && `ยาว ${machineState.length} ม.`,
                machineState.pn != null && `PN ${machineState.pn}`,
                machineState.brand && `ตรา${machineState.brand}`,
              ].filter(Boolean).join(' · ')
            }
          />
        </div>

        {machineState.stdWeight != null && (
          <div className="col-span-2 lg:col-span-12">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-amber-500/20 bg-amber-500/5 px-2.5 py-2 text-[10px] sm:px-4 sm:py-2.5 sm:text-xs">
              <span className="font-semibold uppercase tracking-widest text-amber-500/70">น้ำหนักมาตรฐาน</span>
              <span className="font-mono text-xs font-bold text-amber-300 sm:text-sm">
                {machineState.stdWeight} kg / ม้วน
              </span>
              {machineState.minWeight != null && machineState.maxWeight != null && (
                <span className="text-gray-500">
                  Min <span className="font-mono text-gray-300">{machineState.minWeight}</span>
                  {' — '}
                  Max <span className="font-mono text-gray-300">{machineState.maxWeight}</span> kg
                </span>
              )}
              {machineState.colorStripe && (
                <span className="text-gray-500">แถบสี: <span className="text-gray-300">{machineState.colorStripe}</span></span>
              )}
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={() => setShowGoodList(true)}
          className="col-span-1 text-left group rounded-xl ring-0 hover:ring-2 hover:ring-green-500/40 focus-visible:ring-2 focus-visible:ring-green-500 transition-all lg:col-span-3"
          title={t('production.titleShowGoodEvents')}
        >
          <StatCard
            label="ของดี / ค้างผลิต ▸"
            value={goodCount}
            unit={`/ ${displayTarget}`}
            accent="green"
            compact
            subtext={t('production.totalWeightKg', { weight: totalGoodWeight.toFixed(2) })}
          />
        </button>

        <button
          type="button"
          onClick={() => setShowNgList(true)}
          className="col-span-1 text-left group rounded-xl ring-0 hover:ring-2 hover:ring-red-500/40 focus-visible:ring-2 focus-visible:ring-red-500 transition-all lg:col-span-3"
          title={t('production.titleShowNgEvents')}
        >
          <StatCard
            label={t('production.ngLabel')}
            value={ngCount}
            unit={t('production.items')}
            accent="red"
            compact
            subtext={t('production.totalWeightKg', { weight: totalNgWeight.toFixed(2) })}
          />
        </button>
      </div>

      {/* ── Progress bar ── */}
      <div className="rounded-xl border border-gray-700/50 bg-gray-800/50 p-2.5 sm:p-4">
        <div className="mb-1.5 flex items-center gap-2">
          <span className="shrink-0 text-xs text-gray-400 sm:text-sm">{t('production.progressLabel')}</span>
          <span className={`shrink-0 text-xs font-mono font-bold tabular-nums sm:text-sm ${isComplete ? 'text-green-400' : 'text-cyan-400'}`}>
            {goodCount}/{displayTarget} ({progress}%)
          </span>
          <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-gray-700 sm:h-2.5">
            <div
              className={`h-full rounded-full transition-all duration-700 ease-out ${isComplete ? 'bg-green-400' : 'bg-gradient-to-r from-cyan-600 to-cyan-400'}`}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
        {isComplete && (
          <p className="mt-1.5 flex items-center gap-1 text-xs font-semibold text-green-400 sm:text-sm">
            <svg className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {t('production.targetReached')}
          </p>
        )}
      </div>

      {/* ── Action buttons ── */}
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center sm:gap-2">
        <div className="col-span-2 flex min-h-[36px] items-center gap-2 rounded-lg border border-cyan-500/20 bg-cyan-500/8 px-2.5 py-2 font-mono text-[10px] text-cyan-400/70 xs:text-xs sm:col-span-1 sm:min-h-[40px] sm:flex-initial sm:px-3">
          <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-cyan-400" />
          <span className="truncate">{t('production.autoFromScale')}</span>
        </div>

        {canManageProduction && (
          <>
            <button
              type="button"
              onClick={() => setShowFinish(true)}
              className="flex min-h-[36px] items-center justify-center gap-1.5 rounded-lg border border-green-500/50 bg-green-500/15 px-2 py-2 text-xs font-semibold text-green-300 transition-all hover:border-green-400 hover:bg-green-500/25 hover:text-green-100 sm:min-h-[40px] sm:px-3 sm:text-sm"
            >
              <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
              </svg>
              <span className="truncate">{t('production.finishedOrder')}</span>
            </button>

            <button
              type="button"
              onClick={() => setShowCancelConfirm(true)}
              className="flex min-h-[36px] items-center justify-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/8 px-2 py-2 text-xs font-medium text-red-400/80 transition-all hover:border-red-500/60 hover:bg-red-500/15 hover:text-red-300 sm:min-h-[40px] sm:px-3 sm:text-sm"
            >
              <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              <span className="truncate">{t('production.cancelOrder')}</span>
            </button>
          </>
        )}
      </div>
      {/* ── Queue panel (always visible while live) ── */}
      <div className="rounded-xl border border-gray-700/40 bg-gray-800/40 p-2.5 xs:p-3 sm:p-4">
        {/* Header */}
        <div className="mb-2 flex items-center justify-between sm:mb-3">
          <div className="flex items-center gap-2">
          <h3 className="text-xs font-semibold tracking-widest text-gray-500 uppercase">
            {t('production.nextInQueue')}
          </h3>
          {queue.length > 0 && (
              <span className="text-[11px] font-bold bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 px-2 py-0.5 rounded-full">
                {queue.length} {t('production.items')}
              </span>
            )}
          </div>
          {/* <div className="flex items-center gap-2">
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-1.5 text-xs font-semibold bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/40 text-cyan-400 px-2.5 py-1 rounded-lg transition-all"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              เพิ่มรายการ
            </button>
          </div> */}
        </div>

        {/* Queue items */}
        {queue.length === 0 ? (
          <p className="text-sm text-gray-600 text-center py-4">{t('production.noItemsInQueue')}</p>
        ) : (
          <div className="space-y-2.5">
            {queue.map((item, index) => (
              <div
                key={item.queueId}
                className="rounded-lg border border-gray-700/50 bg-gray-900/60 px-2.5 py-2 sm:rounded-xl sm:px-3 sm:py-2.5"
              >
                <div className="flex items-start gap-2 sm:gap-3">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gray-700/80 text-[10px] font-bold text-gray-400 sm:h-6 sm:w-6 sm:text-[11px]">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    {/* เลขใบขอ + รหัสสินค้า */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold font-mono text-white">{item.orderId}</span>
                      {item.productCode && (
                        <span className="text-[10px] font-mono text-cyan-400/70 bg-gray-800 border border-gray-700/50 px-1.5 py-0.5 rounded">
                          {item.productCode}
                        </span>
                      )}
                    </div>
                    {/* ชื่อสินค้า */}
                    {item.productName && (
                      <p className="text-xs text-gray-400 leading-snug mt-0.5">{item.productName}</p>
                    )}
                    {/* detail row */}
                    <div className="flex flex-wrap gap-x-2.5 gap-y-0 mt-1">
                      {item.size != null && (
                        <span className="text-[10px] text-gray-600">ขนาด <span className="text-gray-400">{item.size}</span> มม.</span>
                      )}
                      {item.length != null && (
                        <span className="text-[10px] text-gray-600">ยาว <span className="text-gray-400">{item.length}</span> ม.</span>
                      )}
                      {item.pn != null && (
                        <span className="text-[10px] text-gray-600">PN <span className="text-gray-400">{item.pn}</span></span>
                      )}
                      {item.brand && (
                        <span className="text-[10px] text-gray-600">ตรา <span className="text-gray-400">{item.brand}</span></span>
                      )}
                      {item.stdWeight > 0 && (
                        <span className="text-[10px] text-gray-600">
                          น้ำหนัก <span className="text-amber-400/80 font-mono">{item.stdWeight}</span>
                          <span className="text-gray-600"> kg</span>
                        </span>
                      )}
                      {item.minWeight > 0 && item.maxWeight > 0 && (
                        <span className="text-[10px] font-mono text-gray-600">
                          Min <span className="text-yellow-600/80">{item.minWeight}</span>
                          {' – '}Max <span className="text-yellow-600/80">{item.maxWeight}</span>
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="rounded-full border border-gray-700 bg-gray-800 px-1.5 py-0.5 text-[10px] font-mono font-bold text-cyan-400 sm:px-2 sm:text-[11px]">
                      ×{item.remainingQty > 0 ? item.remainingQty : item.targetQty}
                    </span>
                    <div className="flex flex-wrap justify-end gap-1">
                  {onRemoveFromQueue && item.queueId && (
                    <button
                      type="button"
                      onClick={() => onRemoveFromQueue(item.queueId)}
                      className="flex items-center gap-0.5 rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1 text-[10px] font-semibold text-red-400 transition-all hover:bg-red-500/15 sm:gap-1 sm:rounded-lg sm:px-2.5 sm:py-1.5 sm:text-xs"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                      {t('production.removeFromQueue')}
                    </button>
                  )}
                  {canManageProduction && (
                    <button
                      type="button"
                      onClick={() => setSwitchTarget(item)}
                      className="flex items-center gap-0.5 rounded-md border border-green-500/30 bg-green-500/10 px-2 py-1 text-[10px] font-semibold text-green-400 transition-all hover:bg-green-500/20 sm:gap-1 sm:rounded-lg sm:px-2.5 sm:py-1.5 sm:text-xs"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                      </svg>
                      {t('production.switchBtn')}
                    </button>
                  )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add to Queue modal */}
      {showAddModal && (
        <AddToQueueModal
          onAdd={onAddToQueue}
          onClose={() => setShowAddModal(false)}
        />
      )}
    </div>
  );
};

export default LiveMonitoring;
