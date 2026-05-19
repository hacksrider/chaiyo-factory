import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useTranslation } from '../utils/translations';
import LanguageSwitcher from './LanguageSwitcher';
import AdminLayout from './AdminLayout';
import { publicAPI } from '../api';
import MaintenanceNavSuite from '../features/maintenance-requests/MaintenanceNavSuite';

const PublicLayout = ({ children }) => {
    const navigate = useNavigate();
    const location = useLocation();
    const { isAdmin, user, logout } = useAuth();
    const { language } = useLanguage();
    const { t } = useTranslation(language);
    const [mobileNavOpen, setMobileNavOpen] = useState(false);
    const [aiGems, setAiGems] = useState([]);
    const [loadingAiGems, setLoadingAiGems] = useState(false);

    const sortedActiveGems = useMemo(() => {
        return [...aiGems]
            .filter((gem) => gem.is_active)
            .sort((a, b) => {
                const orderA = a.order ?? 999;
                const orderB = b.order ?? 999;
                if (orderA !== orderB) return orderA - orderB;
                return (a.name || '').localeCompare(b.name || '');
            });
    }, [aiGems]);

    useEffect(() => {
        fetchAiGems();
    }, []);

    useEffect(() => {
        setMobileNavOpen(false);
    }, [location.pathname]);

    useEffect(() => {
        if (!mobileNavOpen) return;
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = prev;
        };
    }, [mobileNavOpen]);

    const fetchAiGems = async () => {
        try {
            setLoadingAiGems(true);
            const response = await publicAPI.getAiGems();
            setAiGems(response.data);
        } catch (error) {
            console.error('Error fetching AI Gems:', error);
        } finally {
            setLoadingAiGems(false);
        }
    };

    const openGem = (url) => {
        window.open(url, '_blank');
        setMobileNavOpen(false);
    };

    const handleLogout = async () => {
        await logout();
        navigate('/admin/login');
    };

    // If admin is logged in, use AdminLayout
    if (isAdmin) {
        return <AdminLayout>{children}</AdminLayout>;
    }

    // Otherwise use simple public layout
    return (
        <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-gray-50">
            <header className="z-30 flex-shrink-0 bg-white shadow-sm">
                <div className="mx-auto w-full px-3 py-3 sm:px-4 lg:px-6">
                    <div className="flex w-full items-center gap-2">
                        <div className="flex min-w-0 flex-1 items-center gap-2 lg:gap-4">
                            <button
                                type="button"
                                aria-label={t('nav.menuOpen')}
                                aria-expanded={mobileNavOpen}
                                className="inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 md:hidden"
                                onClick={() => setMobileNavOpen(true)}
                            >
                                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                                </svg>
                            </button>
                            <h1
                                onClick={() => navigate('/')}
                                className="min-w-0 shrink cursor-pointer truncate text-lg font-bold text-blue-600 transition hover:text-blue-800 sm:text-xl lg:text-2xl"
                            >
                                {t('landing.title')}
                            </h1>
                        </div>
                        <nav
                            className="hidden shrink-0 flex-wrap items-center gap-1.5 md:flex lg:gap-2"
                            role="navigation"
                            aria-label={t('nav.home')}
                        >
                            <button
                                type="button"
                                onClick={() => navigate('/problems')}
                                className="rounded-lg bg-blue-50 px-2.5 py-1.5 text-left text-xs font-medium text-blue-800 transition hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-1 lg:px-3 lg:text-sm"
                            >
                                {t('nav.problems')}
                            </button>
                            <button
                                type="button"
                                onClick={() => navigate('/machines')}
                                className="rounded-lg bg-green-50 px-2.5 py-1.5 text-left text-xs font-medium text-green-800 transition hover:bg-green-100 focus:outline-none focus:ring-2 focus:ring-green-400 focus:ring-offset-1 lg:px-3 lg:text-sm"
                            >
                                {t('nav.machines')}
                            </button>
                            <button
                                type="button"
                                onClick={() => navigate('/production-monitoring')}
                                className="rounded-lg bg-cyan-50 px-2.5 py-1.5 text-left text-xs font-medium text-cyan-900 transition hover:bg-cyan-100 focus:outline-none focus:ring-2 focus:ring-cyan-400 focus:ring-offset-1 lg:px-3 lg:text-sm"
                            >
                                {t('nav.production')}
                            </button>
                        </nav>
                        <div className="flex flex-shrink-0 items-center gap-2 sm:gap-3">
                            <MaintenanceNavSuite />
                            <LanguageSwitcher />
                            <div className="relative group">
                                <button
                                    type="button"
                                    className="flex max-w-[9rem] items-center gap-1 rounded px-2 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 sm:max-w-xs sm:px-3"
                                    aria-haspopup="menu"
                                >
                                    <span className="truncate">{user?.name || user?.username || '—'}</span>
                                    <svg className="ml-1 h-4 w-4 flex-shrink-0 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                    </svg>
                                </button>
                                <div className="pointer-events-none absolute right-0 top-full z-50 mt-2 min-w-[150px] rounded-md border border-gray-200 bg-white opacity-0 shadow-lg transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
                                    <button
                                        type="button"
                                        onClick={handleLogout}
                                        className="w-full rounded-md px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                                    >
                                        {t('nav.logout')}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </header>

            {mobileNavOpen && (
                <div className="fixed inset-0 z-40" role="dialog" aria-modal="true">
                    <button
                        type="button"
                        className="absolute inset-0 bg-black/40"
                        aria-label="Close menu"
                        onClick={() => setMobileNavOpen(false)}
                    />
                    <div className="absolute inset-y-0 left-0 flex w-[min(100%,22rem)] flex-col bg-white shadow-xl sm:w-[min(100%,24rem)]">
                        <div className="flex items-center justify-between border-b px-4 py-3">
                            <span className="font-semibold text-gray-900">{t('landing.title')}</span>
                            <button
                                type="button"
                                className="flex h-10 w-10 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100"
                                aria-label="Close"
                                onClick={() => setMobileNavOpen(false)}
                            >
                                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                        <nav className="flex-1 overflow-y-auto p-3">
                            <div className="flex flex-col gap-2">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            navigate('/problems');
                                            setMobileNavOpen(false);
                                        }}
                                        className="rounded-lg bg-blue-50 px-4 py-3 text-left text-sm font-medium text-blue-700"
                                    >
                                        {t('nav.problems')}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            navigate('/machines');
                                            setMobileNavOpen(false);
                                        }}
                                        className="rounded-lg bg-green-50 px-4 py-3 text-left text-sm font-medium text-green-700"
                                    >
                                        {t('nav.machines')}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            navigate('/production-monitoring');
                                            setMobileNavOpen(false);
                                        }}
                                        className="rounded-lg bg-cyan-50 px-4 py-3 text-left text-sm font-medium text-cyan-800"
                                    >
                                        {t('nav.production')}
                                    </button>
                                    <p className="px-1 pt-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{t('nav.askAI')}</p>
                                    {loadingAiGems ? (
                                        <div className="px-2 py-2 text-sm text-gray-500">{t('common.loading')}</div>
                                    ) : sortedActiveGems.length > 0 ? (
                                        sortedActiveGems.map((gem) => (
                                            <button
                                                key={gem.id}
                                                type="button"
                                                onClick={() => openGem(gem.gem_url)}
                                                className="rounded-lg px-4 py-2.5 text-left text-sm text-purple-700 hover:bg-purple-50"
                                            >
                                                {gem.name}
                                            </button>
                                        ))
                                    ) : (
                                        <div className="px-2 py-2 text-sm text-gray-500">{t('admin.noAiGems')}</div>
                                    )}
                            </div>
                        </nav>
                    </div>
                </div>
            )}

            <main className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-y-auto overflow-x-hidden">
                <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col">{children}</div>
            </main>
        </div>
    );
};

export default PublicLayout;
