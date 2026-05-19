import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { publicAPI } from '../api';
import PublicLayout from '../components/PublicLayout';
import BackButton from '../components/BackButton';
import { useLanguage } from '../contexts/LanguageContext';
import { useTranslation } from '../utils/translations';
import { getLocalized } from '../utils/languageHelper';

const MachineZoneProblemDetail = () => {
    const { id } = useParams();
    const { language } = useLanguage();
    const { t } = useTranslation(language);
    const [problem, setProblem] = useState(null);
    const [loading, setLoading] = useState(true);
    const [showQR, setShowQR] = useState(false);
    const [qrSize, setQrSize] = useState(256);

    useEffect(() => {
        const mq = window.matchMedia('(max-width: 419px)');
        const apply = () => setQrSize(mq.matches ? 200 : 256);
        apply();
        mq.addEventListener('change', apply);
        return () => mq.removeEventListener('change', apply);
    }, []);

    useEffect(() => {
        fetchProblem();
    }, [id]);

    const fetchProblem = async () => {
        setLoading(true);
        try {
            const response = await publicAPI.getMachineZoneProblem(id);
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
                <div className="flex min-h-0 w-full min-w-0 flex-1 items-center justify-center bg-gray-50 px-4">
                    <div className="text-lg sm:text-xl">{t('common.loading')}</div>
                </div>
            </PublicLayout>
        );
    }

    if (!problem) {
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
                    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <BackButton to={`/machine-zones/${problem.machine_zone_id}`} />
                        <button
                            type="button"
                            onClick={() => setShowQR(!showQR)}
                            className="w-full shrink-0 rounded-lg bg-blue-600 px-4 py-2.5 text-center text-sm text-white shadow-md transition-colors duration-200 hover:bg-blue-700 hover:shadow-lg sm:w-auto sm:py-2"
                        >
                            {showQR ? t('common.hide') : t('common.show')} {t('qrCode.title')}
                        </button>
                    </div>
                    {showQR && (
                        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                            <div className="w-full max-w-md rounded-lg bg-white p-5 sm:p-8">
                                <h3 className="mb-4 text-center text-xl font-bold sm:text-2xl">{t('qrCode.title')}</h3>
                                <div className="mb-4 flex justify-center">
                                    <QRCodeSVG value={getQRCodeUrl()} size={qrSize} />
                                </div>
                                <p className="mb-4 text-center text-sm text-gray-600 sm:text-base">
                                    {t('qrCode.scanToOpen')}
                                </p>
                                <button
                                    type="button"
                                    onClick={() => setShowQR(false)}
                                    className="w-full rounded-lg bg-blue-600 py-2.5 text-white hover:bg-blue-700"
                                >
                                    {t('common.close')}
                                </button>
                            </div>
                        </div>
                    )}
                    {/* ส่วนที่ 1: ข้อมูลปัญหา */}
                    <div className="mb-6 rounded-xl border border-gray-100 bg-red-100 p-4 shadow-xl sm:mb-8 sm:p-6 lg:p-8">
                        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 md:gap-8">
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
                                {/* Machine and Zone Info and Views */}
                                <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                    <span className="min-w-0 break-words rounded-full bg-blue-50 px-3 py-1 text-sm text-blue-600">
                                        {problem.zone?.machine?.code} → {getLocalized(problem.zone, 'code', language) || getLocalized(problem.zone, 'name', language)}
                                    </span>
                                    <span className="text-sm text-gray-500">
                                        👁️ {problem.views || 0} {t('common.times')}
                                    </span>
                                </div>
                                {/* Title */}
                                <h2 className="mb-4 text-2xl font-bold leading-tight sm:text-3xl">{getLocalized(problem, 'title', language)}</h2>
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
                        <div className="rounded-xl border border-gray-100 bg-green-100 p-4 shadow-xl sm:p-6 lg:p-8">
                            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 md:gap-8">
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
                                        <div className="mb-6 rounded-lg bg-gray-100 p-4 sm:p-6">
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

export default MachineZoneProblemDetail;

