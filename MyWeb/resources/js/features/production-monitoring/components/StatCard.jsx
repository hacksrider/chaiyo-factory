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
    <div className={`rounded-xl border ${colors.border} ${colors.bg} p-4`}>
      <p className={`text-[11px] font-semibold tracking-widest uppercase ${colors.label} mb-3`}>
        {label}
      </p>

      <div className="flex items-end gap-2 min-h-[2rem]">
        <span
          className={[
            'font-bold leading-none break-all',
            numeric
              ? `text-4xl font-mono ${colors.value}`
              : `text-4xl ${colors.value}`,
          ].join(' ')}
        >
          {value !== null && value !== undefined && value !== '' ? value : '—'}
        </span>
        {unit && (
          <span className="text-lg text-gray-400 font-mono mb-0.5 flex-shrink-0">{unit}</span>
        )}
      </div>

      {subtext && (
        <p className="text-lg text-gray-500 mt-2 leading-snug">{subtext}</p>
      )}
    </div>
  );
};

export default StatCard;
