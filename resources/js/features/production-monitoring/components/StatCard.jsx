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
 *   accent?: 'cyan' | 'green' | 'amber' | 'purple' | 'red',
 *   subtext?: string,
 *   numeric?: boolean,
 *   compact?: boolean,
 * }} props
 */
const StatCard = ({
  label,
  value,
  unit,
  accent = 'cyan',
  subtext,
  numeric = true,
  compact = false,
}) => {
  const colors = ACCENT[accent] ?? ACCENT.cyan;

  const pad = compact ? 'p-2 sm:p-3 lg:p-4' : 'p-3 sm:p-4 lg:p-5';
  const labelCls = compact
    ? 'text-[9px] sm:text-[10px] mb-1 sm:mb-1.5'
    : 'text-[10px] sm:text-[11px] mb-2 sm:mb-3';
  const valueCls = numeric
    ? compact
      ? `font-mono text-lg xs:text-xl sm:text-2xl lg:text-3xl 3xl:text-4xl tv:text-5xl ${colors.value}`
      : `font-mono text-2xl sm:text-3xl lg:text-4xl 3xl:text-5xl ${colors.value}`
    : compact
      ? `text-base xs:text-lg sm:text-xl lg:text-2xl 3xl:text-3xl ${colors.value}`
      : `text-xl sm:text-2xl lg:text-4xl 3xl:text-5xl ${colors.value}`;
  const unitCls = compact
    ? 'text-xs sm:text-sm lg:text-base'
    : 'text-sm sm:text-lg lg:text-xl';
  const subCls = compact
    ? 'mt-1 text-[11px] leading-snug sm:text-xs lg:text-sm'
    : 'mt-1.5 text-sm leading-snug sm:mt-2 sm:text-base lg:text-lg';

  return (
    <div className={`h-full rounded-xl border ${colors.border} ${colors.bg} ${pad}`}>
      <p className={`font-semibold uppercase tracking-widest ${labelCls} ${colors.label}`}>
        {label}
      </p>

      <div className={`flex items-end gap-1 ${compact ? 'min-h-[1.25rem] sm:min-h-[1.5rem]' : 'min-h-[1.75rem] sm:min-h-[2rem]'}`}>
        <span className={`font-bold leading-none break-all ${valueCls}`}>
          {value !== null && value !== undefined && value !== '' ? value : '—'}
        </span>
        {unit && (
          <span className={`mb-0.5 flex-shrink-0 font-mono text-gray-400 ${unitCls}`}>{unit}</span>
        )}
      </div>

      {subtext && (
        <p className={`text-gray-500 ${subCls}`}>{subtext}</p>
      )}
    </div>
  );
};

export default StatCard;
