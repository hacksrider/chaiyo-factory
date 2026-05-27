import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useTranslation } from '../utils/translations';
import LanguageSwitcher from './LanguageSwitcher';
import AiGemsNavSection from './AiGemsNavSection';
import UserMenuDropdown from './UserMenuDropdown';
import MaintenanceNavSuite from '../features/maintenance-requests/MaintenanceNavSuite';

const AdminLayout = ({ children }) => {
    const navigate = useNavigate();
    const location = useLocation();
    const { user, logout } = useAuth();
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

    const isActive = (path) => {
        if (path === '/') {
            return location.pathname === '/' ? 'bg-blue-600 text-white' : 'text-gray-700 hover:bg-gray-100';
        }
        return location.pathname === path || location.pathname.startsWith(path + '/')
            ? 'bg-blue-600 text-white'
            : 'text-gray-700 hover:bg-gray-100';
    };

    return (
        <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-gray-50">
            <nav className="z-30 flex-shrink-0 border-b bg-white shadow-sm">
                <div className="mx-auto w-full px-3 sm:px-4 lg:px-6">
                    <div className="flex h-14 items-center justify-between gap-2 sm:h-16">
                        <div className="flex min-w-0 flex-1 items-center gap-2 lg:gap-4">
                            <button
                                type="button"
                                aria-label={t('nav.menuOpen')}
                                aria-expanded={mobileNavOpen}
                                className="inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 xl:hidden"
                                onClick={() => setMobileNavOpen(true)}
                            >
                                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                                </svg>
                            </button>
                            <h1
                                onClick={() => navigate('/')}
                                className="cursor-pointer truncate text-lg font-bold text-blue-600 transition hover:text-blue-800 sm:text-xl"
                            >
                                {t('landing.title')}
                            </h1>
                        </div>
                        <div className="flex flex-shrink-0 items-center gap-2 sm:gap-4">
                            <div className="hidden flex-wrap gap-2 xl:flex">

                                <button
                                    type="button"
                                    onClick={() => navigate('/admin/problems')}
                                    className={`rounded-lg px-2 py-2 transition focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 ${isActive('/admin/problems')}`}
                                >
                                    {t('admin.manageProblems')}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => navigate('/admin/machines')}
                                    className={`rounded-lg px-2 py-2 transition focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 ${isActive('/admin/machines')}`}
                                >
                                    {t('admin.manageMachines')}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => navigate('/admin/categories')}
                                    className={`rounded-lg px-2 py-2 transition focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 ${isActive('/admin/categories')}`}
                                >
                                    {t('admin.manageCategories')}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => navigate('/admin/users')}
                                    className={`rounded-lg px-2 py-2 transition focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 ${isActive('/admin/users')}`}
                                >
                                    {t('admin.manageUsers')}
                                </button>
                                {/* <button
                                    onClick={() => navigate('/admin/page-contents')}
                                    className={`px-2 py-2 rounded-lg transition ${isActive('/admin/page-contents')}`}
                                >
                                    {t('admin.manageContent')}
                                </button> */}
                            </div>
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
                {mobileNavOpen && (
                    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true">
                        <button
                            type="button"
                            className="absolute inset-0 bg-black/40"
                            aria-label={t('common.close')}
                            onClick={() => setMobileNavOpen(false)}
                        />
                        <div className="absolute inset-y-0 right-0 flex w-[min(100%,22rem)] flex-col bg-white shadow-xl sm:w-[min(100%,24rem)]">
                            <div className="flex items-center justify-between border-b px-4 py-3">
                                <span className="font-semibold text-gray-900">{t('landing.title')}</span>
                                <button
                                    type="button"
                                    className="flex h-10 w-10 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100"
                                    aria-label={t('common.close')}
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
                                        className="rounded-lg bg-blue-50 px-4 py-3 text-left text-sm font-medium text-blue-800"
                                    >
                                        {t('nav.problems')}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            navigate('/machines');
                                            setMobileNavOpen(false);
                                        }}
                                        className="rounded-lg bg-green-50 px-4 py-3 text-left text-sm font-medium text-green-800"
                                    >
                                        {t('nav.machines')}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            navigate('/production-monitoring');
                                            setMobileNavOpen(false);
                                        }}
                                        className="rounded-lg bg-orange-50 px-4 py-3 text-left text-sm font-medium text-orange-900"
                                    >
                                        {t('nav.production')}
                                    </button>
                                    <AiGemsNavSection onAfterAction={() => setMobileNavOpen(false)} />
                                </div>
                                <div className="mt-3 flex flex-col gap-2">
                                    <p className="px-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Admin</p>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            navigate('/admin/problems');
                                            setMobileNavOpen(false);
                                        }}
                                        className={`rounded-lg px-4 py-3 text-left text-sm ${isActive('/admin/problems')}`}
                                    >
                                        {t('admin.manageProblems')}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            navigate('/admin/machines');
                                            setMobileNavOpen(false);
                                        }}
                                        className={`rounded-lg px-4 py-3 text-left text-sm ${isActive('/admin/machines')}`}
                                    >
                                        {t('admin.manageMachines')}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            navigate('/admin/categories');
                                            setMobileNavOpen(false);
                                        }}
                                        className={`rounded-lg px-4 py-3 text-left text-sm ${isActive('/admin/categories')}`}
                                    >
                                        {t('admin.manageCategories')}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            navigate('/admin/users');
                                            setMobileNavOpen(false);
                                        }}
                                        className={`rounded-lg px-4 py-3 text-left text-sm ${isActive('/admin/users')}`}
                                    >
                                        {t('admin.manageUsers')}
                                    </button>
                                </div>
                            </nav>
                        </div>
                    </div>
                )}
            </nav>

            {/* Page Content */}
            <main className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-y-auto overflow-x-hidden">
                <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col">{children}</div>
            </main>

        </div>
    );
};

export default AdminLayout;

