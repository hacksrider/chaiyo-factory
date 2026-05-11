import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminAPI } from '../../api';
import AdminLayout from '../../components/AdminLayout';
import { useLanguage } from '../../contexts/LanguageContext';
import { useTranslation } from '../../utils/translations';
import { useAlert } from '../../contexts/AlertContext';
import { formatValidationErrors } from '../../utils/errorTranslator';
import MediaPreview from '../../components/MediaPreview';

const ProblemsManagement = () => {
    const navigate = useNavigate();
    const { language } = useLanguage();
    const { t } = useTranslation(language);
    const { showSuccess, showError, showConfirm } = useAlert();
    const [problems, setProblems] = useState([]);
    const [categories, setCategories] = useState([]);
    const [machines, setMachines] = useState([]);
    const [zones, setZones] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [editingProblem, setEditingProblem] = useState(null);
    const [formData, setFormData] = useState({
        title: '',
        title_mm: '',
        description: '',
        description_mm: '',
        category_id: '',
        solution_text: '',
        solution_text_mm: '',
        is_active: true,
    });
    const [selectedMachineId, setSelectedMachineId] = useState('');
    const [selectedZoneId, setSelectedZoneId] = useState('');
    const [videoFile, setVideoFile] = useState(null);
    const [solutionVideoFile, setSolutionVideoFile] = useState(null);
    const [removeVideo, setRemoveVideo] = useState(false);
    const [removeSolutionVideo, setRemoveSolutionVideo] = useState(false);
    const videoFileInputRef = React.useRef(null);
    const solutionVideoFileInputRef = React.useRef(null);

    useEffect(() => {
        fetchData();
    }, [searchTerm]);

    // Check if category is machine category
    const isMachineCategory = (categoryId) => {
        if (!categoryId) return false;
        const category = categories.find(cat => cat.id === parseInt(categoryId));
        if (!category) return false;
        const categoryName = (category.name || '').toLowerCase();
        const categorySlug = (category.slug || '').toLowerCase();
        return categoryName.includes('เครื่องจักร') || 
               categorySlug.includes('machine') || 
               categoryName.includes('machine');
    };

    // Find machine category
    const getMachineCategory = () => {
        return categories.find(cat => {
            const categoryName = (cat.name || '').toLowerCase();
            const categorySlug = (cat.slug || '').toLowerCase();
            return categoryName.includes('เครื่องจักร') || 
                   categorySlug.includes('machine') || 
                   categoryName.includes('machine');
        });
    };

    // Fetch machines when category is selected as machine category
    useEffect(() => {
        const fetchMachines = async () => {
            if (categories.length > 0 && isMachineCategory(formData.category_id)) {
                try {
                    const response = await adminAPI.getAllMachines();
                    setMachines(response.data || []);
                } catch (error) {
                    console.error('Error fetching machines:', error);
                    setMachines([]);
                }
            } else {
                setMachines([]);
            }
        };
        fetchMachines();
    }, [formData.category_id, categories]);

    // Fetch zones when machine is selected
    useEffect(() => {
        const fetchZones = async () => {
            if (selectedMachineId && isMachineCategory(formData.category_id)) {
                try {
                    const response = await adminAPI.getAllMachineZones(selectedMachineId);
                    setZones(response.data || []);
                } catch (error) {
                    console.error('Error fetching zones:', error);
                    setZones([]);
                }
            } else {
                setZones([]);
            }
        };
        fetchZones();
    }, [selectedMachineId, formData.category_id]);

    const fetchData = async () => {
        try {
            setLoading(true);
            const params = searchTerm ? { search: searchTerm } : {};
            const [problemsRes, categoriesRes] = await Promise.all([
                adminAPI.getAllProblems(params),
                adminAPI.getAllCategories(),
            ]);
            setProblems(problemsRes.data.data || problemsRes.data);
            setCategories(categoriesRes.data);
        } catch (error) {
            console.error('Error fetching data:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleOpenModal = (problem = null) => {
        if (problem) {
            setEditingProblem(problem);
            const newFormData = {
                title: problem.title || '',
                title_mm: problem.title_mm || '',
                description: problem.description || '',
                description_mm: problem.description_mm || '',
                category_id: problem.category_id,
                solution_text: problem.solution_text || '',
                solution_text_mm: problem.solution_text_mm || '',
                is_active: problem.is_active,
            };
            setFormData(newFormData);
            // For machine zone problems, set machine and zone
            if (problem.is_machine_zone_problem && problem.machine && problem.zone) {
                setSelectedMachineId(problem.machine.id);
                setSelectedZoneId(problem.zone.id);
            } else {
                setSelectedMachineId('');
                setSelectedZoneId('');
            }
        } else {
            setEditingProblem(null);
            // Set default category to machine category if available
            const machineCategory = getMachineCategory();
            setFormData({
                title: '',
                title_mm: '',
                description: '',
                description_mm: '',
                category_id: machineCategory?.id || '',
                solution_text: '',
                solution_text_mm: '',
                is_active: true,
            });
            setSelectedMachineId('');
            setSelectedZoneId('');
        }
        setVideoFile(null);
        setSolutionVideoFile(null);
        setRemoveVideo(false);
        setRemoveSolutionVideo(false);
        // Reset file input elements
        if (videoFileInputRef.current) {
            videoFileInputRef.current.value = '';
        }
        if (solutionVideoFileInputRef.current) {
            solutionVideoFileInputRef.current.value = '';
        }
        setShowModal(true);
    };

    const handleCloseModal = () => {
        setShowModal(false);
        setEditingProblem(null);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            // Determine if this should be a machine zone problem
            // It's a machine zone problem ONLY if:
            // Category is machine category AND a zone is selected
            // We don't check editingProblem.is_machine_zone_problem because the user might be changing the category
            const isMachineZoneProblem = isMachineCategory(formData.category_id) && selectedZoneId;
            
            // Validate: if category is machine category, zone must be selected
            if (isMachineCategory(formData.category_id) && !selectedZoneId) {
                showError(t('errors.fieldRequired', { field: t('admin.zone') || t('admin.selectZone') }));
                return;
            }
            const data = new FormData();
            
            if (isMachineZoneProblem) {
                // For machine zone problems, we need machine_zone_id
                if (editingProblem) {
                    // If editing and changing category to machine category, use selected zone
                    // Otherwise, use existing machine_zone_id
                    if (selectedZoneId) {
                        data.append('machine_zone_id', selectedZoneId);
                    } else {
                        data.append('machine_zone_id', editingProblem.machine_zone_id);
                    }
                } else if (selectedZoneId) {
                    data.append('machine_zone_id', selectedZoneId);
                }
            }
            
            // Always append required fields first - ensure they are not undefined
            const title = formData.title !== undefined && formData.title !== null ? String(formData.title) : '';
            const description = formData.description !== undefined && formData.description !== null ? String(formData.description) : '';
            
            // Validate required fields
            if (!title.trim()) {
                showError(t('errors.fieldRequired', { field: t('admin.problemTitle') || t('problems.title') }));
                return;
            }
            
            // Description is required for both regular problems and machine zone problems
            if (!description.trim()) {
                showError(t('errors.fieldRequired', { field: t('admin.problemDescription') || t('problems.description') }));
                return;
            }
            
            data.append('title', title);
            data.append('description', description);
            
            // Append other fields
            Object.keys(formData).forEach((key) => {
                // Skip category_id - we handle it separately
                if (key === 'category_id') {
                    return;
                }
                
                // Skip title and description as we already appended them
                if (key === 'title' || key === 'description') {
                    return;
                }
                
                // Skip video fields - we handle them separately
                if (key === 'video' || key === 'solution_video' || key === 'video_path' || key === 'solution_video_path') {
                    return;
                }
                
                // Send other fields if they have values
                if (formData[key] !== null && formData[key] !== '' && formData[key] !== undefined) {
                    // Convert boolean to 1/0 for FormData
                    if (typeof formData[key] === 'boolean') {
                        data.append(key, formData[key] ? '1' : '0');
                    } else {
                        data.append(key, String(formData[key]));
                    }
                }
            });
            
            // Append category_id only for regular problems (not machine zone problems)
            if (!isMachineZoneProblem && formData.category_id) {
                data.append('category_id', formData.category_id);
            }
            
            // Set default order to 0
            data.append('order', '0');
            
            if (videoFile) {
                data.append('video', videoFile);
            }
            if (solutionVideoFile) {
                data.append('solution_video', solutionVideoFile);
            }
            
            // Handle removal of existing files
            if (editingProblem) {
                if (removeVideo) {
                    data.append('remove_video', '1');
                }
                if (removeSolutionVideo) {
                    data.append('remove_solution_video', '1');
                }
            }

            let response;
            if (editingProblem) {
                // Check if problem type is changing
                const wasMachineZoneProblem = editingProblem.is_machine_zone_problem === true;
                const isChangingType = wasMachineZoneProblem !== isMachineZoneProblem;
                
                if (isChangingType) {
                    // If changing type, delete old and create new
                    if (wasMachineZoneProblem) {
                        // Delete machine zone problem and create regular problem
                        await adminAPI.deleteMachineZoneProblem(editingProblem.id);
                        response = await adminAPI.createProblem(data);
                    } else {
                        // Delete regular problem and create machine zone problem
                        await adminAPI.deleteProblem(editingProblem.id);
                        response = await adminAPI.createMachineZoneProblem(data);
                    }
                } else {
                    // Same type, just update
                    if (isMachineZoneProblem) {
                        response = await adminAPI.updateMachineZoneProblem(editingProblem.id, data);
                    } else {
                        response = await adminAPI.updateProblem(editingProblem.id, data);
                    }
                }
            } else {
                if (isMachineZoneProblem) {
                    response = await adminAPI.createMachineZoneProblem(data);
                } else {
                    response = await adminAPI.createProblem(data);
                }
            }

            handleCloseModal();
            fetchData();
            showSuccess(editingProblem ? t('admin.problemUpdated') : t('admin.problemCreated'));
        } catch (error) {
            console.error('Error saving problem:', error);
            let errorMessage = t('errors.cannotSave');
            
            if (error.response?.data?.errors) {
                errorMessage = formatValidationErrors(error.response.data.errors, t) || errorMessage;
            } else if (error.response?.data?.message) {
                errorMessage = error.response.data.message;
            }
            
            showError(errorMessage);
        }
    };

    const handleDelete = async (problem) => {
        showConfirm(
            t('admin.confirmDeleteProblem'),
            null,
            async () => {
                try {
                    const isMachineZoneProblem = problem.is_machine_zone_problem === true;
                    if (isMachineZoneProblem) {
                        await adminAPI.deleteMachineZoneProblem(problem.id);
                    } else {
                        await adminAPI.deleteProblem(problem.id);
                    }
                    fetchData();
                    showSuccess(t('admin.problemDeleted'));
                } catch (error) {
                    console.error('Error deleting problem:', error);
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
        return <div className="text-center py-12">{t('common.loading')}</div>;
    }

    return (
        <AdminLayout>
            <div className="mx-auto w-full max-w-[1920px] px-3 py-6 sm:px-4 lg:px-6 sm:py-8">
                <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <h1 className="text-xl font-bold sm:text-2xl">{t('admin.manageProblems')}</h1>
                    <button
                        type="button"
                        onClick={() => handleOpenModal()}
                        className="w-full shrink-0 rounded-lg bg-blue-600 px-4 py-2.5 text-white hover:bg-blue-700 sm:w-auto"
                    >
                        + {t('admin.addProblem')}
                    </button>
                </div>
                
                {/* Search */}
                <div className="mb-6">
                    <input
                        type="text"
                        placeholder={t('admin.searchProblems')}
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full max-w-md rounded-lg border border-gray-300 px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                </div>
                <div className="overflow-hidden rounded-lg border border-gray-100 bg-white shadow-md">
                    <div className="overflow-x-auto">
                    <table className="min-w-[900px] w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('admin.problemTitle')}</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('problems.category')}</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">เครื่องจักร/โซน</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('common.views')}</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('common.status')}</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('admin.lastUpdatedBy')}</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">{t('common.edit')}</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {problems.map((problem) => {
                                const isMachineZoneProblem = problem.is_machine_zone_problem === true;
                                return (
                                    <tr key={isMachineZoneProblem ? `machine-zone-${problem.id}` : `problem-${problem.id}`}>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="text-sm font-medium text-gray-900">{problem.title}</div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="text-sm text-gray-500">
                                                {problem.category?.name || (isMachineZoneProblem ? 'เครื่องจักร' : '-')}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            {isMachineZoneProblem && problem.machine && problem.zone ? (
                                                <div className="text-sm text-gray-500">
                                                    <div className="font-medium">{problem.machine.code || problem.machine.name}</div>
                                                    <div className="text-xs text-gray-400">→ {problem.zone.code || problem.zone.name}</div>
                                                </div>
                                            ) : (
                                                <div className="text-sm text-gray-400">-</div>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="text-sm text-gray-500">{problem.views || 0}</div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <span className={`px-2 py-1 text-xs rounded-full ${
                                                problem.is_active
                                                    ? 'bg-green-100 text-green-800'
                                                    : 'bg-red-100 text-red-800'
                                            }`}>
                                                {problem.is_active ? t('common.active') : t('common.inactive')}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="text-sm text-gray-500">
                                                {problem.updated_by_user?.name || problem.updated_by_user?.username || '-'}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                            <button
                                                onClick={() => handleOpenModal(problem)}
                                                className="text-blue-600 hover:text-blue-900 mr-4"
                                            >
                                                {t('common.edit')}
                                            </button>
                                            <button
                                                onClick={() => handleDelete(problem)}
                                                className="text-red-600 hover:text-red-900"
                                            >
                                                {t('common.delete')}
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
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
                                {editingProblem ? t('admin.editProblem') : t('admin.addProblem')}
                            </h2>
                            <form onSubmit={handleSubmit} className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                        {t('problems.category')}
                                    </label>
                                    <select
                                        value={formData.category_id}
                                        onChange={(e) => {
                                            setFormData({ ...formData, category_id: e.target.value });
                                            // Reset machine and zone when category changes
                                            setSelectedMachineId('');
                                            setSelectedZoneId('');
                                        }}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    >
                                        {categories.map((cat) => (
                                            <option key={cat.id} value={cat.id}>
                                                {cat.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                {/* Machine and Zone Selection for Machine Category */}
                                {isMachineCategory(formData.category_id) && (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                                {t('admin.machine')} <span className="text-red-500">*</span>
                                            </label>
                                            <select
                                                required
                                                value={selectedMachineId}
                                                onChange={(e) => {
                                                    setSelectedMachineId(e.target.value);
                                                    setSelectedZoneId(''); // Reset zone when machine changes
                                                }}
                                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                            >
                                                <option value="">{t('admin.selectMachine')}</option>
                                                {machines.map((machine) => (
                                                    <option key={machine.id} value={machine.id}>
                                                        {machine.code || machine.name}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                                {t('admin.zone')} <span className="text-red-500">*</span>
                                            </label>
                                            <select
                                                required
                                                value={selectedZoneId}
                                                onChange={(e) => setSelectedZoneId(e.target.value)}
                                                disabled={!selectedMachineId}
                                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
                                            >
                                                <option value="">{selectedMachineId ? t('admin.selectZone') : t('admin.selectMachineFirst')}</option>
                                                {zones.map((zone) => (
                                                    <option key={zone.id} value={zone.id}>
                                                        {zone.name}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>
                                )}

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">
                                            {t('admin.titleThai')} <span className="text-red-500">*</span>
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
                                            {t('admin.titleMyanmar')}
                                        </label>
                                        <input
                                            type="text"
                                            value={formData.title_mm}
                                            onChange={(e) => setFormData({ ...formData, title_mm: e.target.value })}
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        />
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">
                                            {t('admin.descriptionThai')} <span className="text-red-500">*</span>
                                        </label>
                                        <textarea
                                            rows={4}
                                            value={formData.description}
                                            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">
                                            {t('admin.descriptionMyanmar')}
                                        </label>
                                        <textarea
                                            rows={4}
                                            value={formData.description_mm}
                                            onChange={(e) => setFormData({ ...formData, description_mm: e.target.value })}
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        />
                                    </div>
                                </div>
                                
                                {editingProblem?.is_machine_zone_problem && (
                                    <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                                        <div className="text-sm text-green-800">
                                            <strong>{t('admin.machineZoneProblem')}:</strong> {editingProblem.machine?.code || editingProblem.machine?.name} → {editingProblem.zone?.code || editingProblem.zone?.name}
                                        </div>
                                    </div>
                                )}

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                        {t('admin.problemVideo')} {!editingProblem && `(${t('common.optional')})`}
                                    </label>
                                    <input
                                        ref={videoFileInputRef}
                                        type="file"
                                        accept="video/*"
                                        onChange={(e) => setVideoFile(e.target.files[0])}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                                    />
                                    <MediaPreview 
                                        file={videoFile} 
                                        existingPath={editingProblem?.video_path && !videoFile && !removeVideo ? editingProblem.video_path : null} 
                                        type="video"
                                        onRemove={videoFile ? () => {
                                            setVideoFile(null);
                                            if (videoFileInputRef.current) videoFileInputRef.current.value = '';
                                        } : null}
                                        onRemoveExisting={editingProblem?.video_path && !videoFile && !removeVideo ? () => {
                                            setRemoveVideo(true);
                                        } : null}
                                    />
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">
                                            {t('admin.solutionTextThai')}
                                        </label>
                                        <textarea
                                            rows={4}
                                            value={formData.solution_text}
                                            onChange={(e) => setFormData({ ...formData, solution_text: e.target.value })}
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">
                                            {t('admin.solutionTextMyanmar')}
                                        </label>
                                        <textarea
                                            rows={4}
                                            value={formData.solution_text_mm}
                                            onChange={(e) => setFormData({ ...formData, solution_text_mm: e.target.value })}
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                        {t('admin.solutionVideo')}
                                    </label>
                                    <input
                                        ref={solutionVideoFileInputRef}
                                        type="file"
                                        accept="video/*"
                                        onChange={(e) => setSolutionVideoFile(e.target.files[0])}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                                    />
                                    <MediaPreview 
                                        file={solutionVideoFile} 
                                        existingPath={editingProblem?.solution_video_path && !solutionVideoFile && !removeSolutionVideo ? editingProblem.solution_video_path : null} 
                                        type="video"
                                        onRemove={solutionVideoFile ? () => {
                                            setSolutionVideoFile(null);
                                            if (solutionVideoFileInputRef.current) solutionVideoFileInputRef.current.value = '';
                                        } : null}
                                        onRemoveExisting={editingProblem?.solution_video_path && !solutionVideoFile && !removeSolutionVideo ? () => {
                                            setRemoveSolutionVideo(true);
                                        } : null}
                                    />
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
                                        className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                                    >
                                            {t('common.save')}
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

export default ProblemsManagement;

