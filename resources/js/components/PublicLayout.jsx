import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useTranslation } from '../utils/translations';
import LanguageSwitcher from './LanguageSwitcher';
import AdminLayout from './AdminLayout';
import AiGemsNavSection from './AiGemsNavSection';
import UserMenuDropdown from './UserMenuDropdown';
import MaintenanceNavSuite from '../features/maintenance-requests/MaintenanceNavSuite';

const PublicLayout = ({ children }) => {
    const navigate = useNavigate();
    const location = useLocation();
    const { isAdmin, user, logout } = useAuth();
    const { language } = useLanguage();
    const { t } = useTranslation(language);
    const [mobileNavOpen, setMobileNavOpen] = useState(false);

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
                                onClick={() => navigate('/admin/problems')}
                                className="rounded-lg bg-indigo-50 px-2.5 py-1.5 text-left text-xs font-medium text-indigo-900 transition hover:bg-indigo-100 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-offset-1 lg:px-3 lg:text-sm"
                            >
                                {t('admin.manageProblems')}
                            </button>
                            <button
                                type="button"
                                onClick={() => navigate('/admin/machines')}
                                className="rounded-lg bg-emerald-50 px-2.5 py-1.5 text-left text-xs font-medium text-emerald-900 transition hover:bg-emerald-100 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-1 lg:px-3 lg:text-sm"
                            >
                                {t('admin.manageMachines')}
                            </button>
                            <button
                                type="button"
                                onClick={() => navigate('/admin/categories')}
                                className="rounded-lg bg-violet-50 px-2.5 py-1.5 text-left text-xs font-medium text-violet-900 transition hover:bg-violet-100 focus:outline-none focus:ring-2 focus:ring-violet-400 focus:ring-offset-1 lg:px-3 lg:text-sm"
                            >
                                {t('admin.manageCategories')}
                            </button>
                        </nav>
                        <div className="flex flex-shrink-0 items-center gap-2 sm:gap-3">
                            <MaintenanceNavSuite />
                            <LanguageSwitcher />
                            <UserMenuDropdown
                                userName={user?.name || user?.username || '—'}
                                logoutLabel={t('nav.logout')}
                                onLogout={handleLogout}
                            />
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
                                            navigate('/admin/problems');
                                            setMobileNavOpen(false);
                                        }}
                                        className="rounded-lg bg-indigo-50 px-4 py-3 text-left text-sm font-medium text-indigo-900"
                                    >
                                        {t('admin.manageProblems')}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            navigate('/admin/machines');
                                            setMobileNavOpen(false);
                                        }}
                                        className="rounded-lg bg-emerald-50 px-4 py-3 text-left text-sm font-medium text-emerald-900"
                                    >
                                        {t('admin.manageMachines')}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            navigate('/admin/categories');
                                            setMobileNavOpen(false);
                                        }}
                                        className="rounded-lg bg-violet-50 px-4 py-3 text-left text-sm font-medium text-violet-900"
                                    >
                                        {t('admin.manageCategories')}
                                    </button>
                                    <AiGemsNavSection onAfterAction={() => setMobileNavOpen(false)} />
                            </div>
                        </nav>
                    </div>
                </div>
            )}

            <main className="min-h-0 w-full min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
                {children}
            </main>
        </div>
    );
};

export default PublicLayout;
