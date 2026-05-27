import React, { useState, useEffect, useMemo } from 'react';
import { adminAPI } from '../api';
import { useLanguage } from '../contexts/LanguageContext';
import { useTranslation } from '../utils/translations';
import { useAlert } from '../contexts/AlertContext';
import { useSubmitGuard } from '../hooks/useSubmitGuard';

/**
 * รายการ AI Gems ในเมนู — เปิด / แก้ไข / ลบ / เพิ่ม (ทุก role ที่ login)
 */
const AiGemsNavSection = ({ onAfterAction }) => {
    const { language } = useLanguage();
    const { t } = useTranslation(language);
    const { showSuccess, showError, showConfirm } = useAlert();
    const { isSubmitting: aiGemSubmitting, run: runAiGemSubmit } = useSubmitGuard();
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
            const maxOrder = aiGems.length > 0
                ? Math.max(...aiGems.map((gem) => gem.order || 1))
                : 0;
            setEditingAiGem(null);
            setAiGemFormData({
                name: '',
                gem_url: '',
                order: maxOrder + 1,
                is_active: true,
            });
        }
        setShowAiModal(true);
        onAfterAction?.();
    };

    const handleCloseAiModal = () => {
        setShowAiModal(false);
        setEditingAiGem(null);
    };

    const handleAiGemSubmit = async (e) => {
        e.preventDefault();
        await runAiGemSubmit(async () => {
            try {
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
                await fetchAiGems();
            } catch (error) {
                console.error('Error saving AI Gem:', error);
                showError(error.response?.data?.message || t('admin.errorSaving'));
            }
        });
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
        onAfterAction?.();
    };

    const openGem = (url) => {
        window.open(url, '_blank');
        onAfterAction?.();
    };

    return (
        <>
            <p className="mt-2 px-1 text-xs font-semibold uppercase tracking-wide text-gray-500">{t('nav.askAI')}</p>
            {loadingAiGems ? (
                <div className="text-sm text-gray-500">{t('common.loading')}</div>
            ) : sortedActiveGems.length > 0 ? (
                sortedActiveGems.map((gem) => (
                    <div key={gem.id} className="flex items-stretch gap-1 rounded-lg border border-purple-100 p-2">
                        <button
                            type="button"
                            onClick={() => openGem(gem.gem_url)}
                            className="min-w-0 flex-1 px-2 py-2 text-left text-sm text-purple-700"
                        >
                            {gem.name}
                        </button>
                        <button
                            type="button"
                            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded text-blue-600 hover:bg-blue-50"
                            title={t('common.edit')}
                            onClick={() => handleOpenAiModal(gem)}
                        >
                            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                        </button>
                        <button
                            type="button"
                            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded text-red-600 hover:bg-red-50"
                            title={t('common.delete')}
                            onClick={() => handleDeleteAiGem(gem)}
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
                onClick={() => handleOpenAiModal()}
                className="mt-1 rounded-lg border border-purple-200 px-4 py-2.5 text-left text-sm font-medium text-purple-700"
            >
                + {t('admin.addAiGem')}
            </button>

            {showAiModal && (
                <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center">
                    <div className="animate-scale-in max-h-[min(90dvh,720px)] w-full max-w-md overflow-y-auto rounded-lg bg-white shadow-xl">
                        <div className="p-4 sm:p-6">
                            <h3 className="mb-4 text-lg font-semibold text-gray-900">
                                {editingAiGem ? t('admin.editAiGem') : t('admin.addAiGem')}
                            </h3>
                            <form onSubmit={handleAiGemSubmit}>
                                <div className="space-y-4">
                                    <div>
                                        <label className="mb-1 block text-sm font-medium text-gray-700">
                                            {t('admin.aiGemName')} <span className="text-red-500">*</span>
                                        </label>
                                        <input
                                            type="text"
                                            value={aiGemFormData.name}
                                            onChange={(e) => setAiGemFormData({ ...aiGemFormData, name: e.target.value })}
                                            className="w-full rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500"
                                            required
                                        />
                                    </div>
                                    <div>
                                        <label className="mb-1 block text-sm font-medium text-gray-700">
                                            {t('admin.aiGemUrl')} <span className="text-red-500">*</span>
                                        </label>
                                        <input
                                            type="url"
                                            value={aiGemFormData.gem_url}
                                            onChange={(e) => setAiGemFormData({ ...aiGemFormData, gem_url: e.target.value })}
                                            className="w-full rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500"
                                            placeholder="https://gemini.google.com/gem/..."
                                            required
                                        />
                                    </div>
                                    <div>
                                        <label className="mb-1 block text-sm font-medium text-gray-700">
                                            {t('common.order')}
                                        </label>
                                        <input
                                            type="number"
                                            value={aiGemFormData.order}
                                            onChange={(e) => {
                                                const value = e.target.value === '' ? 1 : parseInt(e.target.value, 10);
                                                setAiGemFormData({ ...aiGemFormData, order: Number.isNaN(value) ? 1 : value });
                                            }}
                                            className="w-full rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500"
                                            min="1"
                                        />
                                    </div>
                                    <div className="flex items-center">
                                        <input
                                            type="checkbox"
                                            id="ai_gem_is_active"
                                            checked={aiGemFormData.is_active}
                                            onChange={(e) => setAiGemFormData({ ...aiGemFormData, is_active: e.target.checked })}
                                            className="h-4 w-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                                        />
                                        <label htmlFor="ai_gem_is_active" className="ml-2 text-sm text-gray-700">
                                            {t('common.active')}
                                        </label>
                                    </div>
                                </div>
                                <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
                                    <button
                                        type="button"
                                        onClick={handleCloseAiModal}
                                        className="w-full rounded-lg bg-gray-100 px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200 sm:w-auto sm:py-2"
                                    >
                                        {t('common.cancel')}
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={aiGemSubmitting}
                                        className="w-full rounded-lg bg-purple-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:py-2"
                                    >
                                        {aiGemSubmitting ? t('common.loading') : t('common.save')}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

export default AiGemsNavSection;
