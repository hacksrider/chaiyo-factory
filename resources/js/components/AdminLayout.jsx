import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useTranslation } from '../utils/translations';
import LanguageSwitcher from './LanguageSwitcher';
import { adminAPI } from '../api';
import { useAlert } from '../contexts/AlertContext';

const AdminLayout = ({ children }) => {
    const navigate = useNavigate();
    const location = useLocation();
    const { user, logout } = useAuth();
    const { language } = useLanguage();
    const { t } = useTranslation(language);
    const { showSuccess, showError, showConfirm } = useAlert();
    const [isAIDropdownOpen, setIsAIDropdownOpen] = useState(false);
    const [aiGems, setAiGems] = useState([]);
    const [loadingAiGems, setLoadingAiGems] = useState(false);
    const [showAiModal, setShowAiModal] = useState(false);
    const [editingAiGem, setEditingAiGem] = useState(null);
    const [aiGemFormData, setAiGemFormData] = useState({
        name: '',
        gem_url: '',
        order: 0,
        is_active: true,
    });
    const aiDropdownRef = useRef(null);
    const [mobileNavOpen, setMobileNavOpen] = useState(false);

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

    const fetchAiGems = async () => {
        try {
            setLoadingAiGems(true);
            const response = await adminAPI.getAllAiGems();
            setAiGems(response.data);
        } catch (error) {
            console.error('Error fetching AI Gems:', error);
            showError('ไม่สามารถโหลดข้อมูล AI Gems ได้');
        } finally {
            setLoadingAiGems(false);
        }
    };

    const handleOpenAiModal = (aiGem = null) => {
        if (aiGem) {
            setEditingAiGem(aiGem);
            setAiGemFormData({
                name: aiGem.name || '',
                gem_url: aiGem.gem_url || '',
                order: aiGem.order || 1,
                is_active: aiGem.is_active !== undefined ? aiGem.is_active : true,
            });
        } else {
            // Calculate default order: max order + 1, or 1 if no gems exist
            const maxOrder = aiGems.length > 0 
                ? Math.max(...aiGems.map(gem => gem.order || 1))
                : 0;
            const defaultOrder = maxOrder + 1;
            
            setEditingAiGem(null);
            setAiGemFormData({
                name: '',
                gem_url: '',
                order: defaultOrder,
                is_active: true,
            });
        }
        setShowAiModal(true);
    };

    const handleCloseAiModal = () => {
        setShowAiModal(false);
        setEditingAiGem(null);
    };

    const handleAiGemSubmit = async (e) => {
        e.preventDefault();
        try {
            // Ensure order is a valid number (at least 1)
            const formDataToSubmit = {
                ...aiGemFormData,
                order: aiGemFormData.order && aiGemFormData.order >= 1 ? aiGemFormData.order : 1,
            };
            
            if (editingAiGem) {
                await adminAPI.updateAiGem(editingAiGem.id, formDataToSubmit);
                showSuccess(t('admin.aiGemUpdated'));
            } else {
                await adminAPI.createAiGem(formDataToSubmit);
                showSuccess(t('admin.aiGemCreated'));
            }
            handleCloseAiModal();
            // Refresh the list to show updated order
            await fetchAiGems();
        } catch (error) {
            console.error('Error saving AI Gem:', error);
            showError(error.response?.data?.message || t('admin.errorSaving'));
        }
    };

    const handleDeleteAiGem = (aiGem) => {
        showConfirm(
            t('admin.confirmDeleteAiGem'),
            t('common.confirm'),
            async () => {
                try {
                    await adminAPI.deleteAiGem(aiGem.id);
                    showSuccess(t('admin.aiGemDeleted'));
                    fetchAiGems();
                } catch (error) {
                    console.error('Error deleting AI Gem:', error);
                    showError(error.response?.data?.message || t('admin.errorDeleting'));
                }
            }
        );
    };

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
        <div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
            <nav className="z-30 flex-shrink-0 border-b bg-white shadow-sm">
                <div className="mx-auto max-w-[1920px] px-3 sm:px-4 lg:px-6">
                    <div className="flex h-14 items-center justify-between gap-2 sm:h-16">
                        <div className="flex min-w-0 flex-1 items-center gap-2 xl:gap-6">
                            <button
                                type="button"
                                aria-label="Menu"
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
                                Home
                            </h1>
                            <div className="hidden flex-shrink-0 gap-1 text-[15px] xl:flex">
                                <button
                                    onClick={() => navigate('/problems')}
                                    className={`px-3 py-1 text-sm rounded transition ${location.pathname.startsWith('/problems') && !location.pathname.startsWith('/machine')
                                            ? 'bg-blue-600 text-white'
                                            : 'text-blue-600 hover:text-blue-800 border border-blue-600 hover:bg-blue-50'
                                        }`}
                                >
                                    {t('nav.problems')}
                                </button>
                                <button
                                    onClick={() => navigate('/machines')}
                                    className={`px-3 py-1 text-sm rounded transition ${location.pathname.startsWith('/machines') || location.pathname.startsWith('/machine-zone')
                                            ? 'bg-green-600 text-white'
                                            : 'text-green-600 hover:text-green-800 border border-green-600 hover:bg-green-50'
                                        }`}
                                >
                                    {t('nav.machines')}
                                </button>
                                <button
                                    onClick={() => navigate('/production-monitoring')}
                                    className={`px-3 py-1 text-sm rounded transition ${location.pathname.startsWith('/production-monitoring')
                                            ? 'bg-orange-600 text-white'
                                            : 'text-orange-600 hover:text-orange-800 border border-orange-600 hover:bg-orange-50'
                                        }`}
                                >
                                    Production
                                </button>
                                <div className="relative" ref={aiDropdownRef}>
                                    <button
                                        onClick={() => setIsAIDropdownOpen(!isAIDropdownOpen)}
                                        className="px-3 py-1 text-sm text-purple-600 hover:text-purple-800 font-medium border border-purple-600 rounded hover:bg-purple-50 transition flex items-center gap-1"
                                    >
                                        {t('nav.askAI')}
                                        <svg 
                                            className={`w-4 h-4 transition-transform ${isAIDropdownOpen ? 'rotate-180' : ''}`} 
                                            fill="none" 
                                            stroke="currentColor" 
                                            viewBox="0 0 24 24"
                                        >
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                        </svg>
                                    </button>
                                    {isAIDropdownOpen && (
                                        <div className="absolute top-full left-0 mt-1 bg-white border border-purple-200 rounded-md shadow-lg min-w-[200px] z-50 overflow-hidden max-h-[400px] overflow-y-auto">
                                            {loadingAiGems ? (
                                                <div className="px-4 py-2 text-sm text-gray-500 text-center">
                                                    {t('common.loading')}
                                                </div>
                                            ) : sortedActiveGems.length > 0 ? (
                                                <>
                                                    {sortedActiveGems.map((gem) => (
                                                            <div key={gem.id} className="flex items-center group">
                                                                <button
                                                                    onClick={() => {
                                                                        window.open(gem.gem_url, '_blank');
                                                                        setIsAIDropdownOpen(false);
                                                                    }}
                                                                    className="flex-1 text-left px-4 py-2 text-sm text-purple-600 hover:bg-purple-50 transition"
                                                                >
                                                                    {gem.name}
                                                                </button>
                                                                <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                                                                    <button
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            handleOpenAiModal(gem);
                                                                            setIsAIDropdownOpen(false);
                                                                        }}
                                                                        className="px-2 py-1 text-xs text-blue-600 hover:bg-blue-50"
                                                                        title={t('common.edit')}
                                                                    >
                                                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                                                        </svg>
                                                                    </button>
                                                                    <button
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            handleDeleteAiGem(gem);
                                                                            setIsAIDropdownOpen(false);
                                                                        }}
                                                                        className="px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                                                                        title={t('common.delete')}
                                                                    >
                                                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                                        </svg>
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    <div className="border-t border-purple-100">
                                                        <button
                                                            onClick={() => {
                                                                handleOpenAiModal();
                                                                setIsAIDropdownOpen(false);
                                                            }}
                                                            className="w-full text-left px-4 py-2 text-sm text-purple-600 hover:bg-purple-50 transition font-medium flex items-center gap-2"
                                                        >
                                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                                            </svg>
                                                            {t('admin.addAiGem')}
                                                        </button>
                                                    </div>
                                                </>
                                            ) : (
                                                <div className="px-4 py-2 text-sm text-gray-500 text-center">
                                                    {t('admin.noAiGems')}
                                                    <button
                                                        onClick={() => {
                                                            handleOpenAiModal();
                                                            setIsAIDropdownOpen(false);
                                                        }}
                                                        className="mt-2 w-full px-3 py-1 text-sm text-purple-600 hover:bg-purple-50 rounded border border-purple-200"
                                                    >
                                                        {t('admin.addAiGem')}
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                        <div className="flex flex-shrink-0 items-center gap-2 sm:gap-4">
                            <div className="hidden flex-wrap gap-2 xl:flex">

                                <button
                                    onClick={() => navigate('/admin/problems')}
                                    className={`px-2 py-2 rounded-lg transition ${isActive('/admin/problems')}`}
                                >
                                    {t('admin.manageProblems')}
                                </button>
                                <button
                                    onClick={() => navigate('/admin/machines')}
                                    className={`px-2 py-2 rounded-lg transition ${isActive('/admin/machines')}`}
                                >
                                    {t('admin.manageMachines')}
                                </button>
                                <button
                                    onClick={() => navigate('/admin/categories')}
                                    className={`px-2 py-2 rounded-lg transition ${isActive('/admin/categories')}`}
                                >
                                    {t('admin.manageCategories')}
                                </button>
                                <button
                                    onClick={() => navigate('/admin/users')}
                                    className={`px-2 py-2 rounded-lg transition ${isActive('/admin/users')}`}
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
                            <LanguageSwitcher />
                            <div className="relative group">
                                <button
                                    type="button"
                                    className="flex max-w-[9rem] items-center gap-1 rounded px-2 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-100 focus:outline-none sm:max-w-xs sm:px-3"
                                >
                                    <span className="truncate">{user?.name}</span>
                                    <svg className="ml-1 h-4 w-4 flex-shrink-0 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                    </svg>
                                </button>
                                <div className="pointer-events-none absolute right-0 top-full z-50 mt-2 min-w-[150px] rounded-md border border-gray-200 bg-white opacity-0 shadow-lg transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
                                    <button
                                        type="button"
                                        onClick={handleLogout}
                                        className="w-full rounded-b px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                                    >
                                        {t('nav.logout')}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                {mobileNavOpen && (
                    <div className="fixed inset-0 z-40 xl:hidden" role="dialog" aria-modal="true">
                        <button
                            type="button"
                            className="absolute inset-0 bg-black/40"
                            aria-label="Close menu"
                            onClick={() => setMobileNavOpen(false)}
                        />
                        <div className="absolute inset-y-0 right-0 flex w-[min(100%,21rem)] flex-col bg-white shadow-xl">
                            <div className="flex items-center justify-between border-b px-4 py-3">
                                <span className="font-semibold text-gray-900">Menu</span>
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
                                        Production
                                    </button>
                                    <p className="mt-2 px-1 text-xs font-semibold uppercase tracking-wide text-gray-500">{t('nav.askAI')}</p>
                                    {loadingAiGems ? (
                                        <div className="text-sm text-gray-500">{t('common.loading')}</div>
                                    ) : sortedActiveGems.length > 0 ? (
                                        sortedActiveGems.map((gem) => (
                                            <div key={gem.id} className="flex items-stretch gap-1 rounded-lg border border-purple-100 p-2">
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        window.open(gem.gem_url, '_blank');
                                                        setMobileNavOpen(false);
                                                    }}
                                                    className="min-w-0 flex-1 px-2 py-2 text-left text-sm text-purple-700"
                                                >
                                                    {gem.name}
                                                </button>
                                                <button
                                                    type="button"
                                                    className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded text-blue-600 hover:bg-blue-50"
                                                    title={t('common.edit')}
                                                    onClick={() => {
                                                        handleOpenAiModal(gem);
                                                        setMobileNavOpen(false);
                                                    }}
                                                >
                                                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                                    </svg>
                                                </button>
                                                <button
                                                    type="button"
                                                    className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded text-red-600 hover:bg-red-50"
                                                    title={t('common.delete')}
                                                    onClick={() => {
                                                        handleDeleteAiGem(gem);
                                                        setMobileNavOpen(false);
                                                    }}
                                                >
                                                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                    </svg>
                                                </button>
                                            </div>
                                        ))
                                    ) : (
                                        <div className="text-sm text-gray-500">{t('admin.noAiGems')}</div>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => {
                                            handleOpenAiModal();
                                            setMobileNavOpen(false);
                                        }}
                                        className="mt-1 rounded-lg border border-purple-200 px-4 py-2.5 text-left text-sm font-medium text-purple-700"
                                    >
                                        + {t('admin.addAiGem')}
                                    </button>
                                    <p className="mt-4 px-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Admin</p>
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
            <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>

            {/* AI Gem Modal */}
            {showAiModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
                    <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 animate-scale-in">
                        <div className="p-6">
                            <h3 className="text-lg font-semibold text-gray-900 mb-4">
                                {editingAiGem ? t('admin.editAiGem') : t('admin.addAiGem')}
                            </h3>
                            <form onSubmit={handleAiGemSubmit}>
                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">
                                            {t('admin.aiGemName')} <span className="text-red-500">*</span>
                                        </label>
                                        <input
                                            type="text"
                                            value={aiGemFormData.name}
                                            onChange={(e) => setAiGemFormData({ ...aiGemFormData, name: e.target.value })}
                                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                                            required
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">
                                            {t('admin.aiGemUrl')} <span className="text-red-500">*</span>
                                        </label>
                                        <input
                                            type="url"
                                            value={aiGemFormData.gem_url}
                                            onChange={(e) => setAiGemFormData({ ...aiGemFormData, gem_url: e.target.value })}
                                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                                            placeholder="https://gemini.google.com/gem/..."
                                            required
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">
                                            {t('common.order')}
                                        </label>
                                        <input
                                            type="number"
                                            value={aiGemFormData.order}
                                            onChange={(e) => {
                                                const value = e.target.value === '' ? 1 : parseInt(e.target.value);
                                                setAiGemFormData({ ...aiGemFormData, order: isNaN(value) ? 1 : value });
                                            }}
                                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                                            min="1"
                                        />
                                    </div>
                                    <div className="flex items-center">
                                        <input
                                            type="checkbox"
                                            id="is_active"
                                            checked={aiGemFormData.is_active}
                                            onChange={(e) => setAiGemFormData({ ...aiGemFormData, is_active: e.target.checked })}
                                            className="w-4 h-4 text-purple-600 border-gray-300 rounded focus:ring-purple-500"
                                        />
                                        <label htmlFor="is_active" className="ml-2 text-sm text-gray-700">
                                            {t('common.active')}
                                        </label>
                                    </div>
                                </div>
                                <div className="flex justify-end space-x-3 mt-6">
                                    <button
                                        type="button"
                                        onClick={handleCloseAiModal}
                                        className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                                    >
                                        {t('common.cancel')}
                                    </button>
                                    <button
                                        type="submit"
                                        className="px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700 transition-colors"
                                    >
                                        {t('common.save')}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AdminLayout;

