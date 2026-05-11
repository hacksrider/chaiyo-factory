import React, { useState, useEffect, useRef, useCallback } from 'react';
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
  const [warn, setWarn]     = useState(null);
  const { language } = useLanguage();
  const { t } = useTranslation(language);

  const run = async (mode) => {
    setBusy(true);
    setAction(mode);
    setWarn(null);

    if (mode === 'close') {
      try {
        await closeOrder({ machineId, sheetName, orderId: currentOrderId });
      } catch (err) {
        console.warn('[SwitchModal] closeOrder API error:', err.message);
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
      console.warn('[SwitchModal] createOrder API error:', err.message);
      setWarn(t('production.switchOrderCreateFailed', { msg: err.message }));
      setBusy(false);
      return;
    }

    if (mode === 'pause') onPauseAndStart(targetItem);
    else                  onCloseAndStart(targetItem);

    setBusy(false);
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

const WeightEventListModal = ({ type, events, totalWeight, onClose }) => {
  const isGood = type === 'good';
  const { language } = useLanguage();
  const { t } = useTranslation(language);
  const title  = isGood ? t('production.goodListTitle') : t('production.ngListTitle');
  const accent = isGood
    ? { bg: 'bg-green-500/8', border: 'border-green-500/25', header: 'bg-green-500/10 border-green-500/20', title: 'text-green-300', badge: 'bg-green-500/15 border-green-500/30 text-green-400', dot: 'bg-green-400', row: 'text-green-200', rowBg: 'bg-green-500/5 border-green-500/15' }
    : { bg: 'bg-red-500/8',   border: 'border-red-500/20',   header: 'bg-red-500/10 border-red-500/20',   title: 'text-red-300',   badge: 'bg-red-500/15   border-red-500/30   text-red-400',   dot: 'bg-red-400',   row: 'text-red-200',   rowBg: 'bg-red-500/5   border-red-500/15'   };

  // sort: 'desc' = ล่าสุดอยู่บน, 'asc' = เวลาเก่าอยู่บน (default)
  const [sortMode, setSortMode] = useState('asc');

  const fmt = (isoStr) => {
    if (!isoStr) return '—';
    try {
      const d = new Date(isoStr);
      if (isNaN(d.getTime())) return isoStr;
      return d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch { return isoStr; }
  };

  const fmtDate = (isoStr) => {
    if (!isoStr) return '';
    try {
      const d = new Date(isoStr);
      if (isNaN(d.getTime())) return '';
      return d.toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch { return ''; }
  };

  const toTs = (isoStr) => {
    if (!isoStr) return NaN;
    const d = new Date(isoStr);
    const t = d.getTime();
    return isNaN(t) ? NaN : t;
  };

  const base = [...(events ?? [])];
  base.sort((a, b) => {
    const ta = toTs(a?.pressedAt);
    const tb = toTs(b?.pressedAt);
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
              {events?.length ?? 0} {t('production.items')}
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
            list.map((ev, idx) => (
              <div
                key={idx}
                className={`flex items-center gap-3 rounded-xl border px-4 py-2.5 ${accent.rowBg}`}
              >
                {/* Sequence number */}
                <span className="flex-shrink-0 w-7 h-7 rounded-full bg-gray-800 text-gray-400 text-[11px] font-bold flex items-center justify-center">
                  {sortMode === 'asc' ? (idx + 1) : (list.length - idx)}
                </span>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-mono font-semibold ${accent.row}`}>
                    {parseFloat(ev.weight).toFixed(3)} kg
                  </p>
                  <p className="text-[11px] text-gray-500 mt-0.5">
                    {fmtDate(ev.pressedAt) && (
                      <span className="mr-1.5">{fmtDate(ev.pressedAt)}</span>
                    )}
                    {fmt(ev.pressedAt)}
                  </p>
                </div>
              </div>
            ))
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

  const handleConfirm = async () => {
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
      console.warn('[FinishedOrderModal] closeOrder API error:', err.message);
      setCloseErr(t('production.finishSaveSheetFailed', { msg: err.message }));
      setClosing(false);
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
      console.warn('[FinishedOrderModal] dbFinishSession / storeScaleLive error:', err?.message);
      setCloseErr(t('production.finishDbSessionFailed', { msg: err?.message ?? '' }));
      setClosing(false);
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
      }).catch((err) => console.warn('[FinishedOrderModal] updateDailyProduced error:', err.message));

      // 2b) แผนการผลิต sheet — บวกสะสมจำนวน + น้ำหนัก + รหัสพนักงาน
      updatePlanProduced({
        jobNo:       machineState.orderId,
        date:        prodDate,
        goodCount:   goodCount,
        goodWeight:  totalGoodWeight,
        ngWeight:    totalNgWeight,
        employeeId:  machineState.employeeId ?? '',
      }).catch((err) => console.warn('[FinishedOrderModal] updatePlanProduced error:', err.message));
    }

    onConfirm();
    setClosing(false);
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

  // dedup — ป้องกัน server คืน event เดิมซ้ำ (pressedAt เป็น unique key ต่อ session)
  const seenEventsRef = useRef(new Set());
  // ล้าง seen set เมื่อเปลี่ยน machine หรือ order (orderId เปลี่ยน = session ใหม่)
  const prevOrderIdRef = useRef(null);
  const curOrderId = machineState?.orderId ?? null;
  if (curOrderId !== prevOrderIdRef.current) {
    prevOrderIdRef.current = curOrderId;
    seenEventsRef.current.clear();
  }

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
    const dedupKey = (() => {
      if (ev?.eventId != null && ev.eventId !== '') return `eid:${ev.eventId}`;
      const w = Number(ev.weight);
      const wKey = Number.isFinite(w) ? w.toFixed(4) : String(ev.weight ?? '');
      return `${ev.pressedAt || ''}_${wKey}_${ev.type || ''}`;
    })();
    if (seenEventsRef.current.has(dedupKey)) return;
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
    <div className="space-y-6 w-full">

      {/* Switch Order modal */}
      {switchTarget && (
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
      {showFinish && (
        <FinishedOrderModal
          machineState={machineState}
          machineId={machineId}
          onConfirm={() => { setShowFinish(false); onCloseOrder(); }}
          onCancel={() => setShowFinish(false)}
        />
      )}

      {/* Cancel Production confirm modal */}
      {showCancelConfirm && (
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

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <div className="relative flex-shrink-0">
              <span className="block w-3 h-3 rounded-full bg-green-400" />
              <span className="absolute inset-0 w-3 h-3 rounded-full bg-green-400 animate-ping opacity-60" />
            </div>
            <span className="text-[11px] font-semibold tracking-widest text-green-400 uppercase">{t('production.liveMonitoring')}</span>
          </div>
          <h2 className="text-2xl font-bold text-white">{machineLabel}</h2>
          <p className="text-sm text-gray-400 mt-1">
            {t('production.order')}: <span className="text-white font-mono">{machineState.orderId}</span>
            {machineState.startedAt && (
              <span className="ml-3 text-gray-600">{t('production.started')} {new Date(machineState.startedAt).toLocaleTimeString()}</span>
            )}
          </p>
          {/* แสดงพนักงานและกะ (จาก Scale ESP32 confirm) */}
          {(machineState.employeeId || machineState.shift) && (
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              {machineState.employeeId && (
                <span className="inline-flex items-center gap-1.5 text-[11px] font-mono bg-indigo-500/10 border border-indigo-500/30 text-indigo-300 px-2.5 py-1 rounded-full">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                  {t('production.employee')}: {machineState.employeeId}
                </span>
              )}
              {machineState.shift && (
                <span className="inline-flex items-center gap-1.5 text-[11px] font-mono bg-violet-500/10 border border-violet-500/30 text-violet-300 px-2.5 py-1 rounded-full">
                  {t('production.shiftLabel')} {machineState.shift}
                </span>
              )}
            </div>
          )}
          {/* {(machineState.sheetName || machineState.ledIp) && (
            <div className="flex flex-wrap gap-2 mt-2">
              {machineState.sheetName && (
                <span className="inline-flex items-center gap-1.5 text-[11px] font-mono bg-gray-800/80 border border-gray-700 text-gray-500 px-2.5 py-1 rounded-full">
                  <svg className="w-3 h-3 text-cyan-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                  Sheet: {machineState.sheetName}
                </span>
              )}
              {machineState.ledIp && (
                <span className="inline-flex items-center gap-1.5 text-[11px] font-mono bg-gray-800/80 border border-gray-700 text-gray-500 px-2.5 py-1 rounded-full">
                  <svg className="w-3 h-3 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
                  LED: {machineState.ledIp}
                </span>
              )}
            </div>
          )} */}
        </div>

        {/* Elapsed timer */}
        <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl px-5 py-3 text-right">
          <p className="text-[11px] text-gray-500 uppercase tracking-wider mb-1">{t('production.runtime')}</p>
          <p className="text-3xl font-mono font-bold text-gray-200 tabular-nums">{elapsed}</p>
        </div>
      </div>

      {/* Toast */}
      <Toast toast={toast} />

      {/* ── Stat cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {/* Product */}
        <div className="col-span-2 sm:col-span-2">
          <StatCard
            label={t('production.productCodeLabel')}
            value={String(machineState.productCode || '').trim() || '—'}
            accent="cyan"
            numeric={false}
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

        {/* น้ำหนักมาตรฐาน — แสดงเฉพาะเมื่อมีข้อมูล */}
        {machineState.stdWeight != null && (
          <div className="col-span-2 sm:col-span-4">
            <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl px-4 py-2.5 flex items-center gap-4 flex-wrap">
              <span className="text-[10px] font-semibold tracking-widest text-amber-500/70 uppercase">น้ำหนักมาตรฐาน</span>
              <span className="text-sm font-mono font-bold text-amber-300">
                {machineState.stdWeight} kg / ม้วน
              </span>
              {machineState.minWeight != null && machineState.maxWeight != null && (
                <span className="text-xs text-gray-500">
                  Min <span className="text-gray-300 font-mono">{machineState.minWeight}</span>
                  {' — '}
                  Max <span className="text-gray-300 font-mono">{machineState.maxWeight}</span>
                  {' kg'}
                </span>
              )}
              {machineState.colorStripe && (
                <span className="text-xs text-gray-500">แถบสี: <span className="text-gray-300">{machineState.colorStripe}</span></span>
              )}
            </div>
          </div>
        )}
        {/* Progress — คลิกดูรายการ */}
        <button
          type="button"
          onClick={() => setShowGoodList(true)}
          className="text-left group rounded-xl ring-0 hover:ring-2 hover:ring-green-500/40 focus-visible:ring-2 focus-visible:ring-green-500 transition-all"
          title={t('production.titleShowGoodEvents')}
        >
          <StatCard
            label="ของดี / ค้างผลิต ▸"
            value={goodCount}
            unit={`/ ${displayTarget}`}
            accent="green"
            subtext={t('production.totalWeightKg', { weight: totalGoodWeight.toFixed(2) })}
          />
        </button>
        {/* NG — คลิกดูรายการ */}
        <button
          type="button"
          onClick={() => setShowNgList(true)}
          className="text-left group rounded-xl ring-0 hover:ring-2 hover:ring-red-500/40 focus-visible:ring-2 focus-visible:ring-red-500 transition-all"
          title={t('production.titleShowNgEvents')}
        >
          <StatCard
            label={t('production.ngLabel')}
            value={ngCount}
            unit={t('production.items')}
            accent="red"
            subtext={t('production.totalWeightKg', { weight: totalNgWeight.toFixed(2) })}
          />
        </button>
      </div>

      {/* ── Progress bar ── */}
      <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
        <div className="flex justify-between items-center mb-2">
          <span className="text-sm text-gray-400">{t('production.progressLabel')}</span>
          <span className={`text-sm font-mono font-bold tabular-nums ${isComplete ? 'text-green-400' : 'text-cyan-400'}`}>
            {goodCount} / {displayTarget} &nbsp;({progress}%)
          </span>
        </div>
        <div className="h-3 bg-gray-700 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ease-out ${isComplete ? 'bg-green-400' : 'bg-gradient-to-r from-cyan-600 to-cyan-400'}`}
            style={{ width: `${progress}%` }}
          />
        </div>
        {isComplete && (
          <p className="flex items-center gap-1.5 text-sm text-green-400 font-semibold mt-2.5">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {t('production.targetReached')}
          </p>
        )}
      </div>

      {/* ── Action buttons (ของดี/ของเสียถูกลบออก — รับจากตาชั่ง Scale ESP32 โดยตรง) ── */}
      <div className="flex flex-wrap gap-3">
        {/* Scale status indicator */}
        <div className="flex items-center gap-2 bg-cyan-500/8 border border-cyan-500/20 text-cyan-400/70 text-xs font-mono px-4 py-2.5 rounded-xl">
          <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse flex-shrink-0" />
          {t('production.autoFromScale')}
        </div>

        {/* Finished Order */}
        <button
          onClick={() => setShowFinish(true)}
          className="flex items-center gap-2 bg-green-500/15 hover:bg-green-500/25 border border-green-500/50 hover:border-green-400 text-green-300 hover:text-green-100 font-semibold py-2.5 px-5 rounded-xl transition-all"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
          </svg>
          {t('production.finishedOrder')}
        </button>

        {/* Cancel Production */}
        <button
          onClick={() => setShowCancelConfirm(true)}
          className="flex items-center gap-2 bg-red-500/8 hover:bg-red-500/15 border border-red-500/30 hover:border-red-500/60 text-red-400/80 hover:text-red-300 font-medium py-2.5 px-4 rounded-xl transition-all"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
          {t('production.cancelOrder')}
        </button>
      </div>

      {/* ── Queue panel (always visible while live) ── */}
      <div className="bg-gray-800/40 border border-gray-700/40 rounded-2xl p-5">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
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
                className="bg-gray-900/60 border border-gray-700/50 rounded-xl px-4 py-3 flex flex-col gap-1.5"
              >
                <div className="flex items-start gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-gray-700/80 text-gray-400 text-[11px] font-bold flex items-center justify-center mt-0.5">
                    {index + 1}
                  </span>
                  <div className="flex-1 min-w-0">
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
                  <div className="flex-shrink-0 flex flex-col items-end gap-0.5">
                    <span className="text-[11px] font-mono font-bold text-cyan-400 bg-gray-800 border border-gray-700 px-2 py-0.5 rounded-full">
                      ×{item.remainingQty > 0 ? item.remainingQty : item.targetQty}
                    </span>
                    {item.remainingQty > 0 && (
                      <span className="text-[9px] text-gray-600">ค้างผลิต</span>
                    )}
                  </div>
                </div>
                <div className="flex justify-end flex-wrap gap-2">
                  {onRemoveFromQueue && item.queueId && (
                    <button
                      type="button"
                      onClick={() => onRemoveFromQueue(item.queueId)}
                      className="flex items-center gap-1 text-xs font-semibold bg-red-500/10 hover:bg-red-500/15 border border-red-500/30 text-red-400 px-2.5 py-1.5 rounded-lg transition-all"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                      {t('production.removeFromQueue')}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setSwitchTarget(item)}
                    className="flex items-center gap-1.5 text-xs font-semibold bg-green-500/10 hover:bg-green-500/20 border border-green-500/30 text-green-400 px-3 py-1.5 rounded-lg transition-all"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                    </svg>
                    {t('production.switchBtn')}
                  </button>
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
