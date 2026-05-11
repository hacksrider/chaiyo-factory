import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminAPI } from '../../api';
import AdminLayout from '../../components/AdminLayout';
import { useAlert } from '../../contexts/AlertContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { useTranslation } from '../../utils/translations';
import { formatValidationErrors } from '../../utils/errorTranslator';

const PageContentsManagement = () => {
    const navigate = useNavigate();
    const { language } = useLanguage();
    const { t } = useTranslation(language);
    const { showSuccess, showError, showConfirm } = useAlert();
    const [contents, setContents] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [editingContent, setEditingContent] = useState(null);
    const [formData, setFormData] = useState({
        page_key: '',
        title: '',
        content: '',
    });

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
        return <div className="text-center py-12">กำลังโหลด...</div>;
    }

    return (
        <AdminLayout>
            <div className="mx-auto w-full max-w-[1920px] px-3 py-6 sm:px-4 lg:px-6 sm:py-8">
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
                <div className="overflow-hidden rounded-lg border border-gray-100 bg-white shadow-md">
                    <div className="overflow-x-auto">
                    <table className="min-w-[720px] w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Page Key</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">หัวข้อ</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">เนื้อหา</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">จัดการ</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {contents.map((content) => (
                                <tr key={content.id}>
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        <div className="text-sm font-medium text-gray-900">{content.page_key}</div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="text-sm font-medium text-gray-900">{content.title}</div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="text-sm text-gray-500 line-clamp-2">
                                            {content.content.substring(0, 100)}...
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                        <button
                                            onClick={() => handleOpenModal(content)}
                                            className="text-blue-600 hover:text-blue-900 mr-4"
                                        >
                                            แก้ไข
                                        </button>
                                        <button
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
                    </div>
                </div>
            </div>

            {/* Modal */}
            {showModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                        <div className="p-6">
                            <h2 className="text-2xl font-bold mb-4">
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
                                        className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                                    >
                                        บันทึก
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>
            )}
        </AdminLayout>
    );
};

export default PageContentsManagement;

