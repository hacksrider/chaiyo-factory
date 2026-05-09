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

const MachineSidebar = ({ machines, selectedMachineId, onSelectMachine, allStates, loading, onClose, ledChangedMachineIds }) => {
  const { language } = useLanguage();
  const { t } = useTranslation(language);

  const UNZONED = t('production.zoneUnspecified');

  const liveCount = machines.filter(
    (m) => (allStates[m.id] ?? DEFAULT_MACHINE_STATE).mode === 'live',
  ).length;

  const zoneGroups = groupByZone(machines, UNZONED);

  return (
    <aside className="w-72 sm:w-64 flex-shrink-0 bg-gray-900 border-r border-gray-700/50 flex flex-col overflow-hidden h-full">
      {/* Sidebar header */}
      <div className="px-4 py-4 border-b border-gray-700/50">
        <div className="flex items-center gap-2 mb-1">
          <span
            className={`w-2 h-2 rounded-full flex-shrink-0 ${
              loading ? 'bg-gray-600' : 'bg-cyan-400 animate-pulse'
            }`}
          />
          <span className="text-xs font-semibold text-cyan-400 tracking-widest uppercase flex-1">
            {t('production.sidebarHdpeLines')}
          </span>
          {/* Close button — mobile drawer only */}
          {onClose && (
            <button
              onClick={onClose}
              className="md:hidden -mr-1 p-1 rounded text-gray-500 hover:text-white hover:bg-gray-700 transition-colors"
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
          ) : (
            t('production.sidebarLinesActive', { live: liveCount, total: machines.length })
          )}
        </p>
      </div>

      {/* Machine list */}
      <div className="flex-1 overflow-y-auto py-1">
        {loading ? (
          Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)
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
