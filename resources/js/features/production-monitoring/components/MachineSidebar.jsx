import React from 'react';
import { useLanguage } from '../../../contexts/LanguageContext';
import { useTranslation } from '../../../utils/translations';
import { DEFAULT_MACHINE_STATE } from '../hooks/useProductionStates';

const SkeletonRow = () => (
  <div className="px-4 py-3 flex items-center gap-3 border-l-2 border-transparent">
    <span className="w-2.5 h-2.5 rounded-full bg-gray-700 flex-shrink-0 animate-pulse" />
    <div className="flex-1 space-y-1.5">
      <div className="h-3 w-24 bg-gray-700 rounded animate-pulse" />
      <div className="h-2 w-16 bg-gray-800 rounded animate-pulse" />
    </div>
  </div>
);

/** Group an array of machines by their zone field. */
const groupByZone = (machines, unzoned) => {
  const map = {};
  machines.forEach((m) => {
    const key = m.zone?.trim() || unzoned;
    if (!map[key]) map[key] = [];
    map[key].push(m);
  });

  const sorted = Object.keys(map).sort((a, b) => {
    if (a === unzoned) return 1;
    if (b === unzoned) return -1;
    return a.localeCompare(b, 'th');
  });

  return sorted.map((zone) => ({ zone, machines: map[zone] }));
};

const MachineSidebar = ({
  machines,
  selectedMachineId,
  onSelectMachine,
  allStates,
  loading,
  syncing = false,
  onSync,
  lastSyncAt,
  syncError,
  onClose,
  ledChangedMachineIds,
}) => {
  const { language } = useLanguage();
  const { t } = useTranslation(language);

  const UNZONED = t('production.zoneUnspecified');
  const isSyncBusy = loading || syncing;

  const liveCount = machines.filter(
    (m) => (allStates[m.id] ?? DEFAULT_MACHINE_STATE).mode === 'live',
  ).length;

  const zoneGroups = groupByZone(machines, UNZONED);

  return (
    <aside className="flex h-full w-[min(100%,20rem)] shrink-0 flex-col overflow-hidden border-r border-gray-700/50 bg-gray-900 shadow-2xl pb-[env(safe-area-inset-bottom)] md:w-64 md:max-w-none md:pb-0 md:shadow-none lg:w-72">
      {/* Sidebar header */}
      <div className="px-4 py-4 border-b border-gray-700/50">
        <div className="flex items-center gap-2 mb-1">
          <span
            className={`w-2 h-2 rounded-full flex-shrink-0 ${
              loading ? 'bg-gray-600' : 'bg-cyan-400 animate-pulse'
            }`}
          />
          <span className="text-xs font-semibold text-cyan-400 tracking-widest uppercase flex-1 min-w-0 truncate">
            {t('production.sidebarHdpeLines')}
          </span>
          {onSync && (
            <button
              type="button"
              onClick={onSync}
              disabled={isSyncBusy}
              title={t('production.titleRefetchMachines')}
              aria-label={t('production.titleRefetchMachines')}
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-gray-600/80 bg-gray-800/80 text-gray-400 transition hover:border-cyan-500/50 hover:bg-gray-800 hover:text-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <svg
                className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
            </button>
          )}
          {/* Close button — mobile drawer only */}
          {onClose && (
            <button
              onClick={onClose}
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-700 hover:text-white md:hidden"
              aria-label={t('production.ariaCloseSidebar')}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
        <p className="text-xs text-gray-500">
          {loading ? (
            <span className="text-gray-600">{t('production.sidebarFetchingSettings')}</span>
          ) : syncing ? (
            <span className="text-cyan-500/90">{t('production.syncing')}</span>
          ) : (
            t('production.sidebarLinesActive', { live: liveCount, total: machines.length })
          )}
        </p>
        {lastSyncAt && !loading && !syncing && (
          <p className="mt-1 text-[10px] text-gray-600 tabular-nums">
            {t('production.syncedAt')}{' '}
            {lastSyncAt.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}
          </p>
        )}
        {syncError && !loading && (
          <p className="mt-1.5 text-[10px] text-amber-400/90 leading-snug" title={syncError}>
            {syncError}
          </p>
        )}
      </div>

      {/* Machine list */}
      <div className="flex-1 overflow-y-auto py-1">
        {loading ? (
          Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)
        ) : machines.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-xs text-gray-500 mb-3">{t('production.noMachinesFound')}</p>
            {onSync && (
              <button
                type="button"
                onClick={onSync}
                disabled={isSyncBusy}
                className="inline-flex items-center gap-2 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 py-2 text-xs font-semibold text-cyan-300 transition hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <svg
                  className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
                {syncing ? t('production.syncing') : t('production.sync')}
              </button>
            )}
          </div>
        ) : (
          zoneGroups.map(({ zone, machines: zoneMachines }) => (
            <div key={zone}>
              {/* Zone header */}
              <div className="flex items-center gap-2 px-4 pt-3 pb-1.5">
                <svg className="w-3 h-3 text-gray-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span className="text-[10px] font-bold tracking-widest text-gray-500 uppercase truncate">
                  {zone}
                </span>
                <span className="ml-auto text-[10px] text-gray-700 flex-shrink-0">
                  {zoneMachines.length}
                </span>
              </div>

              {/* Machines in zone */}
              {zoneMachines.map((machine) => {
                const state        = allStates[machine.id] ?? DEFAULT_MACHINE_STATE;
                const isLive       = state.mode === 'live';
                const isSelected   = machine.id === selectedMachineId;
                const isActive     = machine.status?.toLowerCase() !== 'unactive';
                const ledChanged   = ledChangedMachineIds?.has(machine.id) ?? false;
                const displayTarget =
                  (state.remainingQty > 0) ? state.remainingQty : state.targetQty;
                const progress   =
                  displayTarget > 0
                    ? Math.min(100, Math.round((state.pipeCounter / displayTarget) * 100))
                    : 0;

                return (
                  <button
                    key={machine.id}
                    onClick={() => onSelectMachine(machine.id)}
                    className={[
                      'w-full text-left px-4 py-3 flex items-center gap-3 transition-all border-l-2',
                      !isActive ? 'opacity-50' : '',
                      isSelected
                        ? 'bg-cyan-500/10 border-cyan-400 text-white'
                        : 'border-transparent text-gray-400 hover:bg-gray-800/60 hover:text-gray-200',
                    ].join(' ')}
                  >
                    {/* Live indicator dot */}
                    <div className="relative flex-shrink-0">
                      <span
                        className={`block w-2.5 h-2.5 rounded-full ${
                          !isActive ? 'bg-gray-700' : isLive ? 'bg-green-400' : 'bg-gray-600'
                        }`}
                      />
                      {isLive && isActive && (
                        <span className="absolute inset-0 w-2.5 h-2.5 rounded-full bg-green-400 animate-ping opacity-60" />
                      )}
                    </div>

                    {/* Machine info */}
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium leading-none ${isSelected ? 'text-white' : ''}`}>
                        {machine.label}
                      </p>
                      <p className="text-[11px] text-gray-600 mt-0.5 truncate">
                        {!isActive
                          ? t('production.inactiveStatus')
                          : isLive && state.orderId
                            ? state.orderId
                            : t('production.sidebarIdle')}
                      </p>

                      {/* Mini progress bar */}
                      {isLive && isActive && displayTarget > 0 && (
                        <div className="mt-1.5 h-1 w-full bg-gray-700 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-green-400/70 transition-all duration-500"
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                      )}
                    </div>

                    {/* Status / LIVE badge + LED changed indicator */}
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      {!isActive ? (
                        <span className="text-[9px] font-bold leading-none text-gray-500 bg-gray-700/60 border border-gray-600/40 px-1.5 py-1 rounded">
                          {t('production.sidebarOff')}
                        </span>
                      ) : isLive ? (
                        <span className="text-[9px] font-bold leading-none text-green-400 bg-green-400/10 border border-green-400/20 px-1.5 py-1 rounded">
                          {t('production.dashboardStatusLive')}
                        </span>
                      ) : null}
                      {ledChanged && (
                        <span
                          title="ป้ายไฟถูกเปลี่ยนจากอุปกรณ์อื่น"
                          className="text-[9px] font-bold leading-none text-amber-400 bg-amber-400/10 border border-amber-400/25 px-1.5 py-0.5 rounded"
                        >
                          LED
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          ))
        )}
      </div>
    </aside>
  );
};

export default MachineSidebar;
