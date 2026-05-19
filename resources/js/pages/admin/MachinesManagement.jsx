import React, { useState, useEffect, useRef } from 'react';
import { adminAPI } from '../../api';
import AdminLayout from '../../components/AdminLayout';
import MediaPreview from '../../components/MediaPreview';
import { useLanguage } from '../../contexts/LanguageContext';
import { useTranslation } from '../../utils/translations';
import { useAlert } from '../../contexts/AlertContext';
import { formatValidationErrors } from '../../utils/errorTranslator';
import { useSubmitGuard } from '../../hooks/useSubmitGuard';

const MachinesManagement = () => {
    const { language } = useLanguage();
    const { t } = useTranslation(language);
    const { showSuccess, showError, showConfirm } = useAlert();
    const { isSubmitting, run } = useSubmitGuard();
    const [machines, setMachines] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [editingMachine, setEditingMachine] = useState(null);
    const [formData, setFormData] = useState({
        name: '',
        name_mm: '',
        code: '',
        description: '',
        description_mm: '',
        is_active: true,
    });
    const [layoutImageFile, setLayoutImageFile] = useState(null);
    const [removeLayoutImage, setRemoveLayoutImage] = useState(false);
    const layoutImageFileInputRef = useRef(null);
    
    // Zone management states
    const [selectedMachine, setSelectedMachine] = useState(null);
    const [zones, setZones] = useState([]);
    const [showZoneModal, setShowZoneModal] = useState(false);
    const [editingZone, setEditingZone] = useState(null);
    const [zoneFormData, setZoneFormData] = useState({
        name: '',
        name_mm: '',
        description: '',
        description_mm: '',
        is_active: true,
    });
    const [zoneImageFile, setZoneImageFile] = useState(null);
    const [removeZoneImage, setRemoveZoneImage] = useState(false);
    const zoneImageFileInputRef = useRef(null);

    useEffect(() => {
        fetchMachines();
    }, []);

    const fetchMachines = async () => {
        try {
            const response = await adminAPI.getAllMachines();
            setMachines(response.data);
        } catch (error) {
            console.error('Error fetching machines:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleOpenModal = (machine = null) => {
        if (machine) {
            setEditingMachine(machine);
            setFormData({
                name: machine.name || '',
                name_mm: machine.name_mm || '',
                code: machine.code,
                description: machine.description || '',
                description_mm: machine.description_mm || '',
                is_active: machine.is_active,
            });
        } else {
            setEditingMachine(null);
            setFormData({
                name: '',
                name_mm: '',
                code: '',
                description: '',
                description_mm: '',
                is_active: true,
            });
        }
        setLayoutImageFile(null);
        setRemoveLayoutImage(false);
        setShowModal(true);
    };

    const handleCloseModal = () => {
        setShowModal(false);
        setEditingMachine(null);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        await run(async () => {
        try {
            const data = new FormData();
            Object.keys(formData).forEach((key) => {
                // Exclude layout_image from formData - we handle it separately
                if (key !== 'layout_image' && formData[key] !== null && formData[key] !== '') {
                    if (typeof formData[key] === 'boolean') {
                        data.append(key, formData[key] ? '1' : '0');
                    } else {
                        data.append(key, formData[key]);
                    }
                }
            });
            data.append('order', '0');
            
            // Only append layout_image if there's a new file
            if (layoutImageFile) {
                data.append('layout_image', layoutImageFile);
            }
            
            // Handle removal of existing image
            if (editingMachine && removeLayoutImage) {
                data.append('remove_layout_image', '1');
            }

            if (editingMachine) {
                await adminAPI.updateMachine(editingMachine.id, data);
            } else {
                await adminAPI.createMachine(data);
            }

            handleCloseModal();
            fetchMachines();
            showSuccess(editingMachine ? t('admin.machineUpdated') : t('admin.machineCreated'));
        } catch (error) {
            console.error('Error saving machine:', error);
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
            t('admin.confirmDeleteMachine'),
            null,
            async () => {
                try {
                    await adminAPI.deleteMachine(id);
                    fetchMachines();
                    showSuccess(t('admin.machineDeleted'));
                } catch (error) {
                    console.error('Error deleting machine:', error);
                    let errorMessage = t('errors.cannotDelete');
                    if (error.response?.data?.message) {
                        errorMessage = error.response.data.message;
                    }
                    showError(errorMessage);
                }
            }
        );
    };

    // Zone management functions
    const handleManageZones = async (machine) => {
        setSelectedMachine(machine);
        try {
            const response = await adminAPI.getAllMachineZones(machine.id);
            setZones(response.data);
        } catch (error) {
            console.error('Error fetching zones:', error);
        }
    };

    const handleCloseZoneModal = () => {
        setShowZoneModal(false);
        setEditingZone(null);
        setZoneFormData({
            name: '',
            code: '',
            description: '',
            is_active: true,
        });
    };

    const handleOpenZoneModal = (zone = null) => {
        if (zone) {
            setEditingZone(zone);
            setZoneFormData({
                name: zone.name || '',
                name_mm: zone.name_mm || '',
                description: zone.description || '',
                description_mm: zone.description_mm || '',
                is_active: zone.is_active,
            });
        } else {
            setEditingZone(null);
            setZoneFormData({
                name: '',
                name_mm: '',
                description: '',
                description_mm: '',
                is_active: true,
            });
        }
        setZoneImageFile(null);
        setRemoveZoneImage(false);
        setShowZoneModal(true);
    };

    const handleZoneSubmit = async (e) => {
        e.preventDefault();
        await run(async () => {
        try {
            const data = new FormData();
            data.append('machine_id', selectedMachine.id);
            Object.keys(zoneFormData).forEach((key) => {
                // Skip code field - not needed anymore
                if (key === 'code') {
                    return;
                }
                if (zoneFormData[key] !== null && zoneFormData[key] !== '') {
                    if (typeof zoneFormData[key] === 'boolean') {
                        data.append(key, zoneFormData[key] ? '1' : '0');
                    } else {
                        data.append(key, zoneFormData[key]);
                    }
                }
            });
            data.append('order', '0');
            
            if (zoneImageFile) {
                data.append('layout_image', zoneImageFile);
            }

            if (editingZone) {
                await adminAPI.updateMachineZone(editingZone.id, data);
            } else {
                await adminAPI.createMachineZone(data);
            }

            setZoneImageFile(null);
            handleCloseZoneModal();
            handleManageZones(selectedMachine);
            showSuccess(editingZone ? t('admin.zoneUpdated') : t('admin.zoneCreated'));
        } catch (error) {
            console.error('Error saving zone:', error);
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

    const handleDeleteZone = async (id) => {
        showConfirm(
            t('admin.confirmDeleteZone'),
            null,
            async () => {
                try {
                    await adminAPI.deleteMachineZone(id);
                    handleManageZones(selectedMachine);
                    showSuccess(t('admin.zoneDeleted'));
                } catch (error) {
                    console.error('Error deleting zone:', error);
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
            <AdminLayout>
                <div className="flex min-h-0 w-full min-w-0 flex-1 items-center justify-center bg-gray-50 px-4 py-12">
                    <div className="text-lg text-gray-600 sm:text-xl">{t('common.loading')}</div>
                </div>
            </AdminLayout>
        );
    }

    return (
        <AdminLayout>
            <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col bg-gray-50 px-3 py-6 sm:px-4 lg:px-6 sm:py-8">
                <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <h1 className="text-xl font-bold sm:text-2xl">{t('admin.manageMachines')}</h1>
                    <button
                        type="button"
                        onClick={() => handleOpenModal()}
                        className="w-full shrink-0 rounded-lg bg-blue-600 px-4 py-2.5 text-white hover:bg-blue-700 sm:w-auto"
                    >
                        + {t('admin.addMachine')}
                    </button>
                </div>

                <div className="overflow-hidden rounded-lg border border-gray-100 bg-white shadow-md">
                    <div className="overflow-x-auto">
                    <table className="min-w-[640px] w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('common.code')}</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('common.name')}</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('common.status')}</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">{t('common.edit')}</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {machines.map((machine) => (
                                <tr key={machine.id}>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                        {machine.code}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                        {machine.name}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        <span className={`px-2 py-1 text-xs rounded-full ${
                                            machine.is_active
                                                ? 'bg-green-100 text-green-800'
                                                : 'bg-red-100 text-red-800'
                                        }`}>
                                            {machine.is_active ? t('common.active') : t('common.inactive')}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                        <button
                                            onClick={() => handleManageZones(machine)}
                                            className="text-green-600 hover:text-green-900 mr-4"
                                        >
                                            {t('admin.manageZones')}
                                        </button>
                                        <button
                                            onClick={() => handleOpenModal(machine)}
                                            className="text-blue-600 hover:text-blue-900 mr-4"
                                        >
                                            {t('common.edit')}
                                        </button>
                                        <button
                                            onClick={() => handleDelete(machine.id)}
                                            className="text-red-600 hover:text-red-900"
                                        >
                                            {t('common.delete')}
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    </div>
                </div>

                {/* Modal */}
                {showModal && (
                    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                        <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                            <div className="p-6">
                                <h2 className="text-2xl font-bold mb-4">
                                    {editingMachine ? t('admin.editMachine') : t('admin.addMachine')}
                                </h2>
                                <form onSubmit={handleSubmit} className="space-y-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">
                                            {t('admin.machineCode')} <span className="text-red-500">*</span>
                                        </label>
                                        <input
                                            type="text"
                                            required
                                            value={formData.code}
                                            onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        />
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                                {t('admin.machineNameThai')} <span className="text-red-500">*</span>
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
                                                {t('admin.machineNameMyanmar')}
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
                                                {t('admin.machineDescriptionThai')}
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
                                                {t('admin.machineDescriptionMyanmar')}
                                            </label>
                                            <textarea
                                                rows={3}
                                                value={formData.description_mm}
                                                onChange={(e) => setFormData({ ...formData, description_mm: e.target.value })}
                                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                            />
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">
                                            {t('admin.machineLayoutImage')}
                                        </label>
                                        <input
                                            ref={layoutImageFileInputRef}
                                            type="file"
                                            accept="image/*"
                                            onChange={(e) => setLayoutImageFile(e.target.files[0])}
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                                        />
                                        <MediaPreview 
                                            file={layoutImageFile} 
                                            existingPath={editingMachine?.layout_image && !layoutImageFile && !removeLayoutImage ? editingMachine.layout_image : null} 
                                            type="image"
                                            onRemove={layoutImageFile ? () => {
                                                setLayoutImageFile(null);
                                                if (layoutImageFileInputRef.current) layoutImageFileInputRef.current.value = '';
                                            } : null}
                                            onRemoveExisting={editingMachine?.layout_image && !layoutImageFile && !removeLayoutImage ? () => {
                                                setRemoveLayoutImage(true);
                                            } : null}
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">
                                            {t('common.status')}
                                        </label>
                                        <select
                                            value={formData.is_active ? '1' : '0'}
                                            onChange={(e) => setFormData({ ...formData, is_active: e.target.value === '1' })}
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        >
                                            <option value="1">{t('common.active')}</option>
                                            <option value="0">{t('common.inactive')}</option>
                                        </select>
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

                {/* Zone Management Modal */}
                {selectedMachine && (
                    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                        <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
                            <div className="p-6">
                                <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                    <h2 className="break-words pr-2 text-lg font-bold sm:text-2xl">
                                        {t('admin.manageZonesFor')} {selectedMachine.code} ({selectedMachine.name})
                                    </h2>
                                    <div className="flex w-full shrink-0 flex-col gap-2 sm:flex-row sm:justify-end">
                                        <button
                                            onClick={() => handleOpenZoneModal()}
                                            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
                                        >
                                            + {t('admin.addZone')}
                                        </button>
                                        <button
                                            onClick={() => setSelectedMachine(null)}
                                            className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
                                        >
                                            {t('common.close')}
                                        </button>
                                    </div>
                                </div>

                                <div className="mb-4 overflow-hidden rounded-lg border border-gray-100 bg-white shadow-md">
                                    <div className="overflow-x-auto">
                                    <table className="min-w-[560px] w-full divide-y divide-gray-200">
                                        <thead className="bg-gray-50">
                                            <tr>
                                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('common.name')}</th>
                                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('common.status')}</th>
                                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">{t('common.edit')}</th>
                                            </tr>
                                        </thead>
                                        <tbody className="bg-white divide-y divide-gray-200">
                                            {zones.length === 0 ? (
                                                <tr>
                                                    <td colSpan="4" className="px-6 py-4 text-center text-gray-500">
                                                        {t('admin.noZones')}
                                                    </td>
                                                </tr>
                                            ) : (
                                                zones.map((zone) => (
                                                    <tr key={zone.id}>
                                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                                            {zone.name}
                                                        </td>
                                                        <td className="px-6 py-4 whitespace-nowrap">
                                                            <span className={`px-2 py-1 text-xs rounded-full ${
                                                                zone.is_active
                                                                    ? 'bg-green-100 text-green-800'
                                                                    : 'bg-red-100 text-red-800'
                                                            }`}>
                                                                {zone.is_active ? t('common.active') : t('common.inactive')}
                                                            </span>
                                                        </td>
                                                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                                            <button
                                                                onClick={() => handleOpenZoneModal(zone)}
                                                                className="text-blue-600 hover:text-blue-900 mr-4"
                                                            >
                                                                {t('common.edit')}
                                                            </button>
                                                            <button
                                                                onClick={() => handleDeleteZone(zone.id)}
                                                                className="text-red-600 hover:text-red-900"
                                                            >
                                                                {t('common.delete')}
                                                            </button>
                                                        </td>
                                                    </tr>
                                                ))
                                            )}
                                        </tbody>
                                    </table>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Zone Form Modal */}
                {showZoneModal && (
                    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60] p-4">
                        <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                            <div className="p-6">
                                <h2 className="text-2xl font-bold mb-4">
                                    {editingZone ? t('admin.editZone') : t('admin.addZone')}
                                </h2>
                                <form onSubmit={handleZoneSubmit} className="space-y-4">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                                {t('admin.zoneNameThai')} <span className="text-red-500">*</span>
                                            </label>
                                            <input
                                                type="text"
                                                required
                                                value={zoneFormData.name}
                                                onChange={(e) => setZoneFormData({ ...zoneFormData, name: e.target.value })}
                                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                            />
                                        </div>

                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                                {t('admin.zoneNameMyanmar')}
                                            </label>
                                            <input
                                                type="text"
                                                value={zoneFormData.name_mm}
                                                onChange={(e) => setZoneFormData({ ...zoneFormData, name_mm: e.target.value })}
                                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                            />
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                                {t('admin.zoneDescriptionThai')}
                                            </label>
                                            <textarea
                                                rows={3}
                                                value={zoneFormData.description}
                                                onChange={(e) => setZoneFormData({ ...zoneFormData, description: e.target.value })}
                                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                            />
                                        </div>

                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                                {t('admin.zoneDescriptionMyanmar')}
                                            </label>
                                            <textarea
                                                rows={3}
                                                value={zoneFormData.description_mm}
                                                onChange={(e) => setZoneFormData({ ...zoneFormData, description_mm: e.target.value })}
                                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                            />
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">
                                            {t('admin.zoneLayoutImage')}
                                        </label>
                                        <input
                                            ref={zoneImageFileInputRef}
                                            type="file"
                                            accept="image/*"
                                            onChange={(e) => setZoneImageFile(e.target.files[0])}
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                                        />
                                        <MediaPreview 
                                            file={zoneImageFile} 
                                            existingPath={editingZone?.layout_image && !zoneImageFile && !removeZoneImage ? editingZone.layout_image : null} 
                                            type="image"
                                            onRemove={zoneImageFile ? () => {
                                                setZoneImageFile(null);
                                                if (zoneImageFileInputRef.current) zoneImageFileInputRef.current.value = '';
                                            } : null}
                                            onRemoveExisting={editingZone?.layout_image && !zoneImageFile && !removeZoneImage ? () => {
                                                setRemoveZoneImage(true);
                                            } : null}
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">
                                            {t('common.status')}
                                        </label>
                                        <select
                                            value={zoneFormData.is_active ? '1' : '0'}
                                            onChange={(e) => setZoneFormData({ ...zoneFormData, is_active: e.target.value === '1' })}
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        >
                                            <option value="1">{t('common.active')}</option>
                                            <option value="0">{t('common.inactive')}</option>
                                        </select>
                                    </div>

                                    <div className="flex gap-4 pt-4">
                                        <button
                                            type="button"
                                            onClick={handleCloseZoneModal}
                                            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                                        >
                                            {t('common.cancel')}
                                        </button>
                                        <button
                                            type="submit"
                                            disabled={isSubmitting}
                                            className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            {isSubmitting ? t('common.loading') : t('common.save')}
                                        </button>
                                    </div>
                                </form>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </AdminLayout>
    );
};

export default MachinesManagement;

