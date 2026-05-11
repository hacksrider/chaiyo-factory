import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useTranslation } from '../utils/translations';
import LanguageSwitcher from './LanguageSwitcher';
import AdminLayout from './AdminLayout';
import { publicAPI } from '../api';

const PublicLayout = ({ children }) => {
    const navigate = useNavigate();
    const location = useLocation();
    const { isAdmin } = useAuth();
    const { language } = useLanguage();
    const { t } = useTranslation(language);
    const [isAIDropdownOpen, setIsAIDropdownOpen] = useState(false);
    const [mobileNavOpen, setMobileNavOpen] = useState(false);
    const [aiGems, setAiGems] = useState([]);
    const [loadingAiGems, setLoadingAiGems] = useState(false);
    const aiDropdownRef = useRef(null);

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
        const handleClickOutside = (event) => {
            if (aiDropdownRef.current && !aiDropdownRef.current.contains(event.target)) {
                setIsAIDropdownOpen(false);
            }
        };

        if (isAIDropdownOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isAIDropdownOpen]);

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
        setIsAIDropdownOpen(false);
        setMobileNavOpen(false);
    };

    // If admin is logged in, use AdminLayout
    if (isAdmin) {
        return <AdminLayout>{children}</AdminLayout>;
    }

    // Otherwise use simple public layout
    return (
        <div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
            <header className="flex-shrink-0 bg-white shadow-sm z-30">
                <div className="mx-auto flex max-w-[1920px] items-center justify-between gap-2 px-3 py-3 sm:px-4 sm:py-4 lg:px-6">
                    <div className="flex min-w-0 flex-1 items-center gap-2 lg:gap-4">
                        <button
                            type="button"
                            aria-label="Menu"
                            className="inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 lg:hidden"
                            onClick={() => setMobileNavOpen(true)}
                        >
                            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                            </svg>
                        </button>
                        <h1
                            onClick={() => navigate('/')}
                            className="cursor-pointer truncate text-lg font-bold text-blue-600 transition hover:text-blue-800 sm:text-xl lg:text-2xl"
                        >
                            {t('landing.title')}
                        </h1>
                        <div className="hidden items-center gap-2 lg:flex">
                            <button
                                type="button"
                                onClick={() => navigate('/problems')}
                                className="rounded border border-blue-600 px-3 py-2 text-sm font-medium text-blue-600 hover:bg-blue-50"
                            >
                                {t('nav.problems')}
                            </button>
                            <button
                                type="button"
                                onClick={() => navigate('/machines')}
                                className="rounded border border-green-600 px-3 py-2 text-sm font-medium text-green-600 hover:bg-green-50"
                            >
                                {t('nav.machines')}
                            </button>
                            <div className="relative" ref={aiDropdownRef}>
                                <button
                                    type="button"
                                    onClick={() => setIsAIDropdownOpen(!isAIDropdownOpen)}
                                    className="flex items-center gap-1 rounded border border-purple-600 px-3 py-2 text-sm font-medium text-purple-600 transition hover:bg-purple-50"
                                >
                                    {t('nav.askAI')}
                                    <svg
                                        className={`h-4 w-4 transition-transform ${isAIDropdownOpen ? 'rotate-180' : ''}`}
                                        fill="none"
                                        stroke="currentColor"
                                        viewBox="0 0 24 24"
                                    >
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                    </svg>
                                </button>
                                {isAIDropdownOpen && (
                                    <div className="absolute left-0 top-full z-50 mt-1 max-h-[min(400px,70vh)] min-w-[200px] overflow-y-auto rounded-md border border-purple-200 bg-white shadow-lg">
                                        {loadingAiGems ? (
                                            <div className="px-4 py-3 text-center text-sm text-gray-500">{t('common.loading')}</div>
                                        ) : sortedActiveGems.length > 0 ? (
                                            sortedActiveGems.map((gem) => (
                                                <button
                                                    key={gem.id}
                                                    type="button"
                                                    onClick={() => openGem(gem.gem_url)}
                                                    className="w-full px-4 py-2.5 text-left text-sm text-purple-600 transition hover:bg-purple-50"
                                                >
                                                    {gem.name}
                                                </button>
                                            ))
                                        ) : (
                                            <div className="px-4 py-3 text-center text-sm text-gray-500">{t('admin.noAiGems')}</div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                    <div className="flex flex-shrink-0 items-center gap-2 sm:gap-3">
                        <LanguageSwitcher />
                        <button
                            type="button"
                            onClick={() => navigate('/admin/login')}
                            className="whitespace-nowrap px-2 py-2 text-sm font-medium text-blue-600 hover:text-blue-800 sm:px-4"
                        >
                            {t('nav.adminLogin')}
                        </button>
                    </div>
                </div>
            </header>

            {mobileNavOpen && (
                <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true">
                    <button
                        type="button"
                        className="absolute inset-0 bg-black/40"
                        aria-label="Close menu"
                        onClick={() => setMobileNavOpen(false)}
                    />
                    <div className="absolute inset-y-0 left-0 flex w-[min(100%,20rem)] flex-col bg-white shadow-xl">
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

            <main className="flex-1 overflow-y-auto min-h-0">{children}</main>
        </div>
    );
};

export default PublicLayout;
