import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { publicAPI, adminAPI } from '../api';
import { useAuth } from '../contexts/AuthContext';
import PublicLayout from '../components/PublicLayout';
import BackButton from '../components/BackButton';
import { useLanguage } from '../contexts/LanguageContext';
import { useTranslation } from '../utils/translations';
import { getLocalized } from '../utils/languageHelper';
import MediaPreview from '../components/MediaPreview';
import { useSubmitGuard } from '../hooks/useSubmitGuard';

const MachineZoneDetail = () => {
    const navigate = useNavigate();
    const { id } = useParams();
    const { language } = useLanguage();
    const { t } = useTranslation(language);
    const { isAdmin } = useAuth();
    const { isSubmitting, run } = useSubmitGuard();
    const [zone, setZone] = useState(null);
    const [problems, setProblems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [formData, setFormData] = useState({
        title: '',
        title_mm: '',
        description: '',
        description_mm: '',
        solution_text: '',
        solution_text_mm: '',
        is_active: true,
    });
    const [videoFile, setVideoFile] = useState(null);
    const [solutionVideoFile, setSolutionVideoFile] = useState(null);
    const videoFileInputRef = useRef(null);
    const solutionVideoFileInputRef = useRef(null);

    useEffect(() => {
        fetchZone();
        fetchProblems();
    }, [id]);

    const fetchZone = async () => {
        try {
            const response = await publicAPI.getMachineZone(id);
            setZone(response.data);
        } catch (error) {
            console.error('Error fetching zone:', error);
        }
    };

    const fetchProblems = async () => {
        setLoading(true);
        try {
            const response = await publicAPI.getMachineZoneProblems(id);
            setProblems(response.data);
        } catch (error) {
            console.error('Error fetching problems:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleOpenModal = () => {
        setFormData({
            title: '',
            title_mm: '',
            description: '',
            description_mm: '',
            solution_text: '',
            solution_text_mm: '',
            is_active: true,
        });
        setVideoFile(null);
        setSolutionVideoFile(null);
        setShowModal(true);
    };

    const handleCloseModal = () => {
        setShowModal(false);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        await run(async () => {
            try {
                const data = new FormData();
                data.append('machine_zone_id', id);
                Object.keys(formData).forEach((key) => {
                    if (formData[key] !== null && formData[key] !== '') {
                        if (typeof formData[key] === 'boolean') {
                            data.append(key, formData[key] ? '1' : '0');
                        } else {
                            data.append(key, formData[key]);
                        }
                    }
                });
                data.append('order', '0');
                if (videoFile) data.append('video', videoFile);
                if (solutionVideoFile) data.append('solution_video', solutionVideoFile);

                await adminAPI.createMachineZoneProblem(data);
                handleCloseModal();
                fetchProblems();
            } catch (error) {
                console.error('Error saving problem:', error);
                alert('เกิดข้อผิดพลาด: ' + (error.response?.data?.message || 'ไม่สามารถบันทึกได้'));
            }
        });
    };

    const getVideoUrl = (path) => {
        if (!path) return null;
        return `/storage/${path}`;
    };

    if (loading) {
        return (
            <PublicLayout>
                <div className="flex min-h-0 w-full min-w-0 flex-1 items-center justify-center bg-gray-50 px-4">
                    <div className="text-lg sm:text-xl">{t('common.loading')}</div>
                </div>
            </PublicLayout>
        );
    }

    if (!zone) {
        return (
            <PublicLayout>
                <div className="flex min-h-0 w-full min-w-0 flex-1 items-center justify-center bg-gray-50 px-4">
                    <div className="text-lg text-red-600 sm:text-xl">{t('errors.notFound')}</div>
                </div>
            </PublicLayout>
        );
    }

    return (
        <PublicLayout>
            <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-x-hidden bg-gray-50">
                <div className="w-full px-3 py-4 sm:px-4 sm:py-5 lg:px-6">
                    <div className="mb-4">
                        <BackButton 
                            to={`/machines/${zone.machine?.id || zone.machine_id}`} 
                            label="Back" 
                            className="mb-4" 
                        />
                        <h1 className="text-2xl font-bold leading-tight sm:text-3xl">
                            {zone.code ? `${zone.code} - ` : ''}{getLocalized(zone, 'name', language)}
                        </h1>
                        {getLocalized(zone, 'description', language) && (
                            <p className="text-gray-600 mt-2">{getLocalized(zone, 'description', language)}</p>
                        )}
                    </div>

                    <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:gap-6">
                        {/* Zone Layout Image (Left Column) */}
                        {zone.layout_image && (
                            <div className="w-full lg:w-5/12">
                                <div className="bg-white rounded-xl shadow-xl p-4 h-full border border-gray-100 flex flex-col">
                                    <h2 className="text-xl font-semibold mb-3">{t('machines.zoneLayoutImage')}</h2>
                                    <div className="relative w-full bg-gray-100 rounded-lg overflow-hidden flex-1">
                                        <img
                                            src={`/storage/${zone.layout_image}`}
                                            alt={t('machines.zoneLayoutImage')}
                                            className="w-full h-auto"
                                        />
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Problems Section (Right Column) */}
                        <div className={`w-full ${zone.layout_image ? "lg:w-7/12" : ""}`}>
                            <div className="bg-white rounded-xl shadow-xl p-6 h-full border border-gray-100 flex flex-col">
                                <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                    <h2 className="text-lg font-semibold sm:text-xl">{t('machines.zoneProblems')}</h2>
                                    {isAdmin && (
                                        <button
                                            type="button"
                                            onClick={handleOpenModal}
                                            className="w-full shrink-0 rounded-lg bg-blue-600 px-4 py-2.5 text-sm text-white hover:bg-blue-700 sm:w-auto"
                                        >
                                            + {t('machines.addProblem')}
                                        </button>
                                    )}
                                </div>

                                {problems.length === 0 ? (
                                    <div className="text-center py-12 text-gray-500 flex-grow">
                                        {t('machines.noZoneProblems')}
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-1 gap-4 sm:gap-6 md:grid-cols-2 xl:grid-cols-3 3xl:grid-cols-4">
                                        {problems.map((problem) => (
                                            <div
                                                key={problem.id}
                                                onClick={() => navigate(`/machine-zone-problems/${problem.id}`)}
                                                className="bg-white rounded-xl shadow-md overflow-hidden cursor-pointer hover:shadow-xl hover:-translate-y-1 transition-all duration-300 border border-gray-100"
                                            >
                                                <div className="grid grid-cols-1 min-[520px]:grid-cols-2 gap-0">
                                                    {/* คอลัมน์แรก: วิดีโอปัญหา */}
                                                    <div className="relative bg-gray-100" style={{ paddingBottom: '75%' }}>
                                                        {problem.video_path ? (
                                                            <video
                                                                className="absolute top-0 left-0 w-full h-full object-cover"
                                                                src={getVideoUrl(problem.video_path)}
                                                                controls
                                                                playsInline
                                                            />
                                                        ) : (
                                                            <div className="absolute top-0 left-0 w-full h-full flex items-center justify-center text-gray-400 text-xs">
                                                                {t('problems.noVideo')}
                                                            </div>
                                                        )}
                                                    </div>
                                                    
                                                    {/* คอลัมน์สอง: ข้อมูลปัญหา */}
                                                    <div className="p-3 flex flex-col">
                                                        <div className="flex items-center justify-between mb-2">
                                                            <h3 className="text-base font-semibold line-clamp-2">
                                                                {getLocalized(problem, 'title', language)}
                                                            </h3>
                                                            <span className="text-xs text-gray-500 ml-2">
                                                                👁️ {problem.views || 0}
                                                            </span>
                                                        </div>
                                                        <p className="text-xs text-gray-600 line-clamp-3 mb-2">
                                                            {getLocalized(problem, 'description', language)}
                                                        </p>
                                                        <div className="text-xs font-medium text-green-600">
                                                            {t('common.viewDetails')} →
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Add Problem Modal */}
            {showModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                        <div className="p-6">
                            <h2 className="text-2xl font-bold mb-4">{t('admin.addProblem')}</h2>
                            <form onSubmit={handleSubmit} className="space-y-4">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">
                                            ชื่อปัญหา (ไทย) *
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
                                            ชื่อปัญหา (မြန်မာ)
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
                                            รายละเอียด (ไทย) *
                                        </label>
                                        <textarea
                                            required
                                            rows={4}
                                            value={formData.description}
                                            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">
                                            รายละเอียด (မြန်မာ)
                                        </label>
                                        <textarea
                                            rows={4}
                                            value={formData.description_mm}
                                            onChange={(e) => setFormData({ ...formData, description_mm: e.target.value })}
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                        วิดีโอปัญหา
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
                                        existingPath={null} 
                                        type="video"
                                        onRemove={videoFile ? () => {
                                            setVideoFile(null);
                                            if (videoFileInputRef.current) videoFileInputRef.current.value = '';
                                        } : null}
                                    />
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">
                                            วิธีแก้ไข (ข้อความ) (ไทย)
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
                                            วิธีแก้ไข (ข้อความ) (မြန်မာ)
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
                                        วิดีโอวิธีแก้ไข
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
                                        existingPath={null} 
                                        type="video"
                                        onRemove={solutionVideoFile ? () => {
                                            setSolutionVideoFile(null);
                                            if (solutionVideoFileInputRef.current) solutionVideoFileInputRef.current.value = '';
                                        } : null}
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
        </PublicLayout>
    );
};

export default MachineZoneDetail;

