import React, { useState, useEffect, useMemo } from 'react';
import { useLanguage } from '../../../contexts/LanguageContext';
import { useTranslation } from '../../../utils/translations';
import { fetchHistory, fetchOrderDetail, dbDeleteHistoryOrder } from '../api/productionApi';
import {
  formatProductionDateTimeBangkok,
  formatProductionTimeBangkok,
  bangkokDayStartUtcMs,
  bangkokDayEndUtcMs,
} from '../utils/formatProductionBangkok';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** เวลาที่ใช้ในแถวประวัติเหตุ (รวมได้จาก API occurredAt) */
function eventHistoryInstant(ev) {
  return ev?.occurredAt ?? ev?.pressedAt ?? ev?.receivedAt ?? null;
}

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const sevenDaysAgo = () => {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const statusStyle = (s = '') => {
  const lower = String(s).toLowerCase();
  if (lower === 'completed')   return 'text-green-400  bg-green-400/10  border-green-400/25';
  if (lower === 'in-progress') return 'text-amber-400  bg-amber-400/10  border-amber-400/25';
  if (lower === 'started')     return 'text-cyan-400   bg-cyan-400/10   border-cyan-400/25';
  return 'text-gray-400 bg-gray-400/10 border-gray-400/20';
};

const GOOGLE_SHEET_URL =
  'https://docs.google.com/spreadsheets/d/1_GotgbFAvFMng-POrJbcBGXMELUNwyX1PocLbm36lxM/edit?usp=sharing';

// ─── CSV Export ───────────────────────────────────────────────────────────────

const exportCsv = (rows, colHeaders, shiftPfx) => {
  const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const fmtShift = (s = '') => {
    if (!s) return '—';
    const m = String(s).match(/[ABC]/i);
    return m ? shiftPfx + m[0].toUpperCase() : String(s);
  };
  const lines = [
    colHeaders.map(escape).join(','),
    ...rows.map((r) => [
      r.machine      ?? '',
      r.timestamp    ? formatProductionDateTimeBangkok(r.timestamp, { dateStyle: 'short', timeStyle: 'short' }) : '',
      r.finishedAt   ? formatProductionDateTimeBangkok(r.finishedAt, { dateStyle: 'short', timeStyle: 'short' }) : '',
      r.orderId      ?? '',
      r.productCode  ?? '',
      r.productName  ?? '',
      fmtShift(r.shift),
      r.employeeId   ?? '',
      r.targetQty    ?? '',
      r.summary      ?? '',
      r.ngSummary    ?? '',
      r.status       ?? '',
    ].map(escape).join(',')),
  ];
  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `production-history-${todayStr()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
};

// ─── Summary parsing (from GAS strings) ───────────────────────────────────────
// summary:   "ของดี X รายการ / XX.XX kg"
// ngSummary: "ของเสียรวม XX.XX kg"
const numOnly = (v) => {
  if (v === null || v === undefined) return '';
  const s = String(v).trim();
  const m = s.match(/-?\d+(?:\.\d+)?/);
  return m ? m[0] : '';
};

const parseGoodCount = (summary) => {
  const s = String(summary ?? '');
  const m = s.match(/ของดี\s*([0-9]+)\s*รายการ/);
  if (m) return m[1];
  // fallback: first integer in summary
  const n = s.match(/\d+/);
  return n ? n[0] : '';
};

const parseGoodWeightKg = (summary) => {
  const s = String(summary ?? '');
  // Common: "ของดี 10 รายการ / 12.34 kg"
  // Also seen: "ของดี 10 รายการ 12.34 kg" or Thai unit "กก"
  const m1 = s.match(/\/\s*([0-9]+(?:\.[0-9]+)?)\s*(?:kg|กก)/i);
  if (m1) return m1[1];

  // Fallback: take the last numeric value before kg/กก
  const all = [...s.matchAll(/([0-9]+(?:\.[0-9]+)?)\s*(?:kg|กก)/gi)];
  if (all.length > 0) return all[all.length - 1][1];

  // Last resort: if summary only contains two numbers (count + weight), take the second
  const nums = s.match(/-?\d+(?:\.\d+)?/g) ?? [];
  if (nums.length >= 2) return nums[nums.length - 1];

  return '';
};

const parseNgWeightKg = (ngSummary) => {
  const s = String(ngSummary ?? '');
  const m = s.match(/ของเสีย(?:รวม)?\s*([0-9]+(?:\.[0-9]+)?)\s*kg/i);
  if (m) return m[1];
  return numOnly(s);
};

// ─── Sort header ──────────────────────────────────────────────────────────────

const SELECT = 'w-full min-w-0 bg-gray-800 border border-gray-700 text-sm text-gray-300 rounded-lg px-3 py-2 ' +
  'focus:outline-none focus:border-cyan-500 transition';

const TH = ({ children, onClick, sorted, align = 'center', className = '' }) => (
  <th
    onClick={onClick}
    className={`px-3 py-3 text-left text-[11px] font-semibold tracking-wider uppercase whitespace-nowrap select-none
      ${onClick ? 'cursor-pointer hover:text-gray-200' : ''} text-gray-500 ${align === 'left' ? 'text-left' : 'text-center'} ${className}`}
  >
    <span
      className={`relative flex items-center w-full pr-4 ${align === 'left' ? 'justify-start' : 'justify-center'}`}
    >
      <span className={`${align === 'left' ? '' : 'text-center'} truncate`}>
        {children}
      </span>
      {onClick && (
        <svg
          className={`absolute right-0 w-3 h-3 transition-transform ${sorted === 'asc' ? 'rotate-0' : sorted === 'desc' ? 'rotate-180' : 'opacity-30'}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
        </svg>
      )}
    </span>
  </th>
);

// ─── Filter bar ───────────────────────────────────────────────────────────────

const FilterBar = ({ machines, filters, onChange, total, filtered, t }) => (
  <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
    {/* Machine filter */}
    <div className="flex w-full min-w-0 flex-col gap-1 sm:w-auto sm:min-w-[10rem]">
      <label className="text-[10px] text-gray-600 font-semibold uppercase tracking-wider">{t('production.historyFilterMachine')}</label>
      <select value={filters.machine} onChange={(e) => onChange('machine', e.target.value)} className={SELECT}>
        <option value="">{t('production.historyAllMachines')}</option>
        {machines.map((m) => (
          <option key={m.id} value={m.sheetName ?? m.id}>{m.label}</option>
        ))}
      </select>
    </div>

    {/* Status filter */}
    <div className="flex w-full min-w-0 flex-col gap-1 sm:w-auto sm:min-w-[9rem]">
      <label className="text-[10px] text-gray-600 font-semibold uppercase tracking-wider">{t('production.historyFilterStatus')}</label>
      <select value={filters.status} onChange={(e) => onChange('status', e.target.value)} className={SELECT}>
        <option value="">{t('production.historyAllStatuses')}</option>
        <option value="Completed">{t('production.historyStatusCompleted')}</option>
        <option value="In-progress">{t('production.historyStatusInProgress')}</option>
      </select>
    </div>

    {/* Shift filter */}
    <div className="flex w-full min-w-0 flex-col gap-1 sm:w-auto sm:min-w-[9rem]">
      <label className="text-[10px] text-gray-600 font-semibold uppercase tracking-wider">{t('production.historyFilterShift')}</label>
      <select value={filters.shift} onChange={(e) => onChange('shift', e.target.value)} className={SELECT}>
        <option value="">{t('production.historyAllShifts')}</option>
        <option value="A">{t('production.historyShiftA')}</option>
        <option value="B">{t('production.historyShiftB')}</option>
        <option value="C">{t('production.historyShiftC')}</option>
      </select>
    </div>

    {/* Date from */}
    <div className="flex w-full min-w-0 flex-col gap-1 sm:w-auto sm:min-w-[10.5rem]">
      <label className="text-[10px] text-gray-600 font-semibold uppercase tracking-wider">{t('production.historyDateFrom')}</label>
      <input
        type="date"
        value={filters.dateFrom}
        onChange={(e) => onChange('dateFrom', e.target.value)}
        className={SELECT}
      />
    </div>

    {/* Date to */}
    <div className="flex w-full min-w-0 flex-col gap-1 sm:w-auto sm:min-w-[10.5rem]">
      <label className="text-[10px] text-gray-600 font-semibold uppercase tracking-wider">{t('production.historyDateTo')}</label>
      <input
        type="date"
        value={filters.dateTo}
        onChange={(e) => onChange('dateTo', e.target.value)}
        className={SELECT}
      />
    </div>

    {/* Text search */}
    <div className="flex w-full min-w-0 flex-1 flex-col gap-1 sm:min-w-[12rem]">
      <label className="text-[10px] text-gray-600 font-semibold uppercase tracking-wider">{t('production.historySearchLabel')}</label>
      <div className="relative">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none"
          fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          placeholder={t('production.historySearchPlaceholder')}
          value={filters.search}
          onChange={(e) => onChange('search', e.target.value)}
          className={`${SELECT} pl-9 w-full`}
        />
      </div>
    </div>

    <span className="pb-0 text-xs text-gray-600 whitespace-nowrap sm:pb-2">
      {t('production.historyRecordCount', { filtered, total })}
    </span>
  </div>
);

// ─── Main component ───────────────────────────────────────────────────────────

const HistoryView = ({ machines, allowDeleteHistory = false }) => {
  const { language } = useLanguage();
  const { t } = useTranslation(language);

  const [records, setRecords]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const [sort, setSort]         = useState({ key: 'timestamp', dir: 'desc' });
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(null);
  const [detailRow, setDetailRow] = useState(null);
  const [detailData, setDetailData] = useState(null);
  const [detailSortDir, setDetailSortDir] = useState('desc'); // 'asc' oldest-first, 'desc' newest-first
  const [deletingId, setDeletingId] = useState(null);
  const [deleteBanner, setDeleteBanner] = useState(null); // { type: 'error', message: string }
  const [filters, setFilters]   = useState({
    machine:  '',
    status:   '',
    shift:    '',
    dateFrom: sevenDaysAgo(),
    dateTo:   todayStr(),
    search:   '',
  });

  // Build translated column definitions
  const COLS = useMemo(() => {
    const base = [
      { key: 'machine',     label: t('production.historyColMachine')     },
      { key: 'timestamp',   label: t('production.historyColStarted')     },
      { key: 'finishedAt',  label: t('production.historyColFinished')    },
      { key: 'orderId',     label: t('production.historyColOrderId')     },
      { key: 'productCode', label: t('production.historyColProductCode') },
      { key: 'productName', label: t('production.historyColProductName') },
      { key: 'shift',       label: t('production.historyColShift')       },
      { key: 'employeeId',  label: t('production.historyColEmployee')    },
      { key: 'targetQty',   label: t('production.historyColTarget')      },
      { key: 'goodCount',   label: t('production.historyColGood')        },
      { key: 'goodWeight',  label: t('production.historyColGoodWeight')  },
      { key: 'ngWeight',    label: t('production.historyColNg')          },
      { key: 'status',      label: t('production.historyColStatus')      },
      { key: 'view',        label: t('production.historyColView'),        noSort: true },
    ];
    if (allowDeleteHistory) {
      base.push({ key: 'delete', label: t('production.historyColDelete'), noSort: true });
    }
    return base;
  }, [t, allowDeleteHistory]);

  const statusLabel = (s = '') => {
    const lower = String(s).toLowerCase();
    if (lower === 'completed')   return t('production.historyStatusCompleted');
    if (lower === 'in-progress') return t('production.historyStatusInProgress');
    return s || '—';
  };

  const shiftLabel = (s = '') => {
    if (!s) return '—';
    const m = String(s).match(/[ABC]/i);
    return m ? t('production.shiftPrefix') + m[0].toUpperCase() : String(s);
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    setDeleteBanner(null);
    try {
      const data = await fetchHistory(filters.machine || null, {
        from: filters.dateFrom,
        to: filters.dateTo,
        shift: filters.shift || undefined,
      });
      setRecords(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [filters.machine, filters.dateFrom, filters.dateTo]);

  const handleFilterChange = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const toggleSort = (key) => {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: 'desc' }
    );
  };

  const filtered = useMemo(() => {
    let rows = [...records];

    if (filters.status) {
      rows = rows.filter((r) => String(r.status ?? '').toLowerCase() === filters.status.toLowerCase());
    }

    if (filters.shift) {
      rows = rows.filter((r) => {
        const s = String(r.shift ?? '').toUpperCase();
        return s.includes(filters.shift.toUpperCase());
      });
    }

    if (filters.dateFrom) {
      const fromMs = bangkokDayStartUtcMs(filters.dateFrom);
      if (fromMs != null) {
        rows = rows.filter((r) => {
          if (!r.timestamp) return true;
          return new Date(r.timestamp).getTime() >= fromMs;
        });
      }
    }

    if (filters.dateTo) {
      const toMs = bangkokDayEndUtcMs(filters.dateTo);
      if (toMs != null) {
        rows = rows.filter((r) => {
          if (!r.timestamp) return true;
          return new Date(r.timestamp).getTime() <= toMs;
        });
      }
    }

    if (filters.search) {
      const q = filters.search.toLowerCase();
      rows = rows.filter((r) =>
        String(r.orderId      ?? '').toLowerCase().includes(q) ||
        String(r.productName  ?? '').toLowerCase().includes(q) ||
        String(r.productCode  ?? '').toLowerCase().includes(q) ||
        String(r.employeeId   ?? '').toLowerCase().includes(q) ||
        String(r.machine      ?? '').toLowerCase().includes(q)
      );
    }

    rows.sort((a, b) => {
      let va = a[sort.key] ?? '';
      let vb = b[sort.key] ?? '';
      if (['timestamp', 'finishedAt'].includes(sort.key)) {
        va = va ? new Date(va).getTime() : 0;
        vb = vb ? new Date(vb).getTime() : 0;
      } else if (sort.key === 'targetQty') {
        va = Number(va); vb = Number(vb);
      } else {
        va = String(va).toLowerCase(); vb = String(vb).toLowerCase();
      }
      if (va < vb) return sort.dir === 'asc' ? -1 : 1;
      if (va > vb) return sort.dir === 'asc' ?  1 : -1;
      return 0;
    });

    return rows;
  }, [records, filters.status, filters.shift, filters.dateFrom, filters.dateTo, filters.search, sort]);

  // ── Stats strip ──────────────────────────────────────────────────────────────
  const completedRows = useMemo(() => filtered.filter((r) =>
    String(r.status ?? '').toLowerCase() === 'completed'), [filtered]);

  const openDetail = async (row) => {
    setDetailOpen(true);
    setDetailRow(row);
    setDetailData(null);
    setDetailError(null);
    setDetailLoading(true);
    setDetailSortDir('desc');

    const runUlid = row.sessionRunUlid ?? row.session_run_ulid ?? '';
    if (!runUlid) {
      setDetailError(t('production.historyMissingRunUlid'));
      setDetailLoading(false);
      return;
    }

    try {
      const machineKey =
        row.machine_id
        ?? machines.find((m) => String(m.sheetName ?? '') === String(row.machine ?? ''))?.id
        ?? machines.find((m) => String(m.id ?? '') === String(row.machine ?? ''))?.id
        ?? row.machine;
      const detail = await fetchOrderDetail(
        machineKey,
        row.orderId,
        runUlid,
      );
      setDetailData(detail);
    } catch (err) {
      setDetailError(err?.message ?? String(err));
    } finally {
      setDetailLoading(false);
    }
  };

  const handleDeleteRow = async (row) => {
    const hid = row?.id;
    if (hid == null || Number.isNaN(Number(hid))) {
      setDeleteBanner({ type: 'error', message: t('production.historyDeleteNoId') });
      return;
    }
    const confirmTpl = t('production.historyDeleteConfirm');
    const msg =
      typeof confirmTpl === 'function'
        ? confirmTpl({ order: row.orderId ?? String(hid) })
        : String(confirmTpl);
    if (!window.confirm(msg)) return;
    setDeleteBanner(null);
    setDeletingId(hid);
    try {
      await dbDeleteHistoryOrder(hid);
      if (detailOpen && detailRow?.id === hid) {
        setDetailOpen(false);
        setDetailRow(null);
        setDetailData(null);
      }
      await load();
    } catch (err) {
      setDeleteBanner({
        type: 'error',
        message: err?.message ?? String(err),
      });
    } finally {
      setDeletingId(null);
    }
  };

  const sortedDetailEvents = useMemo(() => {
    const events = Array.isArray(detailData?.events) ? detailData.events : [];
    const rows = [...events];
    rows.sort((a, b) => {
      const ta = eventHistoryInstant(a);
      const tb = eventHistoryInstant(b);
      const na = ta ? new Date(ta).getTime() : 0;
      const nb = tb ? new Date(tb).getTime() : 0;
      if (na !== nb) {
        return detailSortDir === 'asc' ? na - nb : nb - na;
      }
      const ida = Number(a?.id ?? a?.auditSeq ?? 0);
      const idb = Number(b?.id ?? b?.auditSeq ?? 0);
      return detailSortDir === 'asc' ? ida - idb : idb - ida;
    });
    return rows;
  }, [detailData, detailSortDir]);

  const exportDetailExcel = async () => {
    const events = sortedDetailEvents;
    const machine = detailRow?.machine ?? detailRow?.machineId ?? detailRow?.machine ?? '';
    const orderId = detailRow?.orderId ?? '';
    const productCode = detailData?.productCode ?? detailRow?.productCode ?? '';

    const filenameParts = [
      'production-detail',
      machine ? String(machine).replace(/\s+/g, '-') : '',
      orderId ? String(orderId).replace(/\s+/g, '-') : '',
    ].filter(Boolean);

    const rows = events.map((ev) => ({
      [t('production.historyEventColSeq')]: ev?.lineOrdinal ?? ev?.seq ?? '',
      [t('production.historyEventColTime')]: eventHistoryInstant(ev)
        ? formatProductionDateTimeBangkok(eventHistoryInstant(ev), { dateStyle: 'short', timeStyle: 'medium' })
        : '',
      [t('production.historyEventColType')]: ev?.type === 'good' ? t('production.historyTypeGood') : t('production.historyTypeNg'),
      [t('production.historyEventColWeight')]: ev?.weight ?? '',
      'ProductCode': productCode,
      'OrderId': orderId,
      'Machine': machine,
    }));

    const XLSX = await import('xlsx');
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Events');
    XLSX.writeFile(wb, `${filenameParts.join('-')}.xlsx`);
  };

  return (
    <div className="flex flex-col h-full">

      {/* ── Top bar ── */}
      <div className="flex-shrink-0 border-b border-gray-700/40 px-4 py-3 sm:px-6 sm:py-4
        flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-base font-bold text-white">{t('production.historyTitle')}</h2>
          <p className="text-xs text-gray-500 mt-0.5">{t('production.historySubtitle')}</p>
        </div>

        <div className="flex w-full flex-wrap items-stretch gap-2 sm:w-auto sm:items-center sm:justify-end">
          <button
            onClick={load}
            disabled={loading}
            className="flex flex-1 min-h-[44px] items-center justify-center gap-1.5 text-xs font-semibold text-gray-400 hover:text-gray-200
              border border-gray-700 hover:border-gray-500 bg-gray-800/50 px-3 py-2 rounded-lg
              transition-all disabled:opacity-40 sm:flex-none sm:min-h-0"
          >
            <svg className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            {loading ? t('common.loading') : t('production.refresh')}
          </button>

          <button
            onClick={() => window.open(GOOGLE_SHEET_URL, '_blank', 'noopener,noreferrer')}
            disabled={loading}
            className="flex flex-1 min-h-[44px] items-center justify-center gap-1.5 text-xs font-semibold bg-green-500/10 hover:bg-green-500/20
              border border-green-500/30 text-green-400 px-3 py-2 rounded-lg transition-all
              disabled:opacity-40 disabled:cursor-not-allowed sm:flex-none sm:min-h-0"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Google Sheet
          </button>
        </div>
      </div>

      {/* ── Summary stats ── */}
      {!loading && !error && filtered.length > 0 && (
        <div className="flex-shrink-0 px-4 sm:px-6 py-3 border-b border-gray-700/30
          grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-gray-800/40 rounded-lg px-3 py-2">
            <p className="text-[10px] text-gray-500 uppercase tracking-wider">{t('production.historyAllTotal')}</p>
            <p className="text-xl font-bold text-white mt-0.5">{filtered.length}</p>
          </div>
          <div className="bg-gray-800/40 rounded-lg px-3 py-2">
            <p className="text-[10px] text-gray-500 uppercase tracking-wider">{t('production.historyCompleted')}</p>
            <p className="text-xl font-bold text-green-400 mt-0.5">{completedRows.length}</p>
          </div>
          <div className="bg-gray-800/40 rounded-lg px-3 py-2">
            <p className="text-[10px] text-gray-500 uppercase tracking-wider">{t('production.historyProducing')}</p>
            <p className="text-xl font-bold text-amber-400 mt-0.5">
              {filtered.filter((r) => String(r.status ?? '').toLowerCase() === 'in-progress').length}
            </p>
          </div>
          <div className="bg-gray-800/40 rounded-lg px-3 py-2">
            <p className="text-[10px] text-gray-500 uppercase tracking-wider">{t('production.historyMachinesRange')}</p>
            <p className="text-xl font-bold text-cyan-400 mt-0.5">
              {new Set(filtered.map((r) => r.machine).filter(Boolean)).size}
            </p>
          </div>
        </div>
      )}

      {/* ── Filters ── */}
      <div className="flex-shrink-0 px-4 sm:px-6 py-3 border-b border-gray-700/30 bg-gray-900/30">
        <FilterBar
          machines={machines}
          filters={filters}
          onChange={handleFilterChange}
          total={records.length}
          filtered={filtered.length}
          t={t}
        />
      </div>

      {deleteBanner?.type === 'error' && (
        <div className="flex-shrink-0 px-4 sm:px-6 py-2 border-b border-red-500/30 bg-red-500/10 flex items-center justify-between gap-3">
          <p className="text-xs text-red-300 flex-1">{deleteBanner.message}</p>
          <button
            type="button"
            onClick={() => setDeleteBanner(null)}
            className="text-[11px] font-semibold text-red-200 hover:text-white border border-red-500/40 rounded-lg px-2 py-1 shrink-0"
          >
            {t('common.close')}
          </button>
        </div>
      )}

      {/* ── Content ── */}
      <div className="flex-1 overflow-auto">

        {loading && (
          <div className="flex flex-col items-center justify-center h-48 gap-3 text-gray-500">
            <svg className="w-7 h-7 animate-spin text-cyan-500" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <p className="text-sm">{t('production.historyLoadingSheets')}</p>
          </div>
        )}

        {!loading && error && (
          <div className="flex flex-col items-center justify-center h-48 gap-3 text-center px-6">
            <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <p className="text-sm text-red-300">{error}</p>
            <button onClick={load} className="text-xs text-cyan-400 hover:underline">{t('production.tryAgain')}</button>
          </div>
        )}

        {!loading && !error && (
          filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-2 text-gray-600">
              <svg className="w-8 h-8 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              <p className="text-sm">{t('production.historyEmptyFiltered')}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full table-auto text-sm border-collapse min-w-[760px]">
                <thead className="bg-gray-900/60 sticky top-0 z-10">
                  <tr>
                    {COLS.map((col) => (
                      <TH
                        key={col.key}
                        onClick={col.noSort ? undefined : () => toggleSort(col.key)}
                        sorted={!col.noSort && sort.key === col.key ? sort.dir : null}
                        align={col.key === 'productName' ? 'left' : 'center'}
                        className={col.key === 'productName' ? 'w-full' : 'w-[1%]'}
                      >
                        {col.label}
                      </TH>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row, i) => (
                    <tr
                      key={row.id != null ? `hist-${row.id}` : `hist-i-${i}`}
                      className="border-t border-gray-800/60 hover:bg-gray-800/30 transition-colors"
                    >
                      <td className="px-2 py-2 font-mono text-xs text-gray-400 whitespace-nowrap text-center w-[1%]">
                        {row.machine ?? '—'}
                      </td>
                      <td className="px-2 py-2 text-xs text-gray-500 whitespace-nowrap text-center w-[1%]">
                        {formatProductionDateTimeBangkok(row.timestamp, { dateStyle: 'short', timeStyle: 'short' })}
                      </td>
                      <td className="px-2 py-2 text-xs text-gray-500 whitespace-nowrap text-center w-[1%]">
                        {row.finishedAt ? formatProductionDateTimeBangkok(row.finishedAt, { dateStyle: 'short', timeStyle: 'short' }) : (
                          String(row.status ?? '').toLowerCase() === 'in-progress'
                            ? <span className="text-amber-400/70">{t('production.historyInProgressCell')}</span>
                            : '—'
                        )}
                      </td>
                      <td className="px-2 py-2 font-mono text-xs text-white whitespace-nowrap text-center w-[1%]">
                        {row.orderId ?? '—'}
                      </td>
                      <td className="px-2 py-2 font-mono text-xs text-gray-400 whitespace-nowrap text-center w-[1%]">
                        {row.productCode ?? '—'}
                      </td>
                      <td className="px-2 py-2 text-xs text-gray-300 min-w-[280px] w-full max-w-[520px] truncate text-left">
                        {row.productName ?? '—'}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-purple-300 whitespace-nowrap text-center">
                        {shiftLabel(row.shift)}
                      </td>
                      <td className="px-2 py-2 font-mono text-xs text-gray-400 whitespace-nowrap text-center w-[1%]">
                        {row.employeeId ?? '—'}
                      </td>
                      <td className="px-2 py-2 font-mono text-xs text-gray-300 whitespace-nowrap text-center w-[1%]">
                        {row.targetQty ?? '—'}
                      </td>
                      <td className="px-2 py-2 font-mono text-xs text-green-300 whitespace-nowrap text-center w-[1%]">
                        {row.goodCount != null
                          ? row.goodCount
                          : (parseGoodCount(row.summary) || (String(row.status ?? '').toLowerCase() === 'in-progress' ? '…' : '—'))}
                      </td>
                      <td className="px-2 py-2 font-mono text-xs text-green-300 whitespace-nowrap text-center w-[1%]">
                        {row.goodWeight != null && row.goodWeight !== ''
                          ? Number(row.goodWeight).toFixed(2)
                          : (parseGoodWeightKg(row.summary) || (String(row.status ?? '').toLowerCase() === 'in-progress' ? '…' : '—'))}
                      </td>
                      <td className="px-2 py-2 font-mono text-xs text-red-300 whitespace-nowrap text-center w-[1%]">
                        {row.ngWeight != null && row.ngWeight !== ''
                          ? Number(row.ngWeight).toFixed(2)
                          : (parseNgWeightKg(row.ngSummary) || (String(row.status ?? '').toLowerCase() === 'in-progress' ? '…' : '—'))}
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap text-center w-[1%]">
                        <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full border ${statusStyle(row.status)}`}>
                          {statusLabel(row.status)}
                        </span>
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap text-center w-[1%]">
                        <button
                          type="button"
                          onClick={() => openDetail(row)}
                          className="text-xs font-semibold text-cyan-300 hover:text-cyan-200
                            border border-cyan-500/30 hover:border-cyan-400/50 bg-cyan-500/10 hover:bg-cyan-500/15
                            px-2.5 py-1.5 rounded-lg transition-all"
                        >
                          {t('production.historyColView')}
                        </button>
                      </td>
                      {allowDeleteHistory && (
                      <td className="px-2 py-2 whitespace-nowrap text-center w-[1%]">
                        <button
                          type="button"
                          disabled={deletingId === row.id}
                          onClick={() => { void handleDeleteRow(row); }}
                          className="text-xs font-semibold text-red-300 hover:text-red-200 disabled:opacity-40
                            border border-red-500/35 hover:border-red-400/55 bg-red-500/10 hover:bg-red-500/15
                            px-2.5 py-1.5 rounded-lg transition-all"
                        >
                          {deletingId === row.id ? t('common.loading') : t('production.historyColDelete')}
                        </button>
                      </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>

      {/* ── Detail Modal ── */}
      {detailOpen && (
        <div
          className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4"
          onClick={() => setDetailOpen(false)}
        >
          <div
            className="w-full max-w-4xl bg-gray-900 border border-gray-700/60 rounded-2xl shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 sm:px-5 py-3.5 border-b border-gray-700/50 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-white">{t('production.historyDetailTitle')}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {detailRow?.orderId ? `Order: ${detailRow.orderId}` : ''}{' '}
                  {(detailData?.productCode || detailRow?.productCode) ? `· Code: ${(detailData?.productCode ?? detailRow?.productCode)}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setDetailSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))}
                  className="text-xs font-semibold text-gray-300 hover:text-white border border-gray-700 hover:border-gray-500
                    bg-gray-800/60 px-3 py-1.5 rounded-lg transition-all"
                >
                  {detailSortDir === 'desc' ? t('production.historySortNewest') : t('production.historySortOldest')}
                </button>
                <button
                  onClick={exportDetailExcel}
                  disabled={detailLoading || sortedDetailEvents.length === 0}
                  className="text-xs font-semibold text-green-300 hover:text-green-200 border border-green-500/30 hover:border-green-400/50
                    bg-green-500/10 hover:bg-green-500/15 px-3 py-1.5 rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {t('production.historyExportExcel')}
                </button>
                <button
                  onClick={() => setDetailOpen(false)}
                  className="text-xs font-semibold text-gray-300 hover:text-white border border-gray-700 hover:border-gray-500
                    bg-gray-800/60 px-3 py-1.5 rounded-lg transition-all"
                >
                  {t('common.close')}
                </button>
              </div>
            </div>

            <div className="px-4 sm:px-5 py-4">
              {detailLoading && (
                <div className="text-sm text-gray-400">{t('common.loading')}</div>
              )}

              {!detailLoading && detailError && (
                <div className="text-sm text-red-300">{detailError}</div>
              )}

              {!detailLoading && !detailError && (
                <div>
                  <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                    <p className="text-xs font-semibold text-gray-400">{t('production.historyEventsTitle')}</p>
                    <div className="text-xs text-gray-500 text-right space-x-2">
                      <span>
                        {sortedDetailEvents.length} {t('common.times')}
                        {detailData?.counts
                          ? ` · ${t('production.historyTypeGood')} ${detailData.counts.good} / ${t('production.historyTypeNg')} ${detailData.counts.ng}`
                          : ''}
                      </span>
                    </div>
                  </div>

                  {sortedDetailEvents.length === 0 ? (
                    <div className="text-sm text-gray-500">{t('production.historyEventsEmpty')}</div>
                  ) : (
                    <div className="overflow-auto max-h-[60vh] rounded-xl border border-gray-800/60">
                      <table className="w-full table-fixed text-sm border-collapse min-w-[440px]">
                        <thead className="bg-gray-900/60 sticky top-0 z-10">
                          <tr className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                            <th className="px-2 py-1.5 text-center w-[72px] whitespace-nowrap">{t('production.historyEventColSeq')}</th>
                            <th className="px-2 py-1.5 text-center w-[130px] whitespace-nowrap">{t('production.historyEventColTime')}</th>
                            <th className="px-2 py-1.5 text-center w-[110px] whitespace-nowrap">{t('production.historyEventColType')}</th>
                            <th className="px-2 py-1.5 text-center w-[120px] whitespace-nowrap">{t('production.historyEventColWeight')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sortedDetailEvents.map((ev, idx) => (
                            <tr key={ev?.id ?? `${idx}-${ev?.pressedAt}-${ev?.lineOrdinal ?? ev?.seq}`} className="border-t border-gray-800/60 hover:bg-gray-800/30 transition-colors">
                              <td className="px-2 py-1.5 text-center font-mono text-[11px] text-gray-300 whitespace-nowrap">
                                {ev?.lineOrdinal ?? ev?.seq ?? '—'}
                              </td>
                              <td
                                className="px-2 py-1.5 text-center text-[11px] text-gray-400 whitespace-nowrap"
                                title={
                                  eventHistoryInstant(ev)
                                    ? formatProductionDateTimeBangkok(eventHistoryInstant(ev), {
                                      dateStyle: 'medium',
                                      timeStyle: 'medium',
                                    })
                                    : ''
                                }
                              >
                                {eventHistoryInstant(ev)
                                  ? formatProductionTimeBangkok(eventHistoryInstant(ev))
                                  : '—'}
                              </td>
                              <td className="px-2 py-1.5 text-center whitespace-nowrap">
                                {ev?.type === 'good' ? (
                                  <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full border text-green-400 bg-green-400/10 border-green-400/25">
                                    {t('production.historyTypeGood')}
                                  </span>
                                ) : (
                                  <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full border text-red-400 bg-red-400/10 border-red-400/25">
                                    {t('production.historyTypeNg')}
                                  </span>
                                )}
                              </td>
                              <td className="px-2 py-1.5 text-center font-mono text-[11px] text-gray-300 whitespace-nowrap">
                                {ev?.weight ?? '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default HistoryView;
