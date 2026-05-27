import React, { useState, useEffect, useMemo, useRef, useLayoutEffect } from 'react';
import { useLanguage } from '../../../contexts/LanguageContext';
import { useTranslation } from '../../../utils/translations';
import { DEFAULT_MACHINE_STATE } from '../hooks/useProductionStates';
import { getLedStatus, getLedHeartbeat } from '../api/productionApi';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function groupByZone(machines, unzoned) {
  const map = new Map();
  machines.forEach((m) => {
    const z = m.zone?.trim() || unzoned;
    if (!map.has(z)) map.set(z, []);
    map.get(z).push(m);
  });
  return Array.from(map.entries())
    .map(([zone, list]) => ({ zone, machines: list }))
    .sort((a, b) => {
      if (a.zone === unzoned) return 1;
      if (b.zone === unzoned) return -1;
      return a.zone.localeCompare(b.zone, 'th');
    });
}

function useClock() {
  const [tick, setTick] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setTick(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return tick;
}

function pct(produced, target) {
  if (!target || target <= 0) return 0;
  return Math.min(100, Math.round((produced / target) * 100));
}

function fmtNum(n) {
  const v = Number(n);
  return isNaN(v) ? '—' : v.toLocaleString('th-TH');
}

function fmtWeight(n) {
  const v = Number(n);
  return isNaN(v) ? '—' : v.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function isMaintenanceLedText(text) {
  return /แก้งาน|break\s*down|breakdown|fixing|fix/i.test(String(text || ''));
}

function ledColorFromState(state) {
  if (!state || state.r == null) return null;
  return `rgb(${state.r}, ${state.g ?? 0}, ${state.b ?? 0})`;
}

function ledStateToPatch(state) {
  if (!state) return {};
  return {
    text: state.text ?? null,
    color: ledColorFromState(state),
    speed: state.speed ?? 50,
  };
}

// ─── LedMarqueeText ───────────────────────────────────────────────────────────

const LedMarqueeText = ({ text, fontSize, color, rowKey }) => {
  const boxRef = useRef(null);
  const textRef = useRef(null);
  const [scroll, setScroll] = useState(false);
  const [boxW, setBoxW] = useState(0);
  const [textW, setTextW] = useState(0);

  useLayoutEffect(() => {
    const box = boxRef.current;
    const el = textRef.current;
    if (!box || !el) return undefined;
    const measure = () => {
      setBoxW(box.clientWidth);
      setTextW(el.scrollWidth);
      setScroll(el.scrollWidth > box.clientWidth + 2);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    return () => ro.disconnect();
  }, [text, fontSize]);

  const animName = `ledScroll_${String(rowKey).replace(/\W/g, '_')}`;
  const duration = scroll && boxW > 0 && textW > 0
    ? Math.max(4, (boxW + textW) / 36)
    : 0;

  if (!text) {
    return <span className="truncate font-medium opacity-60">—</span>;
  }

  return (
    <div ref={boxRef} className="overflow-hidden min-w-0 flex-1 relative flex items-center">
      <span
        ref={textRef}
        className="absolute invisible whitespace-nowrap pointer-events-none"
        style={{ fontSize }}
        aria-hidden
      >
        {text}
      </span>
      {scroll ? (
        <>
          <style>{`
            @keyframes ${animName} {
              from { transform: translateX(${Math.round(boxW)}px); }
              to   { transform: translateX(-${Math.round(textW)}px); }
            }
          `}</style>
          <span
            className="inline-block whitespace-nowrap font-medium"
            style={{
              fontSize,
              color: color ?? 'inherit',
              animation: `${animName} ${duration}s linear infinite`,
            }}
          >
            {text}
          </span>
        </>
      ) : (
        <span
          className="truncate font-medium"
          style={{ fontSize, color: color ?? 'inherit' }}
          title={text}
        >
          {text}
        </span>
      )}
    </div>
  );
};

function resolveMachineStatus(machine, state, ledText, t) {
  const isActive = machine.status?.toLowerCase() !== 'unactive';
  const isLive = state?.mode === 'live';
  const hasPause = !!state?.pausedOrder;
  const maintenance = isMaintenanceLedText(ledText);

  if (!isActive) {
    return {
      key: 'off',
      label: t('production.dashboardStatusOff'),
      rowClass: 'bg-[#141414] text-white border-b border-gray-800/80',
      cardClass: 'bg-gray-700 text-white',
    };
  }
  if (maintenance || (hasPause && !isLive)) {
    return {
      key: 'fix',
      label: t('production.dashboardStatusFixing'),
      rowClass: 'bg-yellow-400 text-black border-b border-yellow-500/40',
      cardClass: 'bg-yellow-400 text-black',
    };
  }
  if (isLive) {
    return {
      key: 'on',
      label: t('production.dashboardStatusOpen'),
      rowClass: 'bg-green-500 text-white border-b border-green-600/40',
      cardClass: 'bg-green-500 text-white',
    };
  }
  return {
    key: 'off',
    label: t('production.dashboardStatusOff'),
    rowClass: 'bg-[#141414] text-white border-b border-gray-800/80',
    cardClass: 'bg-gray-700 text-white',
  };
}

function useLedBoardStatuses(machines, sseLedByMachine) {
  const machineKey = machines.map((m) => m.id).join(',');
  const [ledData, setLedData] = useState({});

  // รวม SSE push จาก parent ทันที (ไม่รอ poll)
  useEffect(() => {
    if (!sseLedByMachine || !Object.keys(sseLedByMachine).length) return;
    setLedData((prev) => {
      const next = { ...prev };
      let changed = false;
      Object.entries(sseLedByMachine).forEach(([id, patch]) => {
        const merged = {
          ...(prev[id] ?? { text: null, online: false, noIp: false }),
          ...patch,
        };
        if (JSON.stringify(merged) !== JSON.stringify(prev[id])) {
          next[id] = merged;
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [sseLedByMachine]);

  useEffect(() => {
    const list = machines;
    if (!list.length) {
      setLedData({});
      return undefined;
    }

    let cancelled = false;

    const fetchAll = async () => {
      const entries = await Promise.all(
        list.map(async (m) => {
          if (!m.ledIp) {
            return [m.id, { text: null, online: false, noIp: true }];
          }
          try {
            const [statusRes, hbRes] = await Promise.all([
              getLedStatus(m.id).catch(() => null),
              getLedHeartbeat(m.id).catch(() => null),
            ]);
            return [
              m.id,
              {
                text: statusRes?.state?.text ?? null,
                online: hbRes?.online ?? false,
                noIp: false,
                ...ledStateToPatch(statusRes?.state),
              },
            ];
          } catch {
            return [m.id, { text: null, online: false, noIp: false }];
          }
        }),
      );
      if (!cancelled) setLedData(Object.fromEntries(entries));
    };

    fetchAll();
    const id = setInterval(fetchAll, 5_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [machineKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return ledData;
}

function useFluidTableMetrics(containerRef, rowCount) {
  const [metrics, setMetrics] = useState({
    fontSize: 13,
    headerFont: 10,
    subFont: 9,
    padX: 8,
    padY: 6,
    titleFont: 13,
    dot: 8,
    barH: 4,
    rowH: 32,
  });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;

    const update = () => {
      const h = el.clientHeight;
      const w = el.clientWidth;
      const titleH = Math.max(24, h * 0.07);
      const theadH = Math.max(22, h * 0.075);
      const bodyH = Math.max(48, h - titleH - theadH);
      const rows = Math.max(rowCount, 1);
      const rowH = bodyH / rows;

      const fontSize = Math.max(w < 640 ? 11 : 9, Math.min(20, rowH * 0.42));
      const padY = Math.max(1, Math.min(12, rowH * 0.1));
      const padX = Math.max(2, Math.min(14, w * 0.007));
      const headerFont = Math.max(8, Math.min(13, fontSize * 0.82));
      const subFont = Math.max(7, Math.min(11, fontSize * 0.72));
      const titleFont = Math.max(10, Math.min(16, titleH * 0.45));
      const dot = Math.max(6, Math.min(12, fontSize * 0.65));
      const barH = Math.max(2, Math.min(6, rowH * 0.1));

      setMetrics({ fontSize, headerFont, subFont, padX, padY, titleFont, dot, barH, rowH });
    };

    const ro = new ResizeObserver(update);
    ro.observe(el);
    update();
    window.addEventListener('resize', update);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [rowCount]);

  return metrics;
}

function useFluidStatusMetrics(containerRef, zoneGroups) {
  const zoneCount = zoneGroups.length;
  const totalCards = zoneGroups.reduce((n, z) => n + z.machines.length, 0);

  const [metrics, setMetrics] = useState({
    titleFont: 14,
    zoneFont: 10,
    labelFont: 12,
    valueFont: 22,
    gap: 6,
    pad: 6,
    zoneGap: 8,
    gridCols: 1,
  });

  useEffect(() => {
    const el = containerRef.current;
    if (!el || zoneCount === 0) return undefined;

    const update = () => {
      const h = el.clientHeight;
      const w = el.clientWidth;
      const titleH = Math.max(24, h * 0.07);
      const bodyH = Math.max(60, h - titleH);
      const bodyW = w;

      const gridCols = w < 480 ? 1 : w < 960 ? 1 : zoneCount <= 2 ? 1 : 2;
      const gridRows = Math.ceil(zoneCount / gridCols);
      const zoneH = bodyH / gridRows;
      const zoneW = bodyW / gridCols;

      const maxCardsInZone = Math.max(...zoneGroups.map((z) => z.machines.length), 1);
      const cardRows = Math.ceil(maxCardsInZone / 2);
      const cardH = (zoneH - 20) / cardRows;
      const cardW = (zoneW - 16) / 2;

      const valueFont = Math.max(12, Math.min(36, Math.min(cardH, cardW) * 0.38));
      const labelFont = Math.max(9, Math.min(16, valueFont * 0.5));
      const zoneFont = Math.max(8, Math.min(12, zoneH * 0.1));
      const titleFont = Math.max(10, Math.min(18, titleH * 0.45));
      const gap = Math.max(3, Math.min(8, cardH * 0.06));
      const pad = Math.max(3, Math.min(10, cardH * 0.08));
      const zoneGap = Math.max(4, Math.min(10, bodyH * 0.012));

      setMetrics({ titleFont, zoneFont, labelFont, valueFont, gap, pad, zoneGap, gridCols });
    };

    const ro = new ResizeObserver(update);
    ro.observe(el);
    update();
    window.addEventListener('resize', update);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [zoneCount, totalCards, zoneGroups]);

  return metrics;
}

// ─── Shared row builder ───────────────────────────────────────────────────────

function buildDashboardRows(machines, allStates, getMachineState, ledData, t) {
  return [...machines].sort((a, b) => {
    const sa = resolveMachineStatus(a, getMachineState(a.id), ledData[a.id]?.text, t);
    const sb = resolveMachineStatus(b, getMachineState(b.id), ledData[b.id]?.text, t);
    const rank = { on: 0, fix: 1, off: 2 };
    const diff = (rank[sa.key] ?? 9) - (rank[sb.key] ?? 9);
    if (diff !== 0) return diff;
    return String(a.label).localeCompare(String(b.label), 'th');
  });
}

function getDashboardRowData(machine, allStates, getMachineState, ledData, t) {
  const state = allStates[machine.id] ?? getMachineState(machine.id) ?? DEFAULT_MACHINE_STATE;
  const led = ledData[machine.id] ?? {};
  const status = resolveMachineStatus(machine, state, led.text, t);
  const produced = state.pipeCounter ?? 0;
  const goodWeight = state.totalGoodWeight ?? 0;
  const ngWeight = state.totalNgWeight ?? 0;
  const target = (state.remainingQty > 0 ? state.remainingQty : state.targetQty) ?? 0;
  const progress = pct(produced, target);
  const ledLabel = led.noIp
    ? t('production.ledStatusNoIp')
    : led.text || t('production.dashboardLedNoText');

  return { machine, state, led, status, produced, goodWeight, ngWeight, target, progress, ledLabel };
}

// ─── Mobile table + status (scrollable, fixed readable sizes) ─────────────────

function getStatusGridCols(containerWidth) {
  for (const c of [6, 5, 4]) {
    if (containerWidth / c >= 52) return c;
  }
  return 4;
}

function useStatusGridCols(containerRef) {
  const [cols, setCols] = useState(4);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;

    const update = () => setCols(getStatusGridCols(el.clientWidth || 360));
    const ro = new ResizeObserver(update);
    ro.observe(el);
    update();
    window.addEventListener('resize', update);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
    };
  }, []);

  return cols;
}

const LedDot = ({ led, t, size = 6 }) => (
  <span
    className={`inline-block shrink-0 rounded-full ${
      led.noIp
        ? 'bg-gray-500'
        : led.online
          ? 'bg-green-300 shadow-[0_0_4px_rgba(134,239,172,0.8)]'
          : 'bg-red-400 animate-pulse'
    }`}
    style={{ width: size, height: size }}
    title={
      led.noIp
        ? t('production.ledStatusNoIp')
        : led.online
          ? t('production.ledStatusOnline')
          : t('production.ledStatusOffline')
    }
  />
);

const statusShortLabel = (status) => {
  if (status.key === 'on') return 'ON';
  if (status.key === 'fix') return 'FX';
  return '—';
};

const MachineCompactTable = ({ machines, allStates, getMachineState, ledData, t }) => {
  const rows = useMemo(
    () => buildDashboardRows(machines, allStates, getMachineState, ledData, t),
    [machines, allStates, getMachineState, ledData, t],
  );
  const rowH = 30;
  const fontSize = 11;
  const headerFont = 9;
  const cellPad = { padding: '4px 6px' };

  return (
    <div className="rounded-xl border border-gray-800/60 bg-[#0a0a0a]">
      <div className="border-b border-gray-800/80 bg-gray-900/80 px-2 py-1">
        <h2 className="text-[10px] font-bold text-white">
          {t('production.dashboardTableTitle')}
          <span className="ml-1.5 font-normal text-gray-500">({rows.length})</span>
        </h2>
      </div>
      <table className="w-full border-collapse table-fixed" style={{ fontSize }}>
        <thead className="bg-gray-900/95 text-gray-500" style={{ fontSize: headerFont }}>
          <tr className="uppercase tracking-wide">
            <th className="w-[18%] text-left" style={cellPad}>{t('production.dashboardColMachine')}</th>
            <th className="w-[8%] text-center" style={cellPad}>{t('production.dashboardColStatus')}</th>
            <th className="w-[14%] text-right" style={cellPad}>{t('production.dashboardColGoodQty')}</th>
            <th className="min-w-0 text-left" style={cellPad}>{t('production.dashboardColProduct')}</th>
            <th className="w-[5%]" style={cellPad} aria-hidden />
          </tr>
        </thead>
        <tbody>
          {rows.map((machine) => {
            const row = getDashboardRowData(machine, allStates, getMachineState, ledData, t);
            const { state, led, status, produced, ledLabel } = row;

            return (
              <tr
                key={machine.id}
                className={`border-b border-black/10 ${status.rowClass}`}
                style={{ height: rowH }}
                title={`${machine.label} · ${status.label} · ${ledLabel}`}
              >
                <td className="truncate font-bold align-middle" style={cellPad}>{machine.label}</td>
                <td className="text-center align-middle font-bold" style={cellPad}>{statusShortLabel(status)}</td>
                <td className="truncate text-right align-middle font-mono tabular-nums" style={cellPad}>{fmtNum(produced)}</td>
                <td className="max-w-0 truncate align-middle font-medium" style={cellPad}>
                  {state.productCode || state.productName || '—'}
                </td>
                <td className="text-center align-middle" style={cellPad}>
                  <LedDot led={led} t={t} size={6} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

const StatusMobileOverview = ({ zoneGroups, allStates, getMachineState, ledData, t }) => {
  const containerRef = useRef(null);
  const cols = useStatusGridCols(containerRef);
  const flatMachines = useMemo(
    () => zoneGroups.flatMap(({ zone, machines: zm }) => zm.map((m) => ({ machine: m, zone }))),
    [zoneGroups],
  );

  return (
    <div
      ref={containerRef}
      className="rounded-xl border border-gray-800/60 bg-[#0a0a0a]"
    >
      <div className="border-b border-gray-800/80 bg-gray-900/80 px-2 py-1">
        <h2 className="text-[10px] font-bold text-white">
          {t('production.dashboardStatusMachine')}
          <span className="ml-1.5 font-normal text-gray-500">({flatMachines.length})</span>
        </h2>
      </div>
      <div className="p-1">
        <div
          className="grid w-full"
          style={{
            gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
            gap: '6px',
          }}
        >
          {flatMachines.map(({ machine: m, zone }) => {
            const state = allStates[m.id] ?? getMachineState(m.id);
            const status = resolveMachineStatus(m, state, ledData[m.id]?.text, t);
            const isLive = state?.mode === 'live';
            const value = isLive ? (state.pipeCounter ?? 0) : 0;

            return (
              <div
                key={m.id}
                className={`flex min-h-[44px] flex-col items-center justify-center rounded border border-black/10 px-1 py-1.5 ${status.cardClass}`}
                title={`${zone} · ${m.label}: ${fmtNum(value)}`}
              >
                <span className="max-w-full truncate text-[9px] font-bold leading-tight">
                  {m.label}
                </span>
                <span className="mt-0.5 font-mono text-xs font-black tabular-nums leading-none">
                  {fmtNum(value)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

// ─── MachineTable (desktop / tablet) ──────────────────────────────────────────

const MachineTable = ({ machines, allStates, getMachineState, ledData, t }) => {
  const containerRef = useRef(null);

  const rows = useMemo(
    () => buildDashboardRows(machines, allStates, getMachineState, ledData, t),
    [machines, allStates, getMachineState, ledData, t],
  );

  const m = useFluidTableMetrics(containerRef, rows.length);
  const cellPad = { padding: `${m.padY}px ${m.padX}px` };

  return (
    <div
      ref={containerRef}
      className="flex flex-col min-h-0 h-full bg-[#0a0a0a] rounded-xl border border-gray-800/60 overflow-hidden"
    >
      <div
        className="flex-shrink-0 border-b border-gray-800/80 bg-gray-900/80"
        style={{ padding: `${Math.max(4, m.padY)}px ${m.padX}px` }}
      >
        <h2 className="font-bold text-white leading-none" style={{ fontSize: m.titleFont }}>
          {t('production.dashboardTableTitle')}
        </h2>
      </div>
      <div className="flex-1 min-h-0 min-w-0 overflow-x-auto overflow-y-auto">
        <table
          className="h-full w-full min-w-[880px] border-collapse text-left table-fixed"
          style={{ fontSize: m.fontSize }}
        >
          <colgroup>
            <col style={{ width: '10%' }} />
            <col style={{ width: '7%' }} />
            <col style={{ width: '7%' }} />
            <col style={{ width: '17%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '9%' }} />
            <col style={{ width: '22%' }} />
          </colgroup>
          <thead className="bg-gray-900/95">
            <tr
              className="uppercase tracking-wide text-gray-400 border-b border-gray-700/60"
              style={{ fontSize: m.headerFont, height: Math.max(22, m.rowH * 0.85) }}
            >
              <th className="font-semibold truncate" style={cellPad}>{t('production.dashboardColMachine')}</th>
              <th className="font-semibold truncate" style={cellPad}>{t('production.dashboardColStatus')}</th>
              <th className="font-semibold truncate" style={cellPad}>{t('production.dashboardColEmployee')}</th>
              <th className="font-semibold truncate" style={cellPad}>{t('production.dashboardColProduct')}</th>
              <th className="font-semibold truncate" style={cellPad}>{t('production.dashboardColGoodQty')}</th>
              <th className="font-semibold truncate" style={cellPad}>{t('production.dashboardColGoodWeight')}</th>
              <th className="font-semibold truncate" style={cellPad}>{t('production.dashboardColNgWeight')}</th>
              <th className="font-semibold truncate" style={cellPad}>{t('production.dashboardColTarget')}</th>
              <th className="font-semibold truncate" style={cellPad}>{t('production.dashboardColLed')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((machine) => {
              const row = getDashboardRowData(machine, allStates, getMachineState, ledData, t);
              const { state, led, status, produced, goodWeight, ngWeight, target, progress, ledLabel } = row;

              return (
                <tr
                  key={machine.id}
                  className={status.rowClass}
                  style={{ height: m.rowH }}
                >
                  <td className="font-bold truncate align-middle" style={cellPad} title={machine.label}>
                    {machine.label}
                  </td>
                  <td className="font-semibold truncate align-middle" style={cellPad} title={status.label}>
                    {status.label}
                  </td>
                  <td
                    className="font-bold font-mono truncate align-middle tabular-nums"
                    style={cellPad}
                    title={state.employeeId || ''}
                  >
                    {state.mode === 'live' && state.employeeId ? state.employeeId : '—'}
                  </td>
                  <td className="align-middle min-w-0" style={cellPad}>
                    <div
                      className="truncate font-medium"
                      title={state.productName || state.productCode || ''}
                    >
                      {state.productCode || state.productName || '—'}
                    </div>
                    {state.orderId && (
                      <div
                        className={`font-mono truncate ${status.key === 'fix' ? 'text-black/55' : 'text-white/55'}`}
                        style={{ fontSize: m.subFont }}
                        title={state.orderId}
                      >
                        {state.orderId}
                      </div>
                    )}
                  </td>
                  <td className="font-bold font-mono truncate align-middle tabular-nums" style={cellPad}>
                    {fmtNum(produced)}
                  </td>
                  <td className="font-bold font-mono truncate align-middle tabular-nums" style={cellPad}>
                    {fmtWeight(goodWeight)}
                  </td>
                  <td className="font-bold font-mono truncate align-middle tabular-nums" style={cellPad}>
                    {fmtWeight(ngWeight)}
                  </td>
                  <td className="align-middle min-w-0" style={cellPad}>
                    <div className="font-bold font-mono truncate tabular-nums">{fmtNum(target)}</div>
                    {target > 0 && (
                      <div
                        className="mt-0.5 w-full max-w-full bg-black/20 rounded-full overflow-hidden"
                        style={{ height: m.barH }}
                      >
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${
                            status.key === 'fix' ? 'bg-black/50' : 'bg-cyan-300'
                          }`}
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    )}
                  </td>
                  <td className="align-middle min-w-0" style={cellPad}>
                    <div className="flex items-center min-w-0 h-full" style={{ gap: Math.max(4, m.padX * 0.5) }}>
                      <LedDot led={led} t={t} size={m.dot} />
                      <LedMarqueeText
                        text={led.noIp ? t('production.ledStatusNoIp') : ledLabel}
                        fontSize={m.fontSize}
                        color={led.color ?? (status.key === 'fix' ? '#000' : undefined)}
                        rowKey={machine.id}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ─── StatusMachineCard ────────────────────────────────────────────────────────

const StatusMachineCard = ({ machine, state, ledText, t, metrics }) => {
  const status = resolveMachineStatus(machine, state, ledText, t);
  const isLive = state?.mode === 'live';
  const value = isLive ? (state.pipeCounter ?? 0) : 0;

  return (
    <div
      className={`flex flex-col items-center justify-center h-full min-h-0 rounded-lg border border-black/10 overflow-hidden ${status.cardClass}`}
      style={{ padding: metrics.pad }}
    >
      <span
        className="font-black leading-tight truncate max-w-full text-center"
        style={{ fontSize: metrics.labelFont }}
        title={machine.label}
      >
        {machine.label}
      </span>
      <span
        className="font-black leading-none tabular-nums transition-all duration-300"
        style={{ fontSize: metrics.valueFont, marginTop: metrics.gap * 0.5 }}
      >
        {fmtNum(value)}
      </span>
    </div>
  );
};

// ─── StatusZonePanel ──────────────────────────────────────────────────────────

const StatusZonePanel = ({ zone, machines, allStates, getMachineState, ledData, metrics }) => {
  const { language } = useLanguage();
  const { t } = useTranslation(language);

  const cardRows = Math.ceil(machines.length / 2);

  return (
    <div
      className="rounded-xl border border-gray-700/40 bg-gray-900/30 min-w-0 min-h-0 h-full flex flex-col overflow-hidden"
      style={{ padding: metrics.pad }}
    >
      <h3
        className="font-bold text-gray-300 uppercase tracking-wide truncate flex-shrink-0"
        style={{ fontSize: metrics.zoneFont, marginBottom: metrics.gap * 0.5 }}
      >
        {zone}
      </h3>
      <div
        className="flex-1 min-h-0 grid grid-cols-1 sm:grid-cols-2"
        style={{
          gap: metrics.gap,
          gridTemplateRows: `repeat(${cardRows}, minmax(0, 1fr))`,
        }}
      >
        {machines.map((m) => {
          const state = allStates[m.id] ?? getMachineState(m.id);
          return (
            <StatusMachineCard
              key={m.id}
              machine={m}
              state={state}
              ledText={ledData[m.id]?.text}
              t={t}
              metrics={metrics}
            />
          );
        })}
      </div>
    </div>
  );
};

// ─── StatusMachinePanel ───────────────────────────────────────────────────────

const StatusMachinePanel = ({ zoneGroups, allStates, getMachineState, ledData, t }) => {
  const containerRef = useRef(null);
  const metrics = useFluidStatusMetrics(containerRef, zoneGroups);
  const gridRows = Math.ceil(zoneGroups.length / metrics.gridCols);

  return (
    <div
      ref={containerRef}
      className="flex flex-col min-h-0 h-full bg-[#0a0a0a] rounded-xl border border-gray-800/60 overflow-hidden"
    >
      <div
        className="flex-shrink-0 border-b border-gray-800/80 bg-gray-900/80"
        style={{ padding: `${Math.max(4, metrics.pad)}px ${metrics.pad}px` }}
      >
        <h2 className="font-bold text-white leading-none" style={{ fontSize: metrics.titleFont }}>
          {t('production.dashboardStatusMachine')}
        </h2>
      </div>
      <div
        className="flex-1 min-h-0 min-w-0 overflow-y-auto overscroll-y-contain"
        style={{ padding: metrics.pad }}
      >
        <div
          className="h-full w-full"
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${metrics.gridCols}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${gridRows}, minmax(0, 1fr))`,
            gap: metrics.zoneGap,
          }}
        >
          {zoneGroups.map(({ zone, machines: zm }) => (
            <StatusZonePanel
              key={zone}
              zone={zone}
              machines={zm}
              allStates={allStates}
              getMachineState={getMachineState}
              ledData={ledData}
              metrics={metrics}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

// ─── DashboardView ────────────────────────────────────────────────────────────

const DashboardView = ({ machines, allStates, getMachineState, sseLedByMachine, lastSyncAt, onClose }) => {
  const { language } = useLanguage();
  const { t } = useTranslation(language);

  const now = useClock();
  const UNZONED = t('production.zoneUnspecified');
  const zoneGroups = useMemo(() => groupByZone(machines, UNZONED), [machines, UNZONED]);
  const ledData = useLedBoardStatuses(machines, sseLedByMachine);

  const liveCount = Object.values(allStates).filter((s) => s?.mode === 'live').length;
  const activeCount = machines.filter((m) => m.status?.toLowerCase() !== 'unactive').length;

  return (
    <div className="flex h-[100dvh] min-h-0 w-full max-w-[100vw] flex-col bg-gray-950 text-white select-none">

      {/* ── Header (compact) ─────────────────────────────────────────────────── */}
      <header className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-gray-700/40 bg-gray-900/80 px-2 backdrop-blur-sm sm:h-11 sm:px-5">
        <div className="flex min-w-0 items-center gap-2">
          <svg className="h-4 w-4 shrink-0 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
          </svg>
          <span className="truncate text-xs font-bold text-white sm:text-sm">{t('production.dashboardTitleShort')}</span>
          <span className="flex shrink-0 items-center gap-1 rounded-full border border-green-500/20 bg-green-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-green-300">
            <span className="h-1 w-1 animate-pulse rounded-full bg-green-400" />
            {liveCount}/{machines.length}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
          {lastSyncAt && (
            <span className="hidden text-[10px] text-gray-600 lg:block">
              {t('production.dashboardSyncPrefix')}{lastSyncAt.toLocaleTimeString('th-TH')}
            </span>
          )}
          <span className="font-mono text-[11px] font-bold tabular-nums text-cyan-300 sm:text-sm">
            {now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-gray-700/50 p-1.5 text-gray-500 transition-all hover:border-gray-500 hover:text-gray-200"
            aria-label={t('production.dashboardExit')}
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        </div>
      </header>

      {/* ── Main ───────────────────────────────────────────────────────────── */}
      <div className="min-h-0 flex-1 overflow-hidden p-0.5 sm:p-1">

        {/* Mobile: scroll ทั้งตาราง + สถานะ — แสดงครบทุกเครื่อง */}
        <div className="flex h-full flex-col gap-2 overflow-y-auto overscroll-y-contain pb-[env(safe-area-inset-bottom)] md:hidden">
          <MachineCompactTable
            machines={machines}
            allStates={allStates}
            getMachineState={getMachineState}
            ledData={ledData}
            t={t}
          />
          <StatusMobileOverview
            zoneGroups={zoneGroups}
            allStates={allStates}
            getMachineState={getMachineState}
            ledData={ledData}
            t={t}
          />
        </div>

        {/* Tablet/desktop: คู่กันแนวนอน */}
        <div className="hidden h-full min-h-0 flex-row gap-1 overflow-hidden md:flex">
          <div className="min-h-0 min-w-0 flex-[3] lg:max-w-[58%]">
            <MachineTable
              machines={machines}
              allStates={allStates}
              getMachineState={getMachineState}
              ledData={ledData}
              t={t}
            />
          </div>

          <div className="min-h-0 min-w-0 flex-[2]">
            <StatusMachinePanel
              zoneGroups={zoneGroups}
              allStates={allStates}
              getMachineState={getMachineState}
              ledData={ledData}
              t={t}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default DashboardView;
