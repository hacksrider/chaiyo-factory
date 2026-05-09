import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useLanguage } from '../../../contexts/LanguageContext';
import { useTranslation } from '../../../utils/translations';
import { fetchDailyPlan, fetchProductDetails } from '../api/productionApi';

// ─── Format helpers ───────────────────────────────────────────────────────────

const toLocalDate = (isoStr) => {
  if (!isoStr) return null;
  const s = String(isoStr);
  const d = new Date(s.length === 10 ? s + 'T00:00:00' : s);
  return isNaN(d) ? null : d;
};

const fmtDate = (isoStr) => {
  const d = toLocalDate(isoStr);
  if (!d) return '—';
  return d.toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: '2-digit' });
};

const fmtNum = (n, dec = 0) => {
  const num = Number(n);
  if (n === null || n === undefined || n === '' || isNaN(num)) return '—';
  return num.toLocaleString('th-TH', { minimumFractionDigits: dec, maximumFractionDigits: dec });
};

const pct = (produced, planned) => {
  if (!planned || planned <= 0) return 0;
  return Math.min(100, Math.round((Number(produced) / Number(planned)) * 100));
};

const MONTH_TH = ['', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

// ─── Sub-components ───────────────────────────────────────────────────────────

const Spinner = ({ className = 'w-4 h-4' }) => (
  <svg className={`${className} animate-spin`} fill="none" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
  </svg>
);

const StatusBadge = ({ status, t }) => {
  const s = String(status ?? '').trim();
  if (s === 'Complete')
    return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-500/15 border border-green-500/30 text-green-400">{t('production.planComplete')}</span>;
  if (s === 'Inprocess')
    return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-400">{t('production.planInprocess')}</span>;
  return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-700/60 border border-gray-600/40 text-gray-400">{s || '—'}</span>;
};

// ─── DailyTable — per-shift breakdown from Daily sheet ────────────────────────

const DailyTable = ({ rows, t }) => {
  if (!rows || rows.length === 0)
    return <p className="text-xs text-gray-600 text-center py-4">{t('production.planDailyEmpty')}</p>;

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-700/40">
      <table className="w-full text-xs text-gray-400 border-collapse min-w-[520px]">
        <thead>
          <tr className="bg-gray-800/60 border-b border-gray-700/50">
            <th className="text-left py-2 px-3 text-gray-500 font-semibold">{t('production.planColDate')}</th>
            <th className="text-center py-2 px-2 text-blue-400 font-semibold">{t('production.planColShiftA')}</th>
            <th className="text-center py-2 px-2 text-purple-400 font-semibold">{t('production.planColShiftB')}</th>
            <th className="text-center py-2 px-2 text-orange-400 font-semibold">{t('production.planColShiftC')}</th>
            <th className="text-center py-2 px-2 text-cyan-400 font-semibold">{t('production.planColTotal')}</th>
            <th className="text-center py-2 px-2 text-gray-500 font-semibold">{t('production.planColTargetPerDay')}</th>
            <th className="text-right py-2 px-3 text-gray-500 font-semibold">%</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const p = Number(row.achievementPct) || 0;
            const pctColor = p >= 100 ? 'text-green-400' : p >= 80 ? 'text-cyan-400' : p >= 60 ? 'text-amber-400' : 'text-red-400';
            return (
              <tr key={i} className="border-b border-gray-800/40 hover:bg-gray-800/30 transition-colors">
                <td className="py-2 px-3 font-mono text-gray-300">{fmtDate(row.date)}</td>
                <td className="py-2 px-2 text-center font-mono text-blue-300">{row.shiftA || '—'}</td>
                <td className="py-2 px-2 text-center font-mono text-purple-300">{row.shiftB || '—'}</td>
                <td className="py-2 px-2 text-center font-mono text-orange-300">{row.shiftC || '—'}</td>
                <td className="py-2 px-2 text-center font-mono font-semibold text-cyan-300">{row.totalProduced || '—'}</td>
                <td className="py-2 px-2 text-center font-mono text-gray-500">{row.targetPerDay || '—'}</td>
                <td className={`py-2 px-3 text-right font-mono font-bold ${pctColor}`}>
                  {p > 0 ? `${p.toFixed(0)}%` : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
        {/* Summary row */}
        {rows.length > 1 && (
          <tfoot>
            <tr className="bg-gray-800/40 border-t border-gray-700/50">
              <td className="py-2 px-3 text-xs font-semibold text-gray-400">
                {t('production.planDaysCount', { count: rows.length })}
              </td>
              <td className="py-2 px-2 text-center font-mono font-bold text-blue-300">
                {fmtNum(rows.reduce((s, r) => s + (Number(r.shiftA) || 0), 0))}
              </td>
              <td className="py-2 px-2 text-center font-mono font-bold text-purple-300">
                {fmtNum(rows.reduce((s, r) => s + (Number(r.shiftB) || 0), 0))}
              </td>
              <td className="py-2 px-2 text-center font-mono font-bold text-orange-300">
                {fmtNum(rows.reduce((s, r) => s + (Number(r.shiftC) || 0), 0))}
              </td>
              <td className="py-2 px-2 text-center font-mono font-bold text-cyan-300">
                {fmtNum(rows.reduce((s, r) => s + (Number(r.totalProduced) || 0), 0))}
              </td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
};

// ─── PlanOrderCard ────────────────────────────────────────────────────────────

const PlanOrderCard = ({ order, machineId, onAddToQueue, isHistory, productDetails }) => {
  const { language } = useLanguage();
  const { t } = useTranslation(language);

  const [expanded,     setExpanded]     = useState(false);
  const [dailyRows,    setDailyRows]    = useState([]);
  const [dailyLoading, setDailyLoading] = useState(false);
  const [dailyError,   setDailyError]   = useState(null);
  const dailyFetched = useRef(false);

  const handleToggle = async () => {
    const next = !expanded;
    setExpanded(next);
    if (next && !dailyFetched.current) {
      dailyFetched.current = true;
      setDailyLoading(true);
      setDailyError(null);
      try {
        const params = { jobNo: order.jobNo };
        if (machineId) params.machine = machineId;
        const rows = await fetchDailyPlan(params);
        setDailyRows(Array.isArray(rows) ? rows : []);
      } catch (e) {
        setDailyError(e.message);
        dailyFetched.current = false;
      } finally {
        setDailyLoading(false);
      }
    }
  };

  const produced  = Number(order.producedQty)       || 0;
  const planned   = Number(order.plannedQty)         || 0;
  const remaining = Math.max(0, planned - produced);
  const progress  = pct(produced, planned);

  const goodWt    = Number(order.goodWeight)         || 0;
  const ngWt      = Number(order.ngWeight)           || 0;
  const totalWt   = Number(order.totalOrderWeight)   || 0;
  const wtPerUnit = Number(order.weightPerUnit)      || 0;
  const diffDays  = Number(order.diff)               || 0;

  const handleAddToQueue = () => {
    const code   = String(order.productCode || '');
    const detail = (code && productDetails) ? (productDetails[code] || null) : null;
    onAddToQueue?.({
      orderId:      String(order.jobNo),
      productCode:  code,
      productName:  detail?.name || order.productName || code || '',
      targetQty:    remaining > 0 ? remaining : planned,
      remainingQty: remaining,
      planData:     order,
      // ข้อมูลจาก Sheet Product
      peType:      detail?.peType      ?? '',
      size:        detail?.size        ?? null,
      length:      detail?.length      ?? null,
      pn:          detail?.pn          ?? null,
      brand:       detail?.brand       ?? '',
      colorStripe: detail?.colorStripe ?? '',
      stdWeight:   detail?.stdWeight   ?? null,
      minWeight:   detail?.minWeight   ?? null,
      maxWeight:   detail?.maxWeight   ?? null,
    });
  };

  const cardBorder = isHistory
    ? 'bg-gray-800/20 border-gray-700/30'
    : 'bg-amber-500/5 border-amber-500/20 hover:border-amber-400/40';

  return (
    <div className={`rounded-2xl border transition-all ${cardBorder}`}>
      <div className="p-5">

        {/* ── Row 1: Job no + badges + actions ── */}
        <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <span className="font-mono font-bold text-white text-base leading-none">{order.jobNo}</span>
            <StatusBadge status={order.status} t={t} />
            {order.productCode && (
              <span className="text-[11px] font-mono text-gray-500 bg-gray-800 border border-gray-700 px-2 py-0.5 rounded-full">
                {order.productCode}
              </span>
            )}
            {order.productType && (
              <span className="text-[11px] text-gray-600 bg-gray-800/60 border border-gray-700/40 px-2 py-0.5 rounded-full">
                {order.productType}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {!isHistory && onAddToQueue && (
              <button
                onClick={handleAddToQueue}
                className="flex items-center gap-1.5 text-xs font-semibold bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/40 text-cyan-400 hover:text-cyan-200 px-3 py-1.5 rounded-lg transition-all"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                {t('production.planAddToQueue')}
              </button>
            )}
            <button
              onClick={handleToggle}
              className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-200 border border-gray-700/50 hover:border-gray-600 px-3 py-1.5 rounded-lg transition-all"
            >
              <svg className={`w-3.5 h-3.5 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
              {expanded ? t('production.planCollapse') : t('production.planDetails')}
            </button>
          </div>
        </div>

        {/* ── Row 2: Product name + supplier ── */}
        <p className="text-sm font-medium text-gray-200 leading-snug mb-0.5">{order.productName || '—'}</p>
        {order.supplier && (
          <p className="text-xs text-gray-500 mb-3">
            <span className="text-gray-600">{t('production.planCustomer')}</span>{' '}
            <span className="text-gray-400">{order.supplier}</span>
          </p>
        )}

        {/* ── Row 3: Progress bar ── */}
        <div className="mb-4">
          <div className="flex justify-between items-center mb-1.5">
            <span className="text-xs text-gray-500">{t('production.planProgress')}</span>
            <span className={`text-xs font-mono font-semibold tabular-nums ${progress >= 100 ? 'text-green-400' : 'text-cyan-400'}`}>
              {fmtNum(produced)} / {fmtNum(planned)} ({progress}%)
            </span>
          </div>
          <div className="h-2.5 bg-gray-700/60 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-700 ease-out ${progress >= 100 ? 'bg-green-400' : 'bg-gradient-to-r from-cyan-600 to-cyan-400'}`}
              style={{ width: `${progress}%` }}
            />
          </div>
          {remaining > 0 && !isHistory && (
            <p className="text-[11px] text-amber-400/80 mt-1.5">
              {t('production.planRemaining', { count: fmtNum(remaining) })}
            </p>
          )}
        </div>

        {/* ── Row 4: Stats grid ── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
          <div className="bg-gray-800/50 rounded-xl p-3">
            <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-1">{t('production.planWeightPerUnit')}</p>
            <p className="text-sm font-mono font-bold text-gray-300">
              {fmtNum(wtPerUnit, 2)} <span className="text-xs font-normal text-gray-600">kg</span>
            </p>
          </div>
          <div className="bg-gray-800/50 rounded-xl p-3">
            <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-1">{t('production.planTotalWeight')}</p>
            <p className="text-sm font-mono font-bold text-gray-300">
              {fmtNum(totalWt)} <span className="text-xs font-normal text-gray-600">kg</span>
            </p>
          </div>
          <div className="bg-green-500/8 rounded-xl p-3 border border-green-500/15">
            <p className="text-[10px] text-green-600/80 uppercase tracking-wider mb-1">{t('production.planGoodWeight')}</p>
            <p className="text-sm font-mono font-bold text-green-300">
              {fmtNum(goodWt, 2)} <span className="text-xs font-normal text-green-700">kg</span>
            </p>
          </div>
          <div className="bg-red-500/8 rounded-xl p-3 border border-red-500/15">
            <p className="text-[10px] text-red-600/80 uppercase tracking-wider mb-1">{t('production.planNgWeight')}</p>
            <p className="text-sm font-mono font-bold text-red-300">
              {fmtNum(ngWt, 2)} <span className="text-xs font-normal text-red-700">kg</span>
            </p>
          </div>
        </div>

        {/* ── Row 5: Dates + diff ── */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
          {order.startDate && (
            <span className="text-gray-500">
              {t('production.planStartDate')} <span className="font-mono text-gray-400">{fmtDate(order.startDate)}</span>
            </span>
          )}
          {order.expectedFinish && (
            <span className="text-gray-500">
              {t('production.planExpectedFinish')} <span className="font-mono text-gray-400">{fmtDate(order.expectedFinish)}</span>
            </span>
          )}
          {order.dueDate && (
            <span className="text-gray-500">
              {t('production.planDueDate')} <span className="font-mono text-cyan-400 font-semibold">{fmtDate(order.dueDate)}</span>
            </span>
          )}
          {isHistory && order.actualFinish && (
            <span className="text-gray-500">
              {t('production.planActualFinish')} <span className="font-mono text-green-400 font-semibold">{fmtDate(order.actualFinish)}</span>
            </span>
          )}
          {diffDays !== 0 && (
            <span className={diffDays > 0 ? 'text-amber-400' : 'text-green-400'}>
              {diffDays > 0
                ? t('production.planOverDays', { days: diffDays })
                : t('production.planAheadDays', { days: Math.abs(diffDays) })}
            </span>
          )}
          {order.seq && (
            <span className="text-gray-600">{t('production.planSeq', { seq: order.seq })}</span>
          )}
        </div>
      </div>

      {/* ── Expanded section ── */}
      {expanded && (
        <div className="border-t border-gray-700/30 px-5 py-4 space-y-5">

          {/* Machine capacity + personnel */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {order.mcCapacityKg > 0 && (
              <div className="bg-gray-800/50 rounded-xl p-3">
                <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-1">{t('production.planCapacityMc')}</p>
                <p className="text-sm font-mono font-bold text-gray-300">
                  {fmtNum(order.mcCapacityKg)} <span className="text-xs font-normal text-gray-600">{t('production.planCapacityKgPerDay')}</span>
                </p>
              </div>
            )}
            {order.mcCapacityRolls > 0 && (
              <div className="bg-gray-800/50 rounded-xl p-3">
                <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-1">{t('production.planCapacityPd')}</p>
                <p className="text-sm font-mono font-bold text-gray-300">
                  {fmtNum(order.mcCapacityRolls)} <span className="text-xs font-normal text-gray-600">{t('production.planCapacityRollsPerDay')}</span>
                </p>
              </div>
            )}
            {order.operatorId && (
              <div className="bg-gray-800/50 rounded-xl p-3">
                <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-1">{t('production.planOperator')}</p>
                <p className="text-sm font-mono font-bold text-gray-300">{order.operatorId}</p>
              </div>
            )}
            {order.technicianId && (
              <div className="bg-gray-800/50 rounded-xl p-3">
                <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-1">{t('production.planTechnician')}</p>
                <p className="text-sm font-mono font-bold text-gray-300">{order.technicianId}</p>
              </div>
            )}
          </div>

          {/* Daily table from Daily sheet */}
          <div>
            <p className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-2.5">
              {t('production.planDailySection')}
            </p>
            {dailyLoading && (
              <div className="flex items-center gap-2 text-xs text-gray-500 py-4">
                <Spinner className="w-4 h-4 text-cyan-500" />
                <span>{t('production.planDailyLoading')}</span>
              </div>
            )}
            {!dailyLoading && dailyError && (
              <p className="text-xs text-red-400 py-2">{t('production.planDailyError', { error: dailyError })}</p>
            )}
            {!dailyLoading && !dailyError && <DailyTable rows={dailyRows} t={t} />}
          </div>

          {/* Daily production summary from plan sheet */}
          {order.dailyProduction && Object.keys(order.dailyProduction).length > 0 && (
            <div>
              <p className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-2.5">
                {t('production.planDailyFromPlanSheet')}
              </p>
              <div className="overflow-x-auto rounded-lg border border-gray-700/40">
                <table className="text-xs text-gray-400 border-collapse">
                  <thead>
                    <tr className="bg-gray-800/60 border-b border-gray-700/50">
                      {Object.entries(order.dailyProduction).map(([date]) => (
                        <th key={date} className="text-center py-1.5 px-3 font-mono text-gray-500 whitespace-nowrap">
                          {date}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      {Object.entries(order.dailyProduction).map(([date, qty]) => (
                        <td key={date} className="text-center py-1.5 px-3 font-mono font-semibold text-cyan-300 whitespace-nowrap">
                          {qty}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ─── DailyScheduleView — view by date ────────────────────────────────────────

const _today = new Date();
const TODAY_STR     = `${_today.getFullYear()}-${String(_today.getMonth()+1).padStart(2,'0')}-${String(_today.getDate()).padStart(2,'0')}`;
const _yd = new Date(_today); _yd.setDate(_yd.getDate() - 1);
const YESTERDAY_STR = `${_yd.getFullYear()}-${String(_yd.getMonth()+1).padStart(2,'0')}-${String(_yd.getDate()).padStart(2,'0')}`;

const DailyScheduleView = ({ machineId }) => {
  const { language } = useLanguage();
  const { t } = useTranslation(language);

  const [rows,        setRows]        = useState([]);
  const [loadingDs,   setLoadingDs]   = useState(false);
  const [errorDs,     setErrorDs]     = useState(null);
  const [filterMonth, setFilterMonth] = useState('');
  const fetchedFor = useRef(null);

  useEffect(() => {
    if (!machineId || fetchedFor.current === machineId) return;
    fetchedFor.current = machineId;
    setLoadingDs(true);
    setErrorDs(null);
    fetchDailyPlan({ machine: machineId, sinceDate: YESTERDAY_STR })
      .then((r) => {
        const filtered = (Array.isArray(r) ? r : [])
          .filter((row) => !row.date || String(row.date).slice(0, 10) >= YESTERDAY_STR);
        setRows(filtered);
      })
      .catch((e) => { setErrorDs(e.message); fetchedFor.current = null; })
      .finally(() => setLoadingDs(false));
  }, [machineId]);

  const grouped = useMemo(() => {
    const map = new Map();
    rows.forEach((r) => {
      const raw = String(r.date ?? '').trim();
      const key = raw.length >= 10 ? raw.slice(0, 10) : (raw || 'ไม่ระบุวันที่');
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(r);
    });
    return Array.from(map.entries()).sort(([a], [b]) => (a < b ? 1 : -1));
  }, [rows]);

  const availableMonths = useMemo(() => {
    const s = new Set();
    grouped.forEach(([k]) => {
      const m = k.slice(0, 7);
      if (m.length === 7) s.add(m);
    });
    return Array.from(s).sort((a, b) => (b < a ? -1 : 1));
  }, [grouped]);

  const filtered = useMemo(
    () => filterMonth ? grouped.filter(([k]) => k.startsWith(filterMonth)) : grouped,
    [grouped, filterMonth],
  );

  const fmtDayHeader = (isoStr) => {
    const d = new Date(isoStr + 'T00:00:00');
    if (isNaN(d)) return isoStr;
    const isToday = isoStr === TODAY_STR;
    const days = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
    const day = days[d.getDay()];
    const label = d.toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: '2-digit' });
    return { label: `${day} ${label}`, isToday };
  };

  if (loadingDs) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20 text-gray-500">
        <Spinner className="w-7 h-7 text-cyan-500" />
        <p className="text-sm">{t('production.planDailyLoadingDs')}</p>
        <p className="text-xs text-gray-600">{t('production.planDailyLoadingHint')}</p>
      </div>
    );
  }

  if (errorDs) {
    return (
      <div className="flex items-start gap-3 bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-red-300 text-sm">
        <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        <div>
          <p className="font-semibold">{t('production.planDailyLoadFailed')}</p>
          <p className="text-xs text-red-400/80 mt-0.5">{errorDs}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {/* ── Month filter ── */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <span className="text-xs text-gray-500 font-semibold">
          {t('production.planRowCount', { count: rows.length })}
        </span>
        {availableMonths.length > 0 && (
          <select
            value={filterMonth}
            onChange={(e) => setFilterMonth(e.target.value)}
            className="text-xs bg-gray-800 border border-gray-700 text-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:border-cyan-500"
          >
            <option value="">{t('production.planMonthAll')}</option>
            {availableMonths.map((m) => {
              const d = new Date(m + '-01');
              const label = d.toLocaleDateString('th-TH', { month: 'long', year: '2-digit' });
              return <option key={m} value={m}>{label}</option>;
            })}
          </select>
        )}
        {filterMonth && (
          <button
            onClick={() => setFilterMonth('')}
            className="text-xs text-gray-600 hover:text-gray-400 transition-colors"
          >
            {t('production.planMonthClear')}
          </button>
        )}
      </div>

      {filtered.length === 0 && (
        <p className="text-sm text-gray-600 text-center py-12">{t('production.planDailyEmptySelected')}</p>
      )}

      {/* ── Date groups ── */}
      {filtered.map(([dateKey, dateRows]) => {
        const { label: dayLabel, isToday } = fmtDayHeader(dateKey);

        const totalA   = dateRows.reduce((s, r) => s + (Number(r.shiftA)        || 0), 0);
        const totalB   = dateRows.reduce((s, r) => s + (Number(r.shiftB)        || 0), 0);
        const totalC   = dateRows.reduce((s, r) => s + (Number(r.shiftC)        || 0), 0);
        const totalAll = dateRows.reduce((s, r) => s + (Number(r.totalProduced) || 0), 0);

        return (
          <div
            key={dateKey}
            className={`rounded-2xl border transition-all ${
              isToday
                ? 'border-cyan-500/40 bg-cyan-500/5'
                : 'border-gray-700/30 bg-gray-800/20'
            }`}
          >
            {/* Date header */}
            <div className={`flex items-center justify-between px-4 py-3 ${
              isToday ? 'border-b border-cyan-500/20' : 'border-b border-gray-700/20'
            }`}>
              <div className="flex items-center gap-2.5">
                {isToday && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-cyan-500/20 border border-cyan-500/40 text-cyan-300">
                    {t('production.planDailyToday')}
                  </span>
                )}
                <span className={`text-sm font-bold font-mono ${isToday ? 'text-cyan-300' : 'text-gray-300'}`}>
                  {dayLabel}
                </span>
                <span className="text-xs text-gray-600">
                  {t('production.planOrdersDaily', { count: dateRows.length })}
                </span>
              </div>
              {/* Day total */}
              <div className="flex items-center gap-3 text-[11px] font-mono">
                <span className="text-blue-400">A: {fmtNum(totalA)}</span>
                <span className="text-purple-400">B: {fmtNum(totalB)}</span>
                <span className="text-orange-400">C: {fmtNum(totalC)}</span>
                <span className="font-bold text-cyan-300">{t('production.planDailyShiftTotal')} {fmtNum(totalAll)}</span>
              </div>
            </div>

            {/* Orders table */}
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-gray-400 border-collapse min-w-[560px]">
                <thead>
                  <tr className="border-b border-gray-800/60">
                    <th className="text-left py-2 px-4 text-gray-600 font-semibold">{t('production.planColJobNo')}</th>
                    <th className="text-left py-2 px-3 text-gray-600 font-semibold">{t('production.planColProductName')}</th>
                    <th className="text-center py-2 px-2 text-blue-500 font-semibold">{t('production.planColShiftA')}</th>
                    <th className="text-center py-2 px-2 text-purple-500 font-semibold">{t('production.planColShiftB')}</th>
                    <th className="text-center py-2 px-2 text-orange-500 font-semibold">{t('production.planColShiftC')}</th>
                    <th className="text-center py-2 px-2 text-cyan-500 font-semibold">{t('production.planColTotal')}</th>
                    <th className="text-center py-2 px-2 text-gray-600 font-semibold">{t('production.planColTargetPerDay')}</th>
                    <th className="text-right py-2 px-4 text-gray-600 font-semibold">%</th>
                  </tr>
                </thead>
                <tbody>
                  {dateRows.map((r, i) => {
                    const p = Number(r.achievementPct) || 0;
                    const pctColor = p >= 100 ? 'text-green-400' : p >= 80 ? 'text-cyan-400' : p >= 60 ? 'text-amber-400' : 'text-red-400';
                    return (
                      <tr key={i} className="border-b border-gray-800/30 hover:bg-gray-800/30 transition-colors last:border-0">
                        <td className="py-2.5 px-4 font-mono font-semibold text-white whitespace-nowrap">{r.jobNo || '—'}</td>
                        <td className="py-2.5 px-3 text-gray-300 max-w-[180px] truncate" title={r.productName}>{r.productName || '—'}</td>
                        <td className="py-2.5 px-2 text-center font-mono text-blue-300">{r.shiftA || '—'}</td>
                        <td className="py-2.5 px-2 text-center font-mono text-purple-300">{r.shiftB || '—'}</td>
                        <td className="py-2.5 px-2 text-center font-mono text-orange-300">{r.shiftC || '—'}</td>
                        <td className="py-2.5 px-2 text-center font-mono font-bold text-cyan-300">{r.totalProduced || '—'}</td>
                        <td className="py-2.5 px-2 text-center font-mono text-gray-500">{r.targetPerDay || '—'}</td>
                        <td className={`py-2.5 px-4 text-right font-mono font-bold ${pctColor}`}>
                          {p > 0 ? `${p.toFixed(0)}%` : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ─── Empty state ──────────────────────────────────────────────────────────────

const EmptyState = ({ icon, title, sub }) => (
  <div className="text-center py-16 text-gray-600 border border-dashed border-gray-700/40 rounded-2xl">
    {icon}
    <p className="text-sm mt-2">{title}</p>
    {sub && <p className="text-xs mt-1 opacity-70">{sub}</p>}
  </div>
);

// ─── Main component ───────────────────────────────────────────────────────────

const ProductionPlanView = ({ selectedMachine, onAddToQueue, planData }) => {
  const { language } = useLanguage();
  const { t } = useTranslation(language);

  const {
    inprocessOrders,
    completeOrders,
    availableMonths,
    loading,
    error,
    lastSyncAt,
    refresh,
  } = planData;

  const [subTab,          setSubTab]          = useState('queue');
  const [filterMonth,     setFilterMonth]     = useState('');
  const [searchJob,       setSearchJob]       = useState('');
  const [productDetails,  setProductDetails]  = useState({});

  useEffect(() => {
    fetchProductDetails().then((map) => {
      if (map && typeof map === 'object' && !map._error) setProductDetails(map);
    });
  }, []);

  const filteredHistory = useMemo(() => {
    let rows = completeOrders;
    if (filterMonth) rows = rows.filter((o) => String(o.month) === filterMonth);
    if (searchJob.trim()) {
      const q = searchJob.trim().toLowerCase();
      rows = rows.filter((o) =>
        String(o.jobNo).toLowerCase().includes(q) ||
        String(o.productName ?? '').toLowerCase().includes(q) ||
        String(o.productCode ?? '').toLowerCase().includes(q),
      );
    }
    return rows;
  }, [completeOrders, filterMonth, searchJob]);

  if (!selectedMachine) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-gray-600">
        <svg className="w-10 h-10 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5" />
        </svg>
        <p className="text-sm">{t('production.planSelectMachine')}</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">

      {/* ── Sub-header ── */}
      <div className="flex-shrink-0 bg-gray-900/50 border-b border-gray-700/30 px-6 py-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">

          {/* Tabs */}
          <div className="flex items-center gap-1 bg-gray-800/60 rounded-lg p-1">
            <button
              onClick={() => setSubTab('queue')}
              className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md transition-all ${
                subTab === 'queue'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M4 6h16M4 10h16M4 14h16M4 18h16" />
              </svg>
              {t('production.planTabQueue')}
              {inprocessOrders.length > 0 && (
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                  subTab === 'queue' ? 'bg-amber-500/30 text-amber-300' : 'bg-gray-700 text-gray-400'
                }`}>{inprocessOrders.length}</span>
              )}
            </button>
            <button
              onClick={() => setSubTab('history')}
              className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md transition-all ${
                subTab === 'history'
                  ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
              </svg>
              {t('production.planTabHistory')}
              {completeOrders.length > 0 && (
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                  subTab === 'history' ? 'bg-purple-500/30 text-purple-300' : 'bg-gray-700 text-gray-400'
                }`}>{completeOrders.length}</span>
              )}
            </button>
            <button
              onClick={() => setSubTab('daily')}
              className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md transition-all ${
                subTab === 'daily'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              {t('production.planTabDaily')}
            </button>
          </div>

          {/* Filters for history tab */}
          {subTab === 'history' && (
            <>
              {availableMonths.length > 0 && (
                <select
                  value={filterMonth}
                  onChange={(e) => setFilterMonth(e.target.value)}
                  className="text-xs bg-gray-800 border border-gray-700 text-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:border-cyan-500"
                >
                  <option value="">{t('production.planMonthAll')}</option>
                  {availableMonths.map((m) => (
                    <option key={m} value={String(m)}>
                      {t('production.planMonthOption', { month: m, name: MONTH_TH[m] ?? m })}
                    </option>
                  ))}
                </select>
              )}
              <input
                type="text"
                placeholder={t('production.planSearchPlaceholder')}
                value={searchJob}
                onChange={(e) => setSearchJob(e.target.value)}
                className="text-xs bg-gray-800 border border-gray-700 text-gray-300 placeholder-gray-600 rounded-lg px-3 py-1.5 w-48 focus:outline-none focus:border-cyan-500"
              />
            </>
          )}
        </div>

        {/* Right: sync */}
        <div className="flex items-center gap-3">
          {lastSyncAt && !loading && (
            <span className="text-[11px] text-gray-600 hidden lg:block">
              {t('production.planSynced')}{lastSyncAt.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={refresh}
            disabled={loading}
            className="flex items-center gap-1.5 text-xs font-semibold text-cyan-400 hover:text-cyan-200 border border-cyan-500/30 hover:border-cyan-400/60 bg-cyan-500/5 hover:bg-cyan-500/10 px-3 py-1.5 rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading
              ? <Spinner className="w-3.5 h-3.5" />
              : (
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              )}
            {loading ? t('common.loading') : t('production.sync')}
          </button>
        </div>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-y-auto p-6">

        {/* Loading */}
        {loading && (
          <div className="flex flex-col items-center justify-center gap-3 py-20 text-gray-500">
            <Spinner className="w-7 h-7 text-cyan-500" />
            <p className="text-sm">{t('production.planLoadingGas')}</p>
            <p className="text-xs text-gray-600">{t('production.planLoadingSheet')}</p>
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <div className="flex items-start gap-3 bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-red-300 text-sm mb-4">
            <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div>
              <p className="font-semibold">{t('production.planLoadFailed')}</p>
              <p className="text-xs text-red-400/80 mt-0.5">{error}</p>
              <p className="text-xs text-red-500/60 mt-1">{t('production.planGasHint')}</p>
            </div>
          </div>
        )}

        {/* ── Queue tab ── */}
        {!loading && subTab === 'queue' && (
          inprocessOrders.length === 0 ? (
            <EmptyState
              icon={
                <svg className="w-10 h-10 mx-auto opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                </svg>
              }
              title={t('production.planEmptyQueue', { machine: selectedMachine.label })}
              sub={t('production.planEmptyQueueHint')}
            />
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-semibold text-amber-400">
                  {t('production.planInprocessCount', { count: inprocessOrders.length })}
                </span>
                <span className="text-xs text-gray-600">{t('production.planAddToQueueHint')}</span>
              </div>
              {inprocessOrders.map((order) => (
                <PlanOrderCard
                  key={order.jobNo}
                  order={order}
                  machineId={selectedMachine?.id}
                  onAddToQueue={onAddToQueue}
                  isHistory={false}
                  productDetails={productDetails}
                />
              ))}
            </div>
          )
        )}

        {/* ── Daily schedule tab ── */}
        {!loading && subTab === 'daily' && (
          <DailyScheduleView machineId={selectedMachine?.id} />
        )}

        {/* ── History tab ── */}
        {!loading && subTab === 'history' && (
          filteredHistory.length === 0 ? (
            <EmptyState
              icon={
                <svg className="w-10 h-10 mx-auto opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
              }
              title={t('production.planEmptyHistory', { month: filterMonth, search: searchJob })}
              sub={t('production.planEmptyHistoryHint')}
            />
          ) : (
            <div className="space-y-4">
              <span className="text-xs font-semibold text-purple-400">
                {t('production.planCompletedCount', { count: filteredHistory.length })}
              </span>
              {filteredHistory.map((order) => (
                <PlanOrderCard
                  key={order.jobNo}
                  order={order}
                  machineId={selectedMachine?.id}
                  onAddToQueue={null}
                  isHistory={true}
                  productDetails={productDetails}
                />
              ))}
            </div>
          )
        )}
      </div>
    </div>
  );
};

export default ProductionPlanView;
