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
    AdminTruncatedCell,
} from '../../components/AdminListCards';
import AdminSearchBar from '../../components/AdminSearchBar';
import Pagination from '../../components/Pagination';
import useClientList, { LIST_PAGE_SIZE } from '../../hooks/useClientList';
import { useAlert } from '../../contexts/AlertContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { useTranslation } from '../../utils/translations';
import { formatValidationErrors } from '../../utils/errorTranslator';
import { useSubmitGuard } from '../../hooks/useSubmitGuard';

const PageContentsManagement = () => {
    const navigate = useNavigate();
    const { language } = useLanguage();
    const { t } = useTranslation(language);
    const { showSuccess, showError, showConfirm } = useAlert();
    const { isSubmitting, run } = useSubmitGuard();
    const [contents, setContents] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [page, setPage] = useState(1);
    const [showModal, setShowModal] = useState(false);
    const [editingContent, setEditingContent] = useState(null);
    const [formData, setFormData] = useState({
        page_key: '',
        title: '',
        content: '',
    });

    const { paginated, lastPage, safePage, total, perPage } = useClientList(contents, {
        search: searchTerm,
        searchKeys: ['page_key', 'title', 'content'],
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
        fetchContents();
    }, []);

    const fetchContents = async () => {
        try {
            const response = await adminAPI.getPageContents();
            setContents(response.data);
        } catch (error) {
            console.error('Error fetching page contents:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleOpenModal = (content = null) => {
        if (content) {
            setEditingContent(content);
            setFormData({
                page_key: content.page_key,
                title: content.title,
                content: content.content,
            });
        } else {
            setEditingContent(null);
            setFormData({
                page_key: '',
                title: '',
                content: '',
            });
        }
        setShowModal(true);
    };

    const handleCloseModal = () => {
        setShowModal(false);
        setEditingContent(null);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        await run(async () => {
            try {
                if (editingContent) {
                    await adminAPI.updatePageContent(editingContent.id, formData);
                } else {
                    await adminAPI.createPageContent(formData);
                }
                handleCloseModal();
                fetchContents();
                showSuccess(editingContent ? t('admin.contentUpdated') : t('admin.contentCreated'));
            } catch (error) {
                console.error('Error saving page content:', error);
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
            t('admin.confirmDeleteContent') || 'คุณแน่ใจหรือไม่ว่าต้องการลบเนื้อหานี้?',
            null,
            async () => {
                try {
                    await adminAPI.deletePageContent(id);
                    fetchContents();
                    showSuccess(t('admin.contentDeleted'));
                } catch (error) {
                    console.error('Error deleting page content:', error);
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
                    <div className="text-lg text-gray-600 sm:text-xl">กำลังโหลด...</div>
                </div>
            </AppPageLayout>
        );
    }

    return (
        <AppPageLayout>
            <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col bg-gray-50 px-3 py-6 sm:px-4 lg:px-6 sm:py-8">
                <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <h1 className="text-xl font-bold sm:text-2xl">จัดการเนื้อหา</h1>
                    <button
                        type="button"
                        onClick={() => handleOpenModal()}
                        className="w-full shrink-0 rounded-lg bg-blue-600 px-4 py-2.5 text-white hover:bg-blue-700 sm:w-auto"
                    >
                        + เพิ่มเนื้อหา
                    </button>
                </div>
                <AdminSearchBar
                    value={searchTerm}
                    onChange={setSearchTerm}
                    placeholder={t('admin.searchPageContents')}
                />
                {contents.length === 0 ? (
                    <AdminListEmpty message={t('admin.noPageContents')} />
                ) : paginated.length === 0 ? (
                    <AdminListEmpty message={t('common.noSearchResults')} />
                ) : (
                    <>
                        <AdminMobileCardList>
                            {paginated.map((content) => (
                                <AdminMobileCard
                                    key={content.id}
                                    title={content.title}
                                    actions={
                                        <>
                                            <AdminCardButton onClick={() => handleOpenModal(content)}>
                                                แก้ไข
                                            </AdminCardButton>
                                            <AdminCardButton variant="danger" onClick={() => handleDelete(content.id)}>
                                                ลบ
                                            </AdminCardButton>
                                        </>
                                    }
                                >
                                    <AdminCardRows>
                                        <AdminCardRow label="Page Key" value={content.page_key} />
                                        <AdminCardRow
                                            label="เนื้อหา"
                                            value={
                                                <span className="line-clamp-3 break-words">
                                                    {content.content.substring(0, 100)}...
                                                </span>
                                            }
                                            multiline
                                        />
                                    </AdminCardRows>
                                </AdminMobileCard>
                            ))}
                        </AdminMobileCardList>

                        <AdminDesktopTable>
                            <table className="min-w-[720px] w-full divide-y divide-gray-200">
                                <thead className="bg-gray-50">
                                    <tr>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Page Key</th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">หัวข้อ</th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">เนื้อหา</th>
                                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">จัดการ</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200 bg-white">
                                    {paginated.map((content) => (
                                        <tr key={content.id}>
                                            <td className="px-6 py-4">
                                                <AdminTruncatedCell>{content.page_key}</AdminTruncatedCell>
                                            </td>
                                            <td className="px-6 py-4">
                                                <AdminTruncatedCell>{content.title}</AdminTruncatedCell>
                                            </td>
                                            <td className="px-6 py-4">
                                                <AdminTruncatedCell tone="muted" clamp={2} className="max-w-md">
                                                    {content.content.substring(0, 100)}...
                                                </AdminTruncatedCell>
                                            </td>
                                            <td className="whitespace-nowrap px-6 py-4 text-right text-sm font-medium">
                                                <button
                                                    type="button"
                                                    onClick={() => handleOpenModal(content)}
                                                    className="mr-4 text-blue-600 hover:text-blue-900"
                                                >
                                                    แก้ไข
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => handleDelete(content.id)}
                                                    className="text-red-600 hover:text-red-900"
                                                >
                                                    ลบ
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
                    <div className="max-h-[min(90dvh,720px)] w-full max-w-2xl overflow-y-auto rounded-lg bg-white shadow-xl">
                        <div className="p-4 sm:p-6">
                            <h2 className="mb-4 text-xl font-bold sm:text-2xl">
                                {editingContent ? 'แก้ไขเนื้อหา' : 'เพิ่มเนื้อหาใหม่'}
                            </h2>
                            <form onSubmit={handleSubmit} className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                        Page Key <span className="text-red-500">*</span> {editingContent && '(ไม่สามารถแก้ไขได้)'}
                                    </label>
                                    <input
                                        type="text"
                                        required
                                        disabled={!!editingContent}
                                        value={formData.page_key}
                                        onChange={(e) => setFormData({ ...formData, page_key: e.target.value })}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                                        placeholder="เช่น: home, about"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                        หัวข้อ <span className="text-red-500">*</span>
                                    </label>
                                    <input
                                        type="text"
                                        required
                                        value={formData.title}
                                        onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                        เนื้อหา <span className="text-red-500">*</span> (รองรับ HTML)
                                    </label>
                                    <textarea
                                        required
                                        rows={10}
                                        value={formData.content}
                                        onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                                    />
                                </div>

                                <div className="flex gap-4 pt-4">
                                    <button
                                        type="button"
                                        onClick={handleCloseModal}
                                        className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                                    >
                                        ยกเลิก
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

export default PageContentsManagement;

