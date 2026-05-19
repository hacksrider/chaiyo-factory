import React, { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef } from 'react';
import { useLanguage } from '../../../contexts/LanguageContext';
import { useTranslation } from '../../../utils/translations';
import { fetchDailyPlan, fetchProductDetails, fetchProductionCalendar } from '../api/productionApi';
import ProductionViewExitButton from './ProductionViewExitButton';
import {
  todayBangkokIso,
  yesterdayBangkokIso,
  normalizePlanDateKey,
  compareBangkokDates,
  isBangkokDateBefore,
  bangkokWeekdayIndex,
} from '../utils/formatProductionBangkok';

// ─── Date helpers (ปฏิทินโรงงาน GMT+7 — ไม่ใช้ timezone เครื่องผู้ใช้) ─────

const DAY_NAMES = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
const MONTH_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

const bangkokCalendarParts = (isoStr) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoStr);
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]) - 1, date: Number(m[3]) };
};

const fmtDateLabel = (isoStr) => {
  const p = bangkokCalendarParts(isoStr);
  if (!p) return isoStr;
  return `${DAY_NAMES[bangkokWeekdayIndex(isoStr)]} ${p.date} ${MONTH_SHORT[p.month]} ${p.year}`;
};

const fmtShortDate = (isoStr) => {
  const p = bangkokCalendarParts(isoStr);
  if (!p) return { day: '—', date: '—', month: '—' };
  return { day: DAY_NAMES[bangkokWeekdayIndex(isoStr)], date: p.date, month: MONTH_SHORT[p.month] };
};

/**
 * วันนี้/เมื่อวานจากเซิร์ฟเวอร์ (Asia/Bangkok) — แหล่งจริงของ "วันที่ระบบ"
 * fallback ฝั่ง client ถ้า API ล้มเหลว
 */
function useProductionCalendar() {
  const [calendar, setCalendar] = useState(() => ({
    today:     todayBangkokIso(),
    yesterday: yesterdayBangkokIso(),
    source:    'client',
  }));

  useEffect(() => {
    let cancelled = false;

    const sync = async () => {
      try {
        const cal = await fetchProductionCalendar();
        if (!cancelled && cal?.today) {
          setCalendar({
            today:     cal.today,
            yesterday: cal.yesterday || yesterdayBangkokIso(),
            source:    'server',
            timezone:  cal.timezone,
            now:       cal.now,
          });
          return;
        }
      } catch {
        /* fallback ด้านล่าง */
      }
      if (!cancelled) {
        setCalendar({
          today:     todayBangkokIso(),
          yesterday: yesterdayBangkokIso(),
          source:    'client',
        });
      }
    };

    sync();
    const id = setInterval(sync, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return calendar;
}

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

// ─── Scroll spy: วันที่ของ section ที่อยู่ใกล้ด้านบนสุดของรายการ ─────────────

const SCROLL_SPY_TOP_PX = 12;

function defaultScheduleDate(grouped, todayStr) {
  if (grouped.some(([k]) => compareBangkokDates(k, todayStr) === 0)) return todayStr;
  const next = grouped.find(([k]) => compareBangkokDates(k, todayStr) > 0);
  if (next) return next[0];
  return todayStr;
}

function useScheduleScrollSpy(contentRef, grouped, enabled) {
  const [visibleDateKey, setVisibleDateKey] = useState(null);

  useEffect(() => {
    const root = contentRef.current;
    if (!enabled || !root || !grouped.length) {
      if (!enabled) setVisibleDateKey(null);
      else if (!grouped.length) setVisibleDateKey(null);
      return undefined;
    }

    const pickVisible = () => {
      const rootTop = root.getBoundingClientRect().top + SCROLL_SPY_TOP_PX;
      let current   = grouped[0][0];

      for (const [dateKey] of grouped) {
        const el = document.getElementById(`day-${dateKey}`);
        if (!el) continue;
        if (el.getBoundingClientRect().top <= rootTop) {
          current = dateKey;
        }
      }

      setVisibleDateKey((prev) => (prev === current ? prev : current));
    };

    pickVisible();
    root.addEventListener('scroll', pickVisible, { passive: true });
    const ro = new ResizeObserver(pickVisible);
    ro.observe(root);

    return () => {
      root.removeEventListener('scroll', pickVisible);
      ro.disconnect();
    };
  }, [contentRef, grouped, enabled]);

  return visibleDateKey;
}

// ─── แถบบอกวันที่กำลังเลื่อนดู (อยู่เหนืนรายการ ไม่เลื่อนหาย) ─────────────────

const ViewingDateBar = ({ dateKey, rowCount, todayStr, t }) => {
  if (!dateKey) return null;

  const dayCmp  = compareBangkokDates(dateKey, todayStr);
  const isToday = dayCmp === 0;
  const isPast  = dayCmp != null && dayCmp < 0;
  const isFuture = dayCmp != null && dayCmp > 0;

  return (
    <div className="flex-shrink-0 flex items-center justify-between gap-3 border-b border-cyan-500/25 bg-gray-950/95 px-3 py-2 backdrop-blur-sm sm:px-4">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
          {t('production.scheduleViewing')}
        </span>
        <span className="truncate text-sm font-bold text-cyan-200">
          {fmtDateLabel(dateKey)}
        </span>
        {isToday && (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-cyan-500/20 border border-cyan-500/40 text-cyan-300">
            {t('production.scheduleToday')}
          </span>
        )}
        {isFuture && (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-400">
            {t('production.scheduleFuture')}
          </span>
        )}
        {isPast && (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-gray-700/40 border border-gray-600/50 text-gray-500">
            {t('production.schedulePast')}
          </span>
        )}
      </div>
      {rowCount > 0 && (
        <span className="flex-shrink-0 text-[11px] text-gray-500 tabular-nums">
          {t('production.scheduleRowCount', { count: rowCount })}
        </span>
      )}
    </div>
  );
};

// ─── DateStrip ────────────────────────────────────────────────────────────────

const DateStrip = ({ availableDates, selectedDate, onSelect, todayStr }) => {
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
        const dayCmp     = compareBangkokDates(iso, todayStr);
        const isToday    = dayCmp === 0;
        const isSelected = iso === selectedDate;
        const isPast     = dayCmp != null && dayCmp < 0;

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
      className={`scroll-mt-3 border rounded-2xl overflow-hidden transition-all ${
        isToday
          ? 'border-cyan-500/40 bg-cyan-500/3'
          : isPast
          ? 'border-gray-700/20 bg-gray-800/10'
          : 'border-gray-700/30 bg-gray-800/15'
      }`}
    >
      {/* Date header */}
      <div className={`flex flex-col gap-2 border-b px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-4 ${
        isToday ? 'border-cyan-500/20 bg-cyan-500/8' : 'border-gray-700/20'
      }`}>
        <div className="flex min-w-0 flex-wrap items-center gap-2.5">
          {isToday && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-cyan-500/20 border border-cyan-500/40 text-cyan-300">
              {t('production.scheduleToday')}
            </span>
          )}
          {!isToday && !isPast && compareBangkokDates(dateKey, todayStr) > 0 && (
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
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono sm:justify-end">
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

const ScheduleView = ({ machines, onAddToQueue, onRemoveFromQueue, queuedMap, onExit }) => {
  const { language } = useLanguage();
  const { t } = useTranslation(language);
  const { today: todayStr, yesterday: yesterdayStr } = useProductionCalendar();

  const [allRows,         setAllRows]         = useState([]);
  const [loadingCount,    setLoadingCount]    = useState(0);
  const [loadedMachines,  setLoadedMachines]  = useState([]);
  const [errors,          setErrors]          = useState([]);
  const [lastSyncAt,      setLastSyncAt]      = useState(null);
  const [filterMachineId, setFilterMachineId] = useState('');
  const [selectedDateKey, setSelectedDateKey] = useState(null); // คลิกจากแถบวันที่
  const [productDetails,   setProductDetails]   = useState({});

  const contentRef            = useRef(null);
  const initialScrollDoneRef  = useRef(false);
  const [scrollSpyEnabled, setScrollSpyEnabled] = useState(false);
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
    setLoadingCount(1);

    const norm = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();

    fetchDailyPlan({ sinceDate: yesterdayStr })
      .then((raw) => {
        const rows = (raw ?? [])
          .filter((row) => {
            const d = normalizePlanDateKey(row.date);
            return !d || compareBangkokDates(d, yesterdayStr) >= 0;
          })
          .map((row) => {
            const match = machineByNorm.get(norm(row.machineId));
            const planDate = normalizePlanDateKey(row.date) || row.date;
            return {
              ...row,
              date:          planDate,
              _machineId:    match?.id        || row.machineId || '',
              _machineLabel: match?.label     || row.machineId || '',
              _sheetName:    match?.sheetName || row.machineId || '',
              _ledIp:        match?.ledIp     || '',
            };
          });

        setAllRows(rows);
        setLoadedMachines(machines.map((m) => m.id));
      })
      .catch((e) => {
        setErrors([`Daily sheet: ${e.message}`]);
      })
      .finally(() => {
        setLoadingCount(0);
        setLastSyncAt(new Date());
      });
  }, [machines, machineByNorm, yesterdayStr]);

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
      const key = normalizePlanDateKey(row.date);
      if (!key) return;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(row);
    });

    return Array.from(map.entries()).sort(([a], [b]) => compareBangkokDates(a, b) ?? 0);
  }, [allRows, filterMachineId]);

  /** แถบวันที่ต้องมี "วันนี้" เสมอ แม้ Sheet ยังไม่มีแถวของวันนี้ */
  const availableDates = useMemo(() => {
    const set = new Set(grouped.map(([k]) => k));
    set.add(todayStr);
    set.add(yesterdayStr);
    return Array.from(set).sort((a, b) => compareBangkokDates(a, b) ?? 0);
  }, [grouped, todayStr, yesterdayStr]);

  const scrollVisibleDateKey = useScheduleScrollSpy(contentRef, grouped, scrollSpyEnabled);

  const activeDateKey = scrollSpyEnabled
    ? (scrollVisibleDateKey ?? selectedDateKey)
    : selectedDateKey;

  const activeRowCount = useMemo(() => {
    if (!activeDateKey) return 0;
    const hit = grouped.find(([k]) => k === activeDateKey);
    return hit ? hit[1].length : 0;
  }, [grouped, activeDateKey]);

  const scrollToDateSection = useCallback((iso, { behavior = 'smooth' } = {}) => {
    setSelectedDateKey(iso);
    const root = contentRef.current;
    const el   = document.getElementById(`day-${iso}`);
    if (!el) return false;

    if (root) {
      const top = el.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop - 8;
      root.scrollTo({ top: Math.max(0, top), behavior });
    } else {
      el.scrollIntoView({ behavior, block: 'start' });
    }
    return true;
  }, []);

  const scrollToDate = useCallback((iso) => {
    scrollToDateSection(iso, { behavior: 'smooth' });
  }, [scrollToDateSection]);

  useEffect(() => {
    if (todayStr) setSelectedDateKey((prev) => prev ?? todayStr);
  }, [todayStr]);

  useEffect(() => {
    initialScrollDoneRef.current = false;
    setScrollSpyEnabled(false);
  }, []);

  useEffect(() => {
    initialScrollDoneRef.current = false;
    setScrollSpyEnabled(false);
  }, [filterMachineId]);

  /** เปิดหน้าครั้งแรก / โหลดข้อมูลเสร็จ → เลื่อนไปวันปัจจุบัน (รอ DOM section พร้อม) */
  useLayoutEffect(() => {
    if (loading || !todayStr || initialScrollDoneRef.current) return;

    const target = defaultScheduleDate(grouped, todayStr);
    setSelectedDateKey(target);

    if (grouped.length === 0) {
      initialScrollDoneRef.current = true;
      setScrollSpyEnabled(true);
      return undefined;
    }

    let cancelled = false;
    let attempts  = 0;
    const maxAttempts = 40;

    const finish = () => {
      if (cancelled) return;
      initialScrollDoneRef.current = true;
      setScrollSpyEnabled(true);
    };

    const tryScroll = () => {
      if (cancelled || initialScrollDoneRef.current) return;
      attempts += 1;
      if (scrollToDateSection(target, { behavior: 'auto' })) {
        finish();
        return;
      }
      if (attempts < maxAttempts) {
        requestAnimationFrame(tryScroll);
      } else {
        finish();
      }
    };

    tryScroll();
    return () => {
      cancelled = true;
    };
  }, [loading, grouped, todayStr, scrollToDateSection]);

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
      <div className="flex-shrink-0 flex flex-col gap-2 border-b border-gray-700/30 bg-gray-900/50 px-3 py-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-3 sm:px-4">
        <div className="flex w-full min-w-0 items-center gap-2 sm:flex-1">
          <select
            value={filterMachineId}
            onChange={(e) => setFilterMachineId(e.target.value)}
            className="min-w-0 flex-1 text-xs bg-gray-800 border border-gray-700 text-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:border-cyan-500 sm:flex-none sm:w-auto sm:min-w-[11rem]"
          >
            <option value="">{t('production.scheduleAllMachines')}</option>
            {machines.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>

          <span
            className="hidden text-[11px] text-cyan-500/90 tabular-nums sm:inline"
            title="ปฏิทินระบบ (Asia/Bangkok)"
          >
            {t('production.scheduleToday')}: {fmtDateLabel(todayStr)}
          </span>

          {grouped.length > 0 && (
            <span className="hidden text-xs text-gray-500 sm:inline">
              {t('production.scheduleDateRangeMeta', { days: grouped.length, rows: allRows.length })}
            </span>
          )}

          {onExit && (
            <ProductionViewExitButton onClick={onExit} size="sm" className="ml-auto shrink-0" />
          )}
        </div>

        <div className="flex w-full flex-wrap items-center gap-3 sm:w-auto">
          {grouped.length > 0 && (
            <span className="text-xs text-gray-500 sm:hidden">
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

        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
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
        selectedDate={activeDateKey}
        onSelect={scrollToDate}
        todayStr={todayStr}
      />

      <ViewingDateBar
        dateKey={activeDateKey}
        rowCount={activeRowCount}
        todayStr={todayStr}
        t={t}
      />

      {/* ── Scrollable content ── */}
      <div ref={contentRef} className="flex-1 space-y-4 overflow-y-auto p-3 sm:p-4 lg:p-5">

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
          </div>
        )}

        {/* Date sections */}
        {grouped.map(([dateKey, rows]) => (
          <DaySection
            key={dateKey}
            dateKey={dateKey}
            rows={rows}
            isToday={compareBangkokDates(dateKey, todayStr) === 0}
            isPast={isBangkokDateBefore(dateKey, todayStr)}
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
