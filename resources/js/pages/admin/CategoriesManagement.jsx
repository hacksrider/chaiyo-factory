import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminAPI } from '../../api';
import AppPageLayout from '../../components/AppPageLayout';
import {
    AdminCardButton,
    AdminCardRow,
    AdminCardRows,
    AdminDesktopTable,
    AdminListEmpty,
    AdminMobileCard,
    AdminMobileCardList,
    AdminStatusBadge,
    AdminTruncatedCell,
} from '../../components/AdminListCards';
import AdminSearchBar from '../../components/AdminSearchBar';
import Pagination from '../../components/Pagination';
import useClientList, { LIST_PAGE_SIZE } from '../../hooks/useClientList';
import { useLanguage } from '../../contexts/LanguageContext';
import { useTranslation } from '../../utils/translations';
import { useAlert } from '../../contexts/AlertContext';
import { formatValidationErrors } from '../../utils/errorTranslator';
import { useSubmitGuard } from '../../hooks/useSubmitGuard';

const CategoriesManagement = () => {
    const { language } = useLanguage();
    const { t } = useTranslation(language);
    const { showSuccess, showError, showConfirm } = useAlert();
    const { isSubmitting, run } = useSubmitGuard();
    const navigate = useNavigate();
    const [categories, setCategories] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [page, setPage] = useState(1);
    const [showModal, setShowModal] = useState(false);
    const [editingCategory, setEditingCategory] = useState(null);
    const [formData, setFormData] = useState({
        name: '',
        name_mm: '',
        description: '',
        description_mm: '',
        is_active: true,
    });

    const { paginated, lastPage, safePage, total, perPage } = useClientList(categories, {
        search: searchTerm,
        searchKeys: ['name', 'name_mm', 'description', 'description_mm'],
        page,
        perPage: LIST_PAGE_SIZE,
    });

    useEffect(() => {
        setPage(1);
    }, [searchTerm]);

    useEffect(() => {
        if (safePage !== page) {
            setPage(safePage);
        }
    }, [safePage, page]);

    useEffect(() => {
        fetchCategories();
    }, []);

    const fetchCategories = async () => {
        try {
            const response = await adminAPI.getAllCategories();
            setCategories(response.data);
        } catch (error) {
            console.error('Error fetching categories:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleOpenModal = (category = null) => {
        if (category) {
            setEditingCategory(category);
            setFormData({
                name: category.name || '',
                name_mm: category.name_mm || '',
                description: category.description || '',
                description_mm: category.description_mm || '',
                is_active: category.is_active,
            });
        } else {
            setEditingCategory(null);
            setFormData({
                name: '',
                name_mm: '',
                description: '',
                description_mm: '',
                is_active: true,
            });
        }
        setShowModal(true);
    };

    const handleCloseModal = () => {
        setShowModal(false);
        setEditingCategory(null);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        await run(async () => {
            try {
                const submitData = { ...formData, order: 0 };
                if (editingCategory) {
                    await adminAPI.updateCategory(editingCategory.id, submitData);
                } else {
                    await adminAPI.createCategory(submitData);
                }
                handleCloseModal();
                fetchCategories();
                showSuccess(editingCategory ? t('admin.categoryUpdated') : t('admin.categoryCreated'));
            } catch (error) {
                console.error('Error saving category:', error);
                let errorMessage = t('errors.cannotSave');

                if (error.response?.data?.errors) {
                    errorMessage = formatValidationErrors(error.response.data.errors, t) || errorMessage;
                } else if (error.response?.data?.message) {
                    errorMessage = error.response.data.message;
                }

                showError(errorMessage);
            }
        });
    };

    const handleDelete = async (id) => {
        showConfirm(
            t('admin.confirmDeleteCategory'),
            null,
            async () => {
                try {
                    await adminAPI.deleteCategory(id);
                    fetchCategories();
                    showSuccess(t('admin.categoryDeleted'));
                } catch (error) {
                    console.error('Error deleting category:', error);
                    let errorMessage = t('errors.cannotDelete');
                    if (error.response?.data?.message) {
                        errorMessage = error.response.data.message;
                    }
                    showError(errorMessage);
                }
            }
        );
    };

    if (loading) {
        return (
            <AppPageLayout>
                <div className="flex min-h-0 w-full min-w-0 flex-1 items-center justify-center bg-gray-50 px-4 py-12">
                    <div className="text-lg text-gray-600 sm:text-xl">{t('common.loading')}</div>
                </div>
            </AppPageLayout>
        );
    }

    return (
        <AppPageLayout>
            <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col bg-gray-50 px-3 py-6 sm:px-4 lg:px-6 sm:py-8">
                <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <h1 className="text-xl font-bold sm:text-2xl">{t('admin.manageCategories')}</h1>
                    <button
                        type="button"
                        onClick={() => handleOpenModal()}
                        className="w-full shrink-0 rounded-lg bg-blue-600 px-4 py-2.5 text-white hover:bg-blue-700 sm:w-auto"
                    >
                        + {t('admin.addCategory')}
                    </button>
                </div>
                <AdminSearchBar
                    value={searchTerm}
                    onChange={setSearchTerm}
                    placeholder={t('admin.searchCategories')}
                />
                {categories.length === 0 ? (
                    <AdminListEmpty message={t('admin.noCategories')} />
                ) : paginated.length === 0 ? (
                    <AdminListEmpty message={t('common.noSearchResults')} />
                ) : (
                    <>
                        <AdminMobileCardList>
                            {paginated.map((category) => (
                                <AdminMobileCard
                                    key={category.id}
                                    title={category.name}
                                    badge={
                                        <AdminStatusBadge
                                            active={category.is_active}
                                            activeLabel={t('common.active')}
                                            inactiveLabel={t('common.inactive')}
                                        />
                                    }
                                    actions={
                                        <>
                                            <AdminCardButton onClick={() => handleOpenModal(category)}>
                                                {t('common.edit')}
                                            </AdminCardButton>
                                            <AdminCardButton variant="danger" onClick={() => handleDelete(category.id)}>
                                                {t('common.delete')}
                                            </AdminCardButton>
                                        </>
                                    }
                                >
                                    <AdminCardRows>
                                        <AdminCardRow
                                            label={t('admin.categoryDescription')}
                                            value={category.description || '-'}
                                            multiline
                                        />
                                    </AdminCardRows>
                                </AdminMobileCard>
                            ))}
                        </AdminMobileCardList>

                        <AdminDesktopTable>
                            <table className="min-w-[640px] w-full divide-y divide-gray-200">
                                <thead className="bg-gray-50">
                                    <tr>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('admin.categoryName')}</th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('admin.categoryDescription')}</th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('common.status')}</th>
                                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">{t('common.edit')}</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200 bg-white">
                                    {paginated.map((category) => (
                                        <tr key={category.id}>
                                            <td className="px-6 py-4">
                                                <AdminTruncatedCell>{category.name}</AdminTruncatedCell>
                                            </td>
                                            <td className="px-6 py-4">
                                                <AdminTruncatedCell tone="muted" clamp={2} className="max-w-md">
                                                    {category.description || '-'}
                                                </AdminTruncatedCell>
                                            </td>
                                            <td className="whitespace-nowrap px-6 py-4">
                                                <AdminStatusBadge
                                                    active={category.is_active}
                                                    activeLabel={t('common.active')}
                                                    inactiveLabel={t('common.inactive')}
                                                />
                                            </td>
                                            <td className="whitespace-nowrap px-6 py-4 text-right text-sm font-medium">
                                                <button
                                                    type="button"
                                                    onClick={() => handleOpenModal(category)}
                                                    className="mr-4 text-blue-600 hover:text-blue-900"
                                                >
                                                    {t('common.edit')}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => handleDelete(category.id)}
                                                    className="text-red-600 hover:text-red-900"
                                                >
                                                    {t('common.delete')}
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </AdminDesktopTable>

                        <Pagination
                            className="mt-6"
                            currentPage={safePage}
                            lastPage={lastPage}
                            total={total}
                            perPage={perPage}
                            onPageChange={setPage}
                            t={t}
                        />
                    </>
                )}
            </div>

            {/* Modal */}
            {showModal && (
                <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center">
                    <div className="max-h-[min(90dvh,720px)] w-full max-w-md overflow-y-auto rounded-lg bg-white shadow-xl">
                        <div className="p-4 sm:p-6">
                            <h2 className="mb-4 text-xl font-bold sm:text-2xl">
                                {editingCategory ? t('admin.editCategory') : t('admin.addCategory')}
                            </h2>
                            <form onSubmit={handleSubmit} className="space-y-4">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">
                                            {t('admin.categoryName')} (ไทย) <span className="text-red-500">*</span>
                                        </label>
                                        <input
                                            type="text"
                                            required
                                            value={formData.name}
                                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">
                                            {t('admin.categoryName')} (မြန်မာ)
                                        </label>
                                        <input
                                            type="text"
                                            value={formData.name_mm}
                                            onChange={(e) => setFormData({ ...formData, name_mm: e.target.value })}
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        />
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">
                                            {t('admin.categoryDescription')} (ไทย)
                                        </label>
                                        <textarea
                                            rows={3}
                                            value={formData.description}
                                            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">
                                            {t('admin.categoryDescription')} (မြန်မာ)
                                        </label>
                                        <textarea
                                            rows={3}
                                            value={formData.description_mm}
                                            onChange={(e) => setFormData({ ...formData, description_mm: e.target.value })}
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        />
                                    </div>
                                </div>

                                <div className="flex gap-4">
                                    <div className="flex-1 flex items-end">
                                        <label className="flex items-center">
                                            <input
                                                type="checkbox"
                                                checked={formData.is_active}
                                                onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                                                className="mr-2"
                                            />
                                            <span className="text-sm text-gray-700">{t('common.active')}</span>
                                        </label>
                                    </div>
                                </div>

                                <div className="flex gap-4 pt-4">
                                    <button
                                        type="button"
                                        onClick={handleCloseModal}
                                        className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                                    >
                                        {t('common.cancel')}
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={isSubmitting}
                                        className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {isSubmitting ? t('common.loading') : t('common.save')}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>
            )}
        </AppPageLayout>
    );
};

export default CategoriesManagement;

