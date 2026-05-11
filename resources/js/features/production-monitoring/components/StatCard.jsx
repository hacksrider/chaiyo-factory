import React from 'react';

const ACCENT = {
  cyan: {
    border: 'border-cyan-500/30',
    bg: 'bg-cyan-500/5',
    label: 'text-cyan-500',
    value: 'text-cyan-200',
  },
  green: {
    border: 'border-green-500/30',
    bg: 'bg-green-500/5',
    label: 'text-green-500',
    value: 'text-green-200',
  },
  amber: {
    border: 'border-amber-500/30',
    bg: 'bg-amber-500/5',
    label: 'text-amber-500',
    value: 'text-amber-200',
  },
  purple: {
    border: 'border-purple-500/30',
    bg: 'bg-purple-500/5',
    label: 'text-purple-500',
    value: 'text-purple-200',
  },
  red: {
    border: 'border-red-500/30',
    bg: 'bg-red-500/5',
    label: 'text-red-500',
    value: 'text-red-200',
  },
};

/**
 * @param {{
 *   label: string,
 *   value: string | number | null,
 *   unit?: string,
 *   accent?: 'cyan' | 'green' | 'amber' | 'purple',
 *   subtext?: string,
 *   numeric?: boolean,   // true = large monospace display
 * }} props
 */
const StatCard = ({ label, value, unit, accent = 'cyan', subtext, numeric = true }) => {
  const colors = ACCENT[accent] ?? ACCENT.cyan;

  return (
    <div className={`rounded-xl border ${colors.border} ${colors.bg} p-3 sm:p-4`}>
      <p className={`text-[10px] sm:text-[11px] font-semibold tracking-widest uppercase ${colors.label} mb-2 sm:mb-3`}>
        {label}
      </p>

      <div className="flex min-h-[1.75rem] items-end gap-1.5 sm:gap-2 sm:min-h-[2rem]">
        <span
          className={[
            'font-bold leading-none break-all',
            numeric
              ? `font-mono text-2xl sm:text-3xl lg:text-4xl ${colors.value}`
              : `text-xl sm:text-2xl lg:text-4xl ${colors.value}`,
          ].join(' ')}
        >
          {value !== null && value !== undefined && value !== '' ? value : '—'}
        </span>
        {unit && (
          <span className="mb-0.5 flex-shrink-0 font-mono text-sm text-gray-400 sm:text-lg">{unit}</span>
        )}
      </div>

      {subtext && (
        <p className="mt-1.5 text-sm leading-snug text-gray-500 sm:mt-2 sm:text-base lg:text-lg">{subtext}</p>
      )}
    </div>
  );
};

export default StatCard;
