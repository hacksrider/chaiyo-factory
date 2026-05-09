import React, { useState, useEffect } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { publicAPI } from '../api';
import PublicLayout from '../components/PublicLayout';
import BackButton from '../components/BackButton';
import { useLanguage } from '../contexts/LanguageContext';
import { useTranslation } from '../utils/translations';
import { getLocalized } from '../utils/languageHelper';

const ProblemDetail = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const { id } = useParams();
    const { language } = useLanguage();
    const { t } = useTranslation(language);
    const [problem, setProblem] = useState(null);
    const [loading, setLoading] = useState(true);
    const [showQR, setShowQR] = useState(false);

    // Determine back path based on referrer
    const getBackPath = () => {
        const state = location.state;
        if (state?.from) return state.from;
        return '/problems';
    };

    useEffect(() => {
        fetchProblem();
    }, [id]);

    const fetchProblem = async () => {
        setLoading(true);
        try {
            const response = await publicAPI.getProblem(id);
            setProblem(response.data);
        } catch (error) {
            console.error('Error fetching problem:', error);
        } finally {
            setLoading(false);
        }
    };

    const getVideoUrl = (path) => {
        if (!path) return null;
        return `/storage/${path}`;
    };

    const getQRCodeUrl = () => {
        return window.location.href;
    };

    if (loading) {
        return (
            <PublicLayout>
                <div className="h-full bg-gray-50 flex items-center justify-center">
                    <div className="text-xl">{t('common.loading')}</div>
                </div>
            </PublicLayout>
        );
    }

    if (!problem) {
        return (
            <PublicLayout>
                <div className="h-full bg-gray-50 flex items-center justify-center">
                    <div className="text-xl text-red-600">{t('errors.notFound')}</div>
                </div>
            </PublicLayout>
        );
    }

    return (
        <PublicLayout>
            <div className="h-full bg-gray-50">
                <div className="container mx-auto px-4 py-4">
                    <div className="mb-4 flex justify-between items-center">
                        <BackButton to={getBackPath()} />
                        <button
                            onClick={() => setShowQR(!showQR)}
                            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors duration-200 shadow-md hover:shadow-lg"
                        >
                            {showQR ? t('common.hide') : t('common.show')} {t('qrCode.title')}
                        </button>
                        {/* QR Code Modal */}
                        {showQR && (
                            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                                <div className="bg-white rounded-lg p-8 max-w-md">
                                    <h3 className="text-2xl font-bold mb-4 text-center">{t('qrCode.title')}</h3>
                                    <div className="flex justify-center mb-4">
                                        <QRCodeSVG value={getQRCodeUrl()} size={256} />
                                    </div>
                                    <p className="text-center text-gray-600 mb-4">
                                        {t('qrCode.scanToOpen')}
                                    </p>
                                    <button
                                        onClick={() => setShowQR(false)}
                                        className="w-full bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700"
                                    >
                                        {t('common.close')}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                    {/* ส่วนที่ 1: ข้อมูลปัญหา */}
                    <div className="bg-red-100 rounded-xl shadow-xl p-8 border border-gray-100 mb-8">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            {/* คอลัมน์ที่ 1: วิดีโอ (Problem Video) */}
                            <div className="flex flex-col justify-center">
                                {/* Problem Video */}
                                {problem.video_path ? (
                                    <div>
                                        <h3 className="text-xl font-semibold mb-4">{t('problems.problemVideo')}</h3>
                                        <div className="relative w-full" style={{ paddingBottom: '56.25%' }}>
                                            <video
                                                controls
                                                className="absolute top-0 left-0 w-full h-full rounded-lg"
                                                src={getVideoUrl(problem.video_path)}
                                            >
                                                {t('errors.videoNotSupported')}
                                            </video>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex items-center justify-center h-full text-gray-400 border-2 border-dashed rounded-lg min-h-[200px]">
                                        {t('problems.noVideo')}
                                    </div>
                                )}
                            </div>
                            {/* คอลัมน์ที่ 2: ข้อความรายละเอียด */}
                            <div>
                                {/* Category and Views */}
                                <div className="flex items-center justify-between mb-4">
                                    <span className="text-sm text-blue-600 bg-blue-50 px-3 py-1 rounded-full">
                                        {getLocalized(problem.category, 'name', language)}
                                    </span>
                                    <span className="text-sm text-gray-500">
                                        👁️ {problem.views || 0} {t('common.times')}
                                    </span>
                                </div>
                                {/* Title */}
                                <h2 className="text-3xl font-bold mb-4">{getLocalized(problem, 'title', language)}</h2>
                                {/* Description */}
                                <div className="mb-8">
                                    <h3 className="text-xl font-semibold mb-2">{t('problems.problemDescription')}</h3>
                                    <p className="text-gray-700 whitespace-pre-line">{getLocalized(problem, 'description', language)}</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* ส่วนที่ 2: การแก้ปัญหา (Solution) */}
                    {(getLocalized(problem, 'solution_text', language) || problem.solution_video_path) && (
                        <div className="bg-green-100 rounded-xl shadow-xl p-8 border border-gray-100">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                {/* คอลัมน์ที่ 1: Solution Video */}
                                <div className="flex flex-col justify-center">
                                    {problem.solution_video_path ? (
                                        <div>
                                            <h3 className="text-xl font-semibold mb-4">{t('problems.solutionVideo')}</h3>
                                            <div className="relative w-full" style={{ paddingBottom: '56.25%' }}>
                                                <video
                                                    controls
                                                    className="absolute top-0 left-0 w-full h-full rounded-lg"
                                                    src={getVideoUrl(problem.solution_video_path)}
                                                >
                                                    {t('errors.videoNotSupported')}
                                                </video>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex items-center justify-center h-full text-gray-400 border-2 border-dashed rounded-lg min-h-[200px]">
                                            {t('problems.noVideo')}
                                        </div>
                                    )}
                                </div>
                                {/* คอลัมน์ที่ 2: Solution Text */}
                                <div>
                                    <h3 className="text-xl font-semibold mb-4">
                                        {t('problems.solution')}
                                    </h3>
                                    {getLocalized(problem, 'solution_text', language) && (
                                        <div className="mb-6 bg-gray-100 p-6 rounded-lg">
                                            <h3 className="text-xl font-semibold mb-2">{t('problems.solutionText')}</h3>
                                            <p className="text-gray-700 whitespace-pre-line">
                                                {getLocalized(problem, 'solution_text', language)}
                                            </p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </PublicLayout>
    );
};

export default ProblemDetail;

