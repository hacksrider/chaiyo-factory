import React, { useEffect, useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { useTranslation } from '../utils/translations';

const LayoutImageViewer = ({ src, alt, notFoundLabel }) => {
    const { language } = useLanguage();
    const { t } = useTranslation(language);
    const [expanded, setExpanded] = useState(false);
    const [loadError, setLoadError] = useState(false);

    useEffect(() => {
        if (!expanded) return;

        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';

        const handleEscape = (event) => {
            if (event.key === 'Escape') {
                setExpanded(false);
            }
        };

        document.addEventListener('keydown', handleEscape);

        return () => {
            document.body.style.overflow = prev;
            document.removeEventListener('keydown', handleEscape);
        };
    }, [expanded]);

    if (loadError) {
        return (
            <div className="rounded-lg bg-gray-100 py-12 text-center text-sm text-gray-500">
                {notFoundLabel || t('errors.notFound')}
            </div>
        );
    }

    return (
        <>
            <p className="mb-2 text-xs text-gray-500 md:hidden">
                {t('machines.layoutTapHint')}
            </p>
            <button
                type="button"
                onClick={() => setExpanded(true)}
                className="group relative w-full rounded-lg bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                aria-label={t('machines.layoutViewFull')}
            >
                <img
                    src={src}
                    alt={alt}
                    className="mx-auto block h-auto w-full max-w-full object-contain"
                    onError={() => setLoadError(true)}
                />
                <span className="pointer-events-none absolute bottom-2 right-2 rounded-md bg-black/55 px-2 py-1 text-xs text-white md:hidden">
                    {t('machines.layoutViewFull')}
                </span>
            </button>

            {expanded && (
                <div
                    className="fixed inset-0 z-50 flex flex-col bg-black/90"
                    role="dialog"
                    aria-modal="true"
                    aria-label={alt}
                >
                    <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-3 py-2.5 sm:px-4">
                        <p className="min-w-0 text-xs text-white/80 sm:text-sm">
                            {t('machines.layoutPinchHint')}
                        </p>
                        <button
                            type="button"
                            onClick={() => setExpanded(false)}
                            className="shrink-0 rounded-lg bg-white/10 px-3 py-1.5 text-sm font-medium text-white hover:bg-white/20"
                        >
                            {t('common.close')}
                        </button>
                    </div>
                    <div className="min-h-0 flex-1 overflow-auto overscroll-contain p-3 sm:p-4">
                        <img
                            src={src}
                            alt={alt}
                            className="mx-auto block h-auto w-auto max-w-none select-none"
                            draggable={false}
                        />
                    </div>
                </div>
            )}
        </>
    );
};

export default LayoutImageViewer;
