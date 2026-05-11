import React, { useState, useEffect, useMemo } from 'react';
import { useLanguage } from '../../../contexts/LanguageContext';
import { useTranslation } from '../../../utils/translations';
import { DEFAULT_MACHINE_STATE } from '../hooks/useProductionStates';

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

// Dynamic column count for machine grid inside a zone
function zoneCols(count) {
  if (count <= 2)  return 2;
  if (count <= 4)  return 2;
  if (count <= 6)  return 3;
  if (count <= 9)  return 3;
  if (count <= 12) return 4;
  if (count <= 16) return 4;
  return Math.ceil(Math.sqrt(count));
}

// Live clock
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

// ─── MachineCard ──────────────────────────────────────────────────────────────

const MachineCard = ({ machine, state }) => {
  const { language } = useLanguage();
  const { t } = useTranslation(language);

  const s        = state ?? DEFAULT_MACHINE_STATE;
  const isLive   = s.mode === 'live';
  const isActive = machine.status?.toLowerCase() !== 'unactive';
  const produced = s.pipeCounter   ?? 0;
  const target   = (s.remainingQty > 0 ? s.remainingQty : s.targetQty) ?? 0;
  const progress = pct(produced, target);
  const queueLen = s.queue?.length ?? 0;
  const hasPause = !!s.pausedOrder;

  // ── Status style ──────────────────────────────────────────────────────────
  let card, dot, badge, badgeTxt;

  if (!isActive) {
    card     = 'bg-gray-800/25 border-gray-700/20 opacity-40';
    dot      = 'bg-gray-600';
    badge    = 'text-gray-600 bg-gray-800/50 border-gray-700/30';
    badgeTxt = t('production.dashboardStatusOff');
  } else if (isLive) {
    card     = 'bg-green-500/8 border-green-500/30 shadow-[0_0_12px_rgba(74,222,128,0.08)]';
    dot      = 'bg-green-400 animate-pulse shadow-[0_0_6px_rgba(74,222,128,0.6)]';
    badge    = 'text-green-300 bg-green-500/15 border-green-500/35';
    badgeTxt = t('production.dashboardStatusLive');
  } else if (hasPause) {
    card     = 'bg-amber-500/6 border-amber-500/25';
    dot      = 'bg-amber-400';
    badge    = 'text-amber-300 bg-amber-500/15 border-amber-500/30';
    badgeTxt = t('production.dashboardStatusPaused');
  } else {
    card     = 'bg-gray-800/30 border-gray-700/35';
    dot      = 'bg-gray-500';
    badge    = 'text-gray-500 bg-gray-700/30 border-gray-600/30';
    badgeTxt = t('production.dashboardStatusIdle');
  }

  const progColor = progress >= 100
    ? 'bg-green-400'
    : progress >= 80
    ? 'bg-cyan-400'
    : progress >= 50
    ? 'bg-cyan-500'
    : 'bg-blue-500';

  return (
    <div className={`flex flex-col rounded-xl border p-2 transition-all duration-300 min-h-0 min-w-0 overflow-hidden w-full ${card}`}>

      {/* ── Top row: machine name + status badge ── */}
      <div className="flex items-center justify-between gap-1 mb-1 flex-shrink-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dot}`} />
          <span className="text-[11px] font-bold text-white leading-none truncate">
            {machine.label}
          </span>
        </div>
        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border flex-shrink-0 leading-tight ${badge}`}>
          {badgeTxt}
        </span>
      </div>

      {/* ── Live content ── */}
      {isLive && (
        <div className="flex flex-col gap-1 flex-1 min-h-0">
          {/* Order ID */}
            {s.orderId && (
            <p className="truncate flex-shrink-0 font-mono text-base text-cyan-400/80 sm:text-lg md:text-[20px]">
              {s.orderId}
            </p>
          )}
          {/* Product name */}
          {s.productName && (
            <p
              className="text-[12px] text-gray-300 leading-tight flex-shrink-0 break-words"
              title={s.productName}
              style={{ wordBreak: 'break-word', whiteSpace: 'pre-line', overflowWrap: 'break-word' }}
            >
              {s.productName}
            </p>
          )}
          {/* Progress bar */}
          {target > 0 && (
            <div className="flex-shrink-0 mt-auto pt-1">
              <div className="flex justify-between items-center mb-0.5">
                <span className="text-[9px] text-gray-600 font-mono">
                  {fmtNum(produced)}/{fmtNum(target)}
                </span>
                <span className={`text-[10px] font-mono font-bold ${
                  progress >= 100 ? 'text-green-400' : 'text-cyan-400'
                }`}>
                  {progress}%
                </span>
              </div>
              <div className="h-1.5 bg-gray-700/60 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-700 ${progColor}`}
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}
          {/* NG indicator */}
          {(s.ngCount ?? 0) > 0 && (
            <p className="text-[9px] text-red-400/70 flex-shrink-0 mt-0.5">
              {t('production.dashboardNgPrefix')}{fmtNum(s.ngCount)}
            </p>
          )}
        </div>
      )}

      {/* ── Paused order ── */}
      {hasPause && !isLive && (
        <p className="text-[9px] text-amber-400/80 truncate mt-1 flex-shrink-0">
          ⏸ {s.pausedOrder?.orderId || t('production.dashboardPausedFallback')}
        </p>
      )}

      {/* ── IDLE with queue ── */}
      {!isLive && !hasPause && isActive && queueLen > 0 && (
        <p className="text-[9px] text-gray-500 mt-1 flex-shrink-0">
          {t('production.dashboardQueueSummary', { count: queueLen })}
        </p>
      )}
    </div>
  );
};

// ─── ZonePanel ────────────────────────────────────────────────────────────────

const ZonePanel = ({ zone, machines, allStates, getMachineState, maxGridCols }) => {
  const { language } = useLanguage();
  const { t } = useTranslation(language);

  const liveCnt = machines.filter((m) => allStates[m.id]?.mode === 'live').length;
  const baseCols = zoneCols(machines.length);
  const cols =
    maxGridCols != null ? Math.min(baseCols, maxGridCols) : baseCols;

  return (
    <div className="flex flex-col bg-gray-900/40 rounded-2xl border border-gray-700/30 p-2.5 min-h-0 min-w-0 overflow-hidden w-full">
      {/* Zone header */}
      <div className="flex items-center justify-between mb-2 flex-shrink-0 px-0.5">
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-bold text-gray-300 tracking-wide uppercase">{zone}</h2>
          <span className="text-[10px] text-gray-600">
            {machines.length}{t('production.dashboardMachinesSuffix')}
          </span>
        </div>
        {liveCnt > 0 && (
          <span className="flex items-center gap-1 text-[10px] font-bold text-green-400
                           bg-green-500/10 border border-green-500/20 px-2 py-0.5 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            {liveCnt} {t('production.dashboardStatusLive')}
          </span>
        )}
      </div>

      {/* Machine cards — fill all remaining space, no scroll */}
      <div
        className="flex-1 min-h-0 min-w-0"
        style={{
          display:               'grid',
          gridTemplateColumns:   `repeat(${cols}, minmax(0, 1fr))`,
          gridAutoRows:          '1fr',
          gap:                   '6px',
          overflow:              'hidden',
          minWidth:              0,
        }}
      >
        {machines.map((m) => (
          <MachineCard
            key={m.id}
            machine={m}
            state={getMachineState(m.id)}
          />
        ))}
      </div>
    </div>
  );
};

// ─── DashboardView ────────────────────────────────────────────────────────────

const DashboardView = ({ machines, allStates, getMachineState, lastSyncAt, onClose }) => {
  const { language } = useLanguage();
  const { t } = useTranslation(language);

  const now        = useClock();
  const UNZONED    = t('production.zoneUnspecified');
  const zoneGroups = useMemo(() => groupByZone(machines, UNZONED), [machines, UNZONED]);

  const liveCount   = Object.values(allStates).filter((s) => s?.mode === 'live').length;
  const activeCount = machines.filter((m) => m.status?.toLowerCase() !== 'unactive').length;

  // Dynamic zone layout — minmax(0,1fr) prevents grid blowout
  const zoneCnt = zoneGroups.length;
  const gridCols = zoneCnt <= 4
    ? `repeat(${zoneCnt}, minmax(0, 1fr))`
    : zoneCnt <= 6
    ? `repeat(3, minmax(0, 1fr))`
    : `repeat(4, minmax(0, 1fr))`;
  const gridRows = zoneCnt <= 4
    ? 'minmax(0, 1fr)'
    : zoneCnt <= 8
    ? 'repeat(2, minmax(0, 1fr))'
    : 'repeat(3, minmax(0, 1fr))';

  return (
    <div className="h-[100dvh] w-screen max-w-[100vw] bg-gray-950 text-white flex flex-col select-none" style={{ boxSizing: 'border-box' }}>

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <header className="flex-shrink-0 h-11 bg-gray-900/80 border-b border-gray-700/40
                         px-3 sm:px-5 flex items-center justify-between gap-2 backdrop-blur-sm">
        <div className="flex items-center gap-2 sm:gap-5 min-w-0">
          {/* Brand */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <svg className="w-4 h-4 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
            </svg>
            <span className="text-sm font-bold tracking-tight text-white hidden sm:block">{t('production.dashboardTitle')}</span>
            <span className="text-sm font-bold tracking-tight text-white sm:hidden">{t('production.dashboardTitleShort')}</span>
          </div>

          {/* Stats pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none">
            <span className="flex-shrink-0 flex items-center gap-1.5 text-xs bg-green-500/10 border border-green-500/20
                             text-green-300 font-semibold px-2 py-0.5 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              {liveCount}
              <span className="hidden sm:inline">{t('production.dashboardProducing')}</span>
            </span>
            <span className="flex-shrink-0 text-xs text-gray-500 bg-gray-800/60 border border-gray-700/40
                             px-2 py-0.5 rounded-full">
              {activeCount}/{machines.length}
              <span className="hidden sm:inline">{t('production.dashboardMachinesSuffix')}</span>
            </span>
          </div>
        </div>

        {/* Right: clock + close */}
        <div className="flex items-center gap-2 sm:gap-4 flex-shrink-0">
          {lastSyncAt && (
            <span className="text-[11px] text-gray-600 hidden lg:block">
              {t('production.dashboardSyncPrefix')}{lastSyncAt.toLocaleTimeString('th-TH')}
            </span>
          )}
          {/* Live clock */}
          <div className="flex items-center gap-1.5 bg-gray-800/60 border border-gray-700/40
                          rounded-lg px-2 sm:px-3 py-1">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse flex-shrink-0" />
            <span className="font-mono text-xs sm:text-sm font-bold text-cyan-300 tabular-nums">
              {now.toLocaleTimeString('th-TH')}
            </span>
          </div>
          {/* Back button */}
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-200
                       border border-gray-700/50 hover:border-gray-500 px-2.5 sm:px-3 py-1.5 rounded-lg
                       transition-all"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            {t('production.dashboardExit')}
          </button>
        </div>
      </header>

      {/* ── Zone grid ─────────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-y-auto md:overflow-hidden p-2 sm:p-3">
        {/* Mobile: single-column stack */}
        <div className="flex flex-col gap-3 md:hidden">
          {zoneGroups.map(({ zone, machines: zm }) => (
            <ZonePanel
              key={zone}
              zone={zone}
              machines={zm}
              allStates={allStates}
              getMachineState={getMachineState}
              maxGridCols={2}
            />
          ))}
        </div>
        {/* Desktop: CSS grid wallboard */}
        <div
          className="hidden md:grid h-full"
          style={{
            gridTemplateColumns: gridCols,
            gridTemplateRows:    gridRows,
            gap:                 '10px',
            overflow:            'hidden',
            width:               '100%',
            boxSizing:           'border-box',
          }}
        >
          {zoneGroups.map(({ zone, machines: zm }) => (
            <ZonePanel
              key={zone}
              zone={zone}
              machines={zm}
              allStates={allStates}
              getMachineState={getMachineState}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export default DashboardView;
