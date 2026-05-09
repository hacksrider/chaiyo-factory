import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useLanguage } from '../../../contexts/LanguageContext';
import { useTranslation } from '../../../utils/translations';
import { fetchDailyPlan, fetchProductDetails } from '../api/productionApi';

// ─── Date helpers ─────────────────────────────────────────────────────────────

const toDateStr = (raw) => {
  if (!raw && raw !== 0) return null;
  if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const d = new Date(typeof raw === 'string' ? raw + (raw.length === 10 ? 'T00:00:00' : '') : raw);
  if (isNaN(d)) return null;
  const y  = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const dy = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${dy}`;
};

const TODAY_STR     = toDateStr(new Date());
const YESTERDAY_STR = toDateStr(new Date(Date.now() - 86_400_000));
const DAY_NAMES = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
const MONTH_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

const fmtDateLabel = (isoStr) => {
  const d = new Date(isoStr + 'T00:00:00');
  return `${DAY_NAMES[d.getDay()]} ${d.getDate()} ${MONTH_SHORT[d.getMonth()]} ${d.getFullYear()}`;
};

const fmtShortDate = (isoStr) => {
  const d = new Date(isoStr + 'T00:00:00');
  return { day: DAY_NAMES[d.getDay()], date: d.getDate(), month: MONTH_SHORT[d.getMonth()] };
};

// ─── Number helpers ───────────────────────────────────────────────────────────

const fmtN = (n, fallback = '—') => {
  const num = Number(n);
  if (n === null || n === undefined || n === '' || isNaN(num)) return fallback;
  return Math.round(num).toLocaleString('th-TH');
};

const fmtPct = (n) => {
  const num = Number(n);
  if (isNaN(num) || num === 0) return '—';
  return `${num.toFixed(0)}%`;
};

const pctColor = (n) => {
  const v = Number(n);
  if (isNaN(v) || v === 0) return 'text-gray-600';
  if (v >= 100) return 'text-green-400';
  if (v >= 80)  return 'text-cyan-400';
  if (v >= 60)  return 'text-amber-400';
  return 'text-red-400';
};

// ─── Spinner ──────────────────────────────────────────────────────────────────

const Spinner = ({ className = 'w-4 h-4' }) => (
  <svg className={`${className} animate-spin`} fill="none" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
  </svg>
);

// ─── DateStrip ────────────────────────────────────────────────────────────────

const DateStrip = ({ availableDates, selectedDate, onSelect }) => {
  const stripRef  = useRef(null);
  const activeRef = useRef(null);

  useEffect(() => {
    if (activeRef.current && stripRef.current) {
      const strip = stripRef.current;
      const el    = activeRef.current;
      strip.scrollLeft = el.offsetLeft - strip.clientWidth / 2 + el.offsetWidth / 2;
    }
  }, [selectedDate, availableDates.length]);

  if (!availableDates.length) return null;

  return (
    <div
      ref={stripRef}
      className="flex items-stretch gap-1 overflow-x-auto scrollbar-none px-3 py-2 bg-gray-900/60 border-b border-gray-700/30"
    >
      {availableDates.map((iso) => {
        const { day, date, month } = fmtShortDate(iso);
        const isToday    = iso === TODAY_STR;
        const isSelected = iso === selectedDate;
        const isPast     = iso < TODAY_STR;

        return (
          <button
            key={iso}
            ref={isSelected ? activeRef : null}
            onClick={() => onSelect(iso)}
            className={[
              'flex-shrink-0 flex flex-col items-center gap-0.5 px-2.5 py-2 rounded-xl min-w-[46px] transition-all border text-center',
              isSelected
                ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-200 shadow shadow-cyan-500/10'
                : isToday
                ? 'bg-gray-800/80 border-gray-600 text-white'
                : isPast
                ? 'border-transparent text-gray-600 hover:border-gray-700/60 hover:text-gray-400'
                : 'border-transparent text-gray-500 hover:border-gray-700/60 hover:text-gray-200',
            ].join(' ')}
          >
            <span className="text-[9px] font-semibold uppercase tracking-wide">{day}</span>
            <span className={`text-sm font-bold leading-none tabular-nums ${isToday && !isSelected ? 'text-cyan-400' : ''}`}>
              {date}
            </span>
            <span className="text-[9px] opacity-60">{month}</span>
          </button>
        );
      })}
    </div>
  );
};

// ─── DaySection — one date block with its own table ──────────────────────────

const buildScheduleQueuePayload = (row, productDetails) => {
  const code    = row.productCode || '';
  const detail  = (code && productDetails) ? (productDetails[code] || null) : null;
  const pName   = detail?.name || row.productName || code || '';
  return {
    orderId:      String(row.jobNo || ''),
    productCode:  code,
    productName:  pName,
    targetQty:    Math.round(Number(row.targetPerShift)) || Math.round(Number(row.targetPerDay)) || 0,
    remainingQty: Number(row.remaining) || 0,
    planDate:     row.date || '',
    sheetName:    row._sheetName || row._machineId,
    ledIp:        row._ledIp || '',
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
  };
};

const DaySection = ({ dateKey, rows, isToday, isPast, onAddToQueue, onRemoveFromQueue, productDetails, queuedMap, t }) => {
  const totalA     = rows.reduce((s, r) => s + (Number(r.shiftA)      || 0), 0);
  const totalB     = rows.reduce((s, r) => s + (Number(r.shiftB)      || 0), 0);
  const totalC     = rows.reduce((s, r) => s + (Number(r.shiftC)      || 0), 0);
  const totalAll   = rows.reduce((s, r) => s + (Number(r.totalPerDay) || Number(r.shiftA) + Number(r.shiftB) + Number(r.shiftC) || 0), 0);
  const hasActual  = totalA + totalB + totalC + totalAll > 0;
  const machineSet = new Set(rows.map((r) => r._machineId || r.machineId));

  const pendingEnqueueCount = rows.filter((row) => {
    const queueKey = `${row._machineId}::${row.jobNo}::${row.date ?? ''}`;
    return !queuedMap?.get(queueKey);
  }).length;

  const TABLE_HEADER = (
    <thead>
      <tr className="bg-gray-800/70 border-b border-gray-700/60 sticky top-0 z-10 text-[11px]">
        <th className="text-left py-2 px-3 text-gray-500 font-semibold whitespace-nowrap">{t('production.scheduleColMachine')}</th>
        <th className="text-left py-2 px-3 text-gray-500 font-semibold whitespace-nowrap">{t('production.scheduleColOrderId')}</th>
        <th className="text-left py-2 px-3 text-gray-500 font-semibold whitespace-nowrap">{t('production.scheduleColProduct')}</th>
        <th className="text-center py-2 px-2 text-gray-500 font-semibold whitespace-nowrap">{t('production.scheduleColTargetPerShift')}</th>
        <th className="text-center py-2 px-2 text-gray-500 font-semibold whitespace-nowrap">{t('production.scheduleColTargetPerDay')}</th>
        <th className="text-center py-2 px-2 text-gray-600 font-semibold whitespace-nowrap">{t('production.scheduleColOrdered')}</th>
        <th className="text-center py-2 px-2 text-gray-600 font-semibold whitespace-nowrap">{t('production.scheduleColProduced')}</th>
        <th className="text-center py-2 px-2 text-amber-600 font-semibold whitespace-nowrap">{t('production.scheduleColRemaining')}</th>
        <th className="text-center py-2 px-2 text-blue-500 font-semibold whitespace-nowrap">{t('production.scheduleColShiftA')}</th>
        <th className="text-center py-2 px-2 text-purple-500 font-semibold whitespace-nowrap">{t('production.scheduleColShiftB')}</th>
        <th className="text-center py-2 px-2 text-orange-500 font-semibold whitespace-nowrap">{t('production.scheduleColShiftC')}</th>
        <th className="text-center py-2 px-2 text-cyan-500 font-semibold whitespace-nowrap">{t('production.scheduleColTotal')}</th>
        <th className="text-center py-2 px-2 text-gray-500 font-semibold whitespace-nowrap">{t('production.scheduleColPct')}</th>
        <th className="text-left py-2 px-2 text-gray-600 font-semibold whitespace-nowrap">{t('production.scheduleColRemarks')}</th>
        <th className="py-2 px-3 text-left align-middle">
          {onAddToQueue ? (
            <button
              type="button"
              onClick={() => {
                rows.forEach((row) => {
                  const queueKey = `${row._machineId}::${row.jobNo}::${row.date ?? ''}`;
                  if (queuedMap?.get(queueKey)) return;
                  onAddToQueue(row._machineId, buildScheduleQueuePayload(row, productDetails));
                });
              }}
              disabled={pendingEnqueueCount === 0}
              title={t('production.scheduleEnqueueAllTitle', { count: pendingEnqueueCount })}
              className="inline-flex items-center gap-1 text-[10px] font-semibold bg-amber-500/15 hover:bg-amber-500/25 disabled:opacity-35 disabled:pointer-events-none border border-amber-500/35 text-amber-300 hover:text-amber-200 px-2 py-1 rounded-lg transition-all whitespace-nowrap"
            >
              <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              {t('production.scheduleEnqueueAll')}
            </button>
          ) : null}
        </th>
      </tr>
    </thead>
  );

  return (
    <div
      id={`day-${dateKey}`}
      className={`border rounded-2xl overflow-hidden transition-all ${
        isToday
          ? 'border-cyan-500/40 bg-cyan-500/3'
          : isPast
          ? 'border-gray-700/20 bg-gray-800/10'
          : 'border-gray-700/30 bg-gray-800/15'
      }`}
    >
      {/* Date header */}
      <div className={`flex items-center justify-between px-4 py-3 border-b ${
        isToday ? 'border-cyan-500/20 bg-cyan-500/8' : 'border-gray-700/20'
      }`}>
        <div className="flex items-center gap-2.5">
          {isToday && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-cyan-500/20 border border-cyan-500/40 text-cyan-300">
              {t('production.scheduleToday')}
            </span>
          )}
          {!isToday && !isPast && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-400">
              {t('production.scheduleFuture')}
            </span>
          )}
          <span className={`text-sm font-bold ${isToday ? 'text-cyan-300' : isPast ? 'text-gray-400' : 'text-gray-200'}`}>
            {fmtDateLabel(dateKey)}
          </span>
          <span className="text-xs text-gray-600">
            {t('production.scheduleDayMeta', { rows: rows.length, machines: machineSet.size })}
          </span>
        </div>

        {/* Day totals */}
        {hasActual && (
          <div className="flex items-center gap-3 text-[11px] font-mono">
            <span className="text-blue-400">A: {fmtN(totalA)}</span>
            <span className="text-purple-400">B: {fmtN(totalB)}</span>
            <span className="text-orange-400">C: {fmtN(totalC)}</span>
            <span className="font-bold text-cyan-300">{t('production.scheduleShiftTotal')} {fmtN(totalAll)}</span>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs text-gray-400 border-collapse min-w-[900px]">
          {TABLE_HEADER}
          <tbody>
            {rows.map((row, i) => {
              const pct    = Number(row.achievementPct) || 0;
              const hasGot = Number(row.shiftA) || Number(row.shiftB) || Number(row.shiftC) || Number(row.totalProduced);

              return (
                <tr
                  key={i}
                  className="border-b border-gray-800/40 hover:bg-gray-800/30 transition-colors last:border-0"
                >
                  {/* Machine */}
                  <td className="py-2.5 px-3 whitespace-nowrap">
                    <span className="inline-flex font-mono font-bold text-[11px] text-white bg-gray-700/60 border border-gray-600/40 px-2 py-0.5 rounded-full">
                      {row._machineLabel || row._machineId || '—'}
                    </span>
                  </td>

                  {/* Job no */}
                  <td className="py-2.5 px-3 font-mono font-semibold text-white whitespace-nowrap">
                    {row.jobNo || '—'}
                  </td>

                  {/* Product code / name */}
                  <td className="py-2.5 px-3 max-w-[220px]">
                    {(() => {
                      const code    = row.productCode || '';
                      const looked  = code && productDetails ? (productDetails[code]?.name || '') : '';
                      const display = looked || row.productName || '';
                      return (
                        <>
                          {display ? (
                            <p className="text-gray-200 text-[11px] leading-snug" title={display}>{display}</p>
                          ) : null}
                          {code && (
                            <p className="text-[10px] text-gray-600 font-mono mt-0.5">{code}</p>
                          )}
                          {!display && !code && <span className="text-gray-700">—</span>}
                        </>
                      );
                    })()}
                  </td>

                  <td className="py-2.5 px-2 text-center font-mono text-gray-400">{fmtN(row.targetPerShift)}</td>
                  <td className="py-2.5 px-2 text-center font-mono text-gray-300 font-semibold">{fmtN(row.targetPerDay)}</td>
                  <td className="py-2.5 px-2 text-center font-mono text-gray-500">{fmtN(row.totalOrdered)}</td>
                  <td className="py-2.5 px-2 text-center font-mono text-gray-500">{fmtN(row.totalProduced)}</td>
                  <td className="py-2.5 px-2 text-center font-mono font-semibold text-amber-400/80">{fmtN(row.remaining)}</td>

                  <td className={`py-2.5 px-2 text-center font-mono ${hasGot ? 'text-blue-300 font-semibold' : 'text-gray-700'}`}>
                    {row.shiftA != null && row.shiftA !== '' ? fmtN(row.shiftA) : '—'}
                  </td>
                  <td className={`py-2.5 px-2 text-center font-mono ${hasGot ? 'text-purple-300 font-semibold' : 'text-gray-700'}`}>
                    {row.shiftB != null && row.shiftB !== '' ? fmtN(row.shiftB) : '—'}
                  </td>
                  <td className={`py-2.5 px-2 text-center font-mono ${hasGot ? 'text-orange-300 font-semibold' : 'text-gray-700'}`}>
                    {row.shiftC != null && row.shiftC !== '' ? fmtN(row.shiftC) : '—'}
                  </td>
                  <td className={`py-2.5 px-2 text-center font-mono font-bold ${hasGot ? 'text-cyan-300' : 'text-gray-700'}`}>
                    {fmtN(row.totalPerDay || (Number(row.shiftA) + Number(row.shiftB) + Number(row.shiftC)) || null)}
                  </td>
                  <td className={`py-2.5 px-2 text-center font-mono font-bold ${pctColor(pct)}`}>{fmtPct(pct)}</td>

                  {/* หมายเหตุ */}
                  <td className="py-2.5 px-2 max-w-[100px]">
                    {row.remarks ? (
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded font-semibold truncate block ${
                          row.remarks.includes('ด่วน')
                            ? 'text-red-300 bg-red-500/10'
                            : row.remarks.includes('OVER')
                            ? 'text-orange-300 bg-orange-500/10'
                            : 'text-gray-500'
                        }`}
                        title={row.remarks}
                      >
                        {row.remarks}
                      </span>
                    ) : (
                      <span className="text-gray-700">—</span>
                    )}
                  </td>

                  {/* เพิ่มเข้าคิว / สถานะในคิว */}
                  <td className="py-2.5 px-3 whitespace-nowrap">
                    {(() => {
                      const queueKey = `${row._machineId}::${row.jobNo}::${row.date ?? ''}`;
                      const queued   = queuedMap?.get(queueKey);

                      if (queued) {
                        return (
                          <div className="flex items-center gap-1.5">
                            <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-lg bg-green-500/10 border border-green-500/30 text-green-400 whitespace-nowrap">
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                              </svg>
                              {t('production.scheduleInQueue')}
                            </span>
                            {onRemoveFromQueue && (
                              <button
                                onClick={() => onRemoveFromQueue(queued.machineId, queued.queueId)}
                                title={t('production.removeFromQueue')}
                                className="flex items-center justify-center w-6 h-6 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 transition-all"
                              >
                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            )}
                          </div>
                        );
                      }

                      if (!onAddToQueue) return null;
                      return (
                        <button
                          onClick={() => {
                            onAddToQueue(row._machineId, buildScheduleQueuePayload(row, productDetails));
                          }}
                          title={t('production.addToQueueTitle', { machine: row._machineLabel || row._machineId || '' })}
                          className="flex items-center gap-1 text-[10px] font-semibold bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 text-cyan-400 hover:text-cyan-200 px-2 py-1 rounded-lg transition-all whitespace-nowrap"
                        >
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                          </svg>
                          {t('production.scheduleEnqueue')}
                        </button>
                      );
                    })()}
                  </td>
                </tr>
              );
            })}
          </tbody>

          {/* Footer totals */}
          {hasActual && (
            <tfoot>
              <tr className="bg-gray-800/40 border-t border-gray-700/50 text-[11px]">
                <td colSpan={8} className="py-2 px-3 font-semibold text-gray-500">
                  {t('production.scheduleFooterTotal', { count: rows.length })}
                </td>
                <td className="py-2 px-2 text-center font-mono font-bold text-blue-300">{fmtN(totalA)}</td>
                <td className="py-2 px-2 text-center font-mono font-bold text-purple-300">{fmtN(totalB)}</td>
                <td className="py-2 px-2 text-center font-mono font-bold text-orange-300">{fmtN(totalC)}</td>
                <td className="py-2 px-2 text-center font-mono font-bold text-cyan-300">{fmtN(totalAll)}</td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
};

// ─── ScheduleView ─────────────────────────────────────────────────────────────

const ScheduleView = ({ machines, onAddToQueue, onRemoveFromQueue, queuedMap }) => {
  const { language } = useLanguage();
  const { t } = useTranslation(language);

  const [allRows,         setAllRows]         = useState([]);
  const [loadingCount,    setLoadingCount]    = useState(0);
  const [loadedMachines,  setLoadedMachines]  = useState([]);
  const [errors,          setErrors]          = useState([]);
  const [lastSyncAt,      setLastSyncAt]      = useState(null);
  const [filterMachineId, setFilterMachineId] = useState('');
  const [selectedDateKey, setSelectedDateKey] = useState(null);
  const [showDebug,       setShowDebug]       = useState(false);
  const [rawSamples,      setRawSamples]      = useState([]);
  const [productDetails,   setProductDetails]   = useState({});

  const contentRef = useRef(null);
  const loading = loadingCount > 0;

  const machineByNorm = useMemo(() => {
    const norm = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();
    const map  = new Map();
    machines.forEach((m) => {
      map.set(norm(m.id),    m);
      map.set(norm(m.label), m);
    });
    return map;
  }, [machines]);

  const fetchAll = useCallback(() => {
    if (!machines.length) return;
    setErrors([]);
    setAllRows([]);
    setLoadedMachines([]);
    setRawSamples([]);
    setLoadingCount(1);

    const norm = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();

    fetchDailyPlan({ sinceDate: YESTERDAY_STR })
      .then((raw) => {
        const rows = (raw ?? [])
          .filter((row) => !row.date || String(row.date).slice(0, 10) >= YESTERDAY_STR)
          .map((row) => {
            const match = machineByNorm.get(norm(row.machineId));
            return {
              ...row,
              _machineId:    match?.id        || row.machineId || '',
              _machineLabel: match?.label     || row.machineId || '',
              _sheetName:    match?.sheetName || row.machineId || '',
              _ledIp:        match?.ledIp     || '',
            };
          });

        setAllRows(rows);
        setLoadedMachines(machines.map((m) => m.id));

        if (raw?.length > 0) {
          setRawSamples([{ machine: 'Daily sheet (all)', count: raw.length, sample: raw[0] }]);
        }
      })
      .catch((e) => {
        setErrors([`Daily sheet: ${e.message}`]);
      })
      .finally(() => {
        setLoadingCount(0);
        setLastSyncAt(new Date());
      });
  }, [machines, machineByNorm]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  useEffect(() => {
    fetchProductDetails().then((map) => {
      if (map && typeof map === 'object' && !map._error) {
        setProductDetails(map);
      }
    });
  }, []);

  const grouped = useMemo(() => {
    const filtered = filterMachineId
      ? allRows.filter((r) => r._machineId === filterMachineId)
      : allRows;

    const map = new Map();
    filtered.forEach((row) => {
      const key = toDateStr(row.date);
      if (!key) return;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(row);
    });

    return Array.from(map.entries()).sort(([a], [b]) => (a < b ? -1 : 1));
  }, [allRows, filterMachineId]);

  const availableDates = useMemo(() => grouped.map(([k]) => k), [grouped]);

  useEffect(() => {
    if (!selectedDateKey) return;
    const el = document.getElementById(`day-${selectedDateKey}`);
    if (el && contentRef.current) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [selectedDateKey]);

  useEffect(() => {
    if (!allRows.length || selectedDateKey) return;
    const todayOrAfter = availableDates.find((d) => d >= TODAY_STR);
    if (todayOrAfter) {
      setSelectedDateKey(todayOrAfter);
    }
  }, [allRows.length, availableDates, selectedDateKey]);

  if (!machines.length) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-600">
        <p className="text-sm">{t('production.scheduleNoMachines')}</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">

      {/* ── Top bar ── */}
      <div className="flex-shrink-0 bg-gray-900/50 border-b border-gray-700/30 px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <select
            value={filterMachineId}
            onChange={(e) => setFilterMachineId(e.target.value)}
            className="text-xs bg-gray-800 border border-gray-700 text-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:border-cyan-500"
          >
            <option value="">{t('production.scheduleAllMachines')}</option>
            {machines.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>

          {grouped.length > 0 && (
            <span className="text-xs text-gray-500">
              {t('production.scheduleDateRangeMeta', { days: grouped.length, rows: allRows.length })}
            </span>
          )}

          {/* Legend */}
          <div className="hidden sm:flex items-center gap-3 text-[10px] text-gray-600">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-blue-400" />{t('production.scheduleColShiftA')}
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-purple-400" />{t('production.scheduleColShiftB')}
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-orange-400" />{t('production.scheduleColShiftC')}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {loading && (
            <span className="text-[11px] text-gray-400 flex items-center gap-1.5">
              <Spinner className="w-3 h-3 text-cyan-400" />
              <span className="text-cyan-400 font-semibold">{t('common.loading')}</span>
            </span>
          )}
          {lastSyncAt && !loading && (
            <span className="text-[11px] text-gray-600 hidden lg:block">
              {t('production.planSynced')}{lastSyncAt.toLocaleTimeString()}
            </span>
          )}
          {/* Debug toggle */}
          <button
            onClick={() => setShowDebug((v) => !v)}
            title={t('production.openDebug')}
            className={`text-xs px-2.5 py-1.5 rounded-lg border transition-all ${
              showDebug
                ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                : 'border-gray-700/50 text-gray-600 hover:text-gray-400'
            }`}
          >
            Debug
          </button>
          <button
            onClick={fetchAll}
            disabled={loading}
            className="flex items-center gap-1.5 text-xs font-semibold text-cyan-400 hover:text-cyan-200 border border-cyan-500/30 hover:border-cyan-400/60 bg-cyan-500/5 hover:bg-cyan-500/10 px-3 py-1.5 rounded-lg transition-all disabled:opacity-40"
          >
            {loading ? <Spinner className="w-3.5 h-3.5" /> : (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            )}
            {t('production.sync')}
          </button>
        </div>
      </div>

      {/* ── Loading progress bar ── */}
      {loading && (
        <div className="flex-shrink-0 bg-gray-900/60 border-b border-gray-700/20 px-4 py-1.5">
          <div className="flex items-center gap-3">
            <div className="flex-1 h-1 bg-gray-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-cyan-600 to-cyan-400 rounded-full transition-all duration-500"
                style={{ width: `${Math.round((loadedMachines.length / machines.length) * 100)}%` }}
              />
            </div>
            <span className="text-[10px] text-gray-600 whitespace-nowrap flex-shrink-0">
              {t('production.scheduleRowCount', { count: allRows.length })}
            </span>
          </div>
        </div>
      )}

      {/* ── Date strip ── */}
      <DateStrip
        availableDates={availableDates}
        selectedDate={selectedDateKey}
        onSelect={setSelectedDateKey}
      />

      {/* ── Scrollable content ── */}
      <div ref={contentRef} className="flex-1 overflow-y-auto p-4 space-y-4">

        {/* Errors */}
        {errors.length > 0 && (
          <div className="flex items-start gap-3 bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-red-300 text-xs">
            <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <pre className="whitespace-pre-wrap leading-relaxed">{errors.join('\n')}</pre>
          </div>
        )}

        {/* Debug panel */}
        {showDebug && (
          <div className="bg-gray-900 border border-amber-500/20 rounded-xl p-4 text-xs">
            <p className="text-amber-400 font-semibold mb-2">{t('production.scheduleDebugInfo')}</p>
            {rawSamples.length === 0 && !loading && (
              <p className="text-gray-600">{t('production.scheduleDebugNoData')}</p>
            )}
            <div className="space-y-3">
              {rawSamples.map((s, i) => (
                <div key={i}>
                  <p className="text-gray-400 font-semibold mb-1">
                    {s.machine} — <span className="text-cyan-400">{t('production.scheduleDebugRows', { count: s.count })}</span>
                    {s.count > 0 ? '' : ' (ว่าง)'}
                  </p>
                  {s.sample && (
                    <pre className="text-[10px] text-gray-500 bg-gray-950 rounded p-2 overflow-x-auto max-h-32">
                      {JSON.stringify(s.sample, null, 2)}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Loading — first load */}
        {loading && grouped.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-3 py-20 text-gray-500">
            <Spinner className="w-7 h-7 text-cyan-500" />
            <p className="text-sm">{t('production.scheduleLoadingDailySheet')}</p>
            <p className="text-xs text-gray-600">{t('production.scheduleFirstTimeHint')}</p>
            <p className="text-xs text-gray-700">{t('production.scheduleCacheHint')}</p>
          </div>
        )}

        {/* Empty after load */}
        {!loading && grouped.length === 0 && errors.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 py-20 text-gray-600 border border-dashed border-gray-700/40 rounded-2xl">
            <svg className="w-10 h-10 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <p className="text-sm">{t('production.scheduleGasNoData')}</p>
            <p className="text-xs opacity-70">{t('production.scheduleGasNoDataHint')}</p>
            <button
              onClick={() => setShowDebug(true)}
              className="mt-2 text-xs text-amber-400 border border-amber-500/30 px-3 py-1.5 rounded-lg hover:bg-amber-500/10 transition-all"
            >
              {t('production.scheduleOpenDebug')}
            </button>
          </div>
        )}

        {/* Date sections */}
        {grouped.map(([dateKey, rows]) => (
          <DaySection
            key={dateKey}
            dateKey={dateKey}
            rows={rows}
            isToday={dateKey === TODAY_STR}
            isPast={dateKey < TODAY_STR}
            onAddToQueue={onAddToQueue}
            onRemoveFromQueue={onRemoveFromQueue}
            productDetails={productDetails}
            queuedMap={queuedMap}
            t={t}
          />
        ))}
      </div>
    </div>
  );
};

export default ScheduleView;
