import React from 'react';
import { useLanguage } from '../../../contexts/LanguageContext';
import { useTranslation } from '../../../utils/translations';

/**
 * ปุ่มออกจากหน้าจอย่อย (LED / แดชบอร์ด / แผน / ตาราง / ประวัติ) หรือกลับไปรายการเครื่องบนมือถือ
 * @param {{ onClick: () => void, className?: string, size?: 'sm' | 'md' }} props
 */
const ProductionViewExitButton = ({ onClick, className = '', size = 'md' }) => {
  const { language } = useLanguage();
  const { t } = useTranslation(language);

  const sizeCls =
    size === 'sm'
      ? 'gap-1 px-2 py-1 text-[10px] xs:text-xs'
      : 'gap-1.5 px-2.5 py-1.5 text-xs sm:px-3';

  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'inline-flex shrink-0 items-center justify-center rounded-lg border font-semibold transition-all',
        'border-gray-600/80 bg-gray-800/80 text-gray-300',
        'hover:border-gray-500 hover:bg-gray-800 hover:text-white',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-cyan-500/60',
        sizeCls,
        className,
      ].join(' ')}
      aria-label={t('production.exitViewAria')}
    >
      <svg className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
      </svg>
      <span>{t('production.exitView')}</span>
    </button>
  );
};

export default ProductionViewExitButton;
