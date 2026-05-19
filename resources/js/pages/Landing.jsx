import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { publicAPI } from '../api';
import PublicLayout from '../components/PublicLayout';
import { useLanguage } from '../contexts/LanguageContext';
import { useTranslation } from '../utils/translations';
const Landing = () => {
    const navigate = useNavigate();
    const { language } = useLanguage();
    const { t } = useTranslation(language);
    const [homeData, setHomeData] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchHomeData = async () => {
            try {
                const response = await publicAPI.getHome();
                setHomeData(response.data);
            } catch (error) {
                console.error('Error fetching home data:', error);
            } finally {
                setLoading(false);
            }
        };

        fetchHomeData();
    }, []);

    if (loading) {
        return (
            <PublicLayout>
                <div className="flex min-h-0 w-full min-w-0 flex-1 items-center justify-center bg-gray-50 px-4 text-gray-900">
                    <div className="text-lg sm:text-xl">{t('common.loading')}</div>
                </div>
            </PublicLayout>
        );
    }

    return (
        <PublicLayout>
            <div className="relative flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-x-hidden bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50">
                {/* Decorative background elements — ขยาย/หดตามขนาดจอ */}
                <div className="absolute inset-0 overflow-hidden pointer-events-none">
                    <div className="animate-blob absolute left-[5%] top-16 h-[clamp(10rem,28vmin,22rem)] w-[clamp(10rem,28vmin,22rem)] rounded-full bg-blue-200 opacity-20 mix-blend-multiply blur-xl filter sm:left-10 sm:top-20"></div>
                    <div className="animate-blob animation-delay-2000 absolute right-[5%] top-32 h-[clamp(10rem,28vmin,22rem)] w-[clamp(10rem,28vmin,22rem)] rounded-full bg-purple-200 opacity-20 mix-blend-multiply blur-xl filter sm:right-10 sm:top-40"></div>
                    <div className="animate-blob animation-delay-4000 absolute -bottom-8 left-1/2 h-[clamp(10rem,28vmin,22rem)] w-[clamp(10rem,28vmin,22rem)] -translate-x-1/2 rounded-full bg-indigo-200 opacity-20 mix-blend-multiply blur-xl filter"></div>
                </div>

                {/* Main Content Container */}
                <div className="relative flex min-h-0 w-full flex-1 items-center justify-center py-6 sm:py-10">
                    <div className="w-full px-3 sm:px-5 lg:px-8 xl:px-10 2xl:px-12">
                        <div className="grid grid-cols-1 items-center gap-6 md:gap-8 lg:grid-cols-3">
                            {/* Left Image */}
                            <div className="hidden lg:flex justify-center items-center animate-fade-in-left">
                                <div className="relative">
                                    <div className="absolute inset-0 bg-gradient-to-r from-blue-400 to-indigo-500 rounded-3xl blur-2xl opacity-30 transform rotate-6"></div>
                                    <img
                                        src="/images/redhand.png"
                                        alt="RedHand"
                                        className="relative w-full max-w-[250px] h-auto drop-shadow-2xl transform hover:scale-105 transition-transform duration-500"
                                    />
                                </div>
                            </div>

                            {/* Center Content */}
                            <div className="text-center space-y-6 animate-fade-in-up">
                                <div className="space-y-3">
                                    <h2
                                        className="bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 bg-clip-text pb-2 text-3xl font-extrabold text-transparent drop-shadow-lg sm:text-4xl md:text-3xl xl:text-5xl"
                                        style={{ paddingTop: '0.5em', paddingBottom: '0.5em', lineHeight: 1.1 }}
                                    >
                                        {t('landing.title')}
                                    </h2>
                                </div>

                                <div className="mx-auto grid w-full max-w-3xl grid-cols-1 gap-3 pt-4 sm:grid-cols-2 sm:gap-4">
                                    <button
                                        type="button"
                                        onClick={() => navigate('/problems')}
                                        className="group relative min-h-0 w-full min-w-0 transform overflow-hidden rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 px-3 py-2 text-base font-bold text-white shadow-2xl transition-all duration-300 hover:-translate-y-1 hover:from-blue-700 hover:to-indigo-700 hover:shadow-blue-500/50 sm:px-5 sm:py-3 sm:text-lg"
                                        style={{ minWidth: 0 }}
                                    >
                                        <span className="relative z-10 flex items-center justify-center gap-2 text-lg sm:text-xl md:text-2xl xl:text-lg">
                                            {t('nav.problems')}
                                            <svg className="h-5 w-5 transform transition-transform group-hover:translate-x-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                                            </svg>
                                        </span>
                                        <div className="absolute inset-0 bg-gradient-to-r from-blue-400 to-indigo-400 opacity-0 transition-opacity group-hover:opacity-100"></div>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => navigate('/machines')}
                                        className="group relative min-h-0 w-full min-w-0 transform overflow-hidden rounded-2xl bg-gradient-to-r from-green-600 to-emerald-600 px-3 py-2 text-base font-bold text-white shadow-2xl transition-all duration-300 hover:-translate-y-1 hover:from-green-700 hover:to-emerald-700 hover:shadow-green-500/50 sm:px-5 sm:py-3 sm:text-lg"
                                        style={{ minWidth: 0 }}
                                    >
                                        <span className="relative z-10 flex items-center justify-center gap-2 text-lg sm:text-xl md:text-2xl xl:text-lg">
                                            {t('landing.machineMode')}
                                            <svg className="h-5 w-5 transform transition-transform group-hover:translate-x-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                                            </svg>
                                        </span>
                                        <div className="absolute inset-0 bg-gradient-to-r from-green-400 to-emerald-400 opacity-0 transition-opacity group-hover:opacity-100"></div>
                                    </button>
                                    <div className="col-span-full flex w-full justify-center">
                                        <button
                                            type="button"
                                            onClick={() => navigate('/production-monitoring')}
                                            className="group relative w-full max-w-md transform overflow-hidden rounded-2xl bg-gradient-to-r from-cyan-600 to-teal-600 px-3 py-2 text-base font-bold text-white shadow-2xl transition-all duration-300 hover:-translate-y-1 hover:from-cyan-700 hover:to-teal-700 hover:shadow-cyan-500/50 sm:px-5 sm:py-3 sm:text-lg md:max-w-lg"
                                            style={{ minWidth: 0 }}
                                        >
                                            <span className="relative z-10 flex items-center justify-center gap-2 text-lg sm:text-xl md:text-2xl xl:text-lg">
                                                {t('nav.production')}
                                                <svg className="h-5 w-5 transform transition-transform group-hover:translate-x-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                                                </svg>
                                            </span>
                                            <div className="absolute inset-0 bg-gradient-to-r from-cyan-400 to-teal-400 opacity-0 transition-opacity group-hover:opacity-100"></div>
                                        </button>
                                    </div>
                                </div>

                           
                           
                            </div>

                            {/* Right Image */}
                            <div className="hidden lg:flex justify-center items-center animate-fade-in-right">
                                <div className="relative">
                                    <div className="absolute inset-0 bg-gradient-to-r from-green-400 to-emerald-500 rounded-3xl blur-2xl opacity-30 transform -rotate-6"></div>
                                    <img
                                        src="/images/chaiyo-right.png"
                                        alt="Chaiyo"
                                        className="relative w-full max-w-xs h-auto drop-shadow-2xl transform hover:scale-105 transition-transform duration-500"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Mobile Images */}
                        <div className="lg:hidden flex justify-center items-center gap-8 mt-8">
                            <div className="flex-1 max-w-[148px] animate-fade-in-left">
                                <img
                                    src="/images/redhand.png"
                                    alt="Red Hand"
                                    className="w-full h-auto drop-shadow-xl"
                                />
                            </div>
                            <div className="flex-1 max-w-[148px] animate-fade-in-right">
                                <img
                                    src="/images/chaiyo-right.png"
                                    alt="Chaiyo"
                                    className="w-full h-auto drop-shadow-xl"
                                />
                            </div>
                        </div>
                    </div>
                </div>

                {/* Add custom animations via style tag */}
                <style>{`
                    @keyframes blob {
                        0%, 100% {
                            transform: translate(0px, 0px) scale(1);
                        }
                        33% {
                            transform: translate(30px, -50px) scale(1.1);
                        }
                        66% {
                            transform: translate(-20px, 20px) scale(0.9);
                        }
                    }
                    .animate-blob {
                        animation: blob 7s infinite;
                    }
                    .animation-delay-2000 {
                        animation-delay: 2s;
                    }
                    .animation-delay-4000 {
                        animation-delay: 4s;
                    }
                    @keyframes fade-in-left {
                        from {
                            opacity: 0;
                            transform: translateX(-50px);
                        }
                        to {
                            opacity: 1;
                            transform: translateX(0);
                        }
                    }
                    @keyframes fade-in-right {
                        from {
                            opacity: 0;
                            transform: translateX(50px);
                        }
                        to {
                            opacity: 1;
                            transform: translateX(0);
                        }
                    }
                    @keyframes fade-in-up {
                        from {
                            opacity: 0;
                            transform: translateY(30px);
                        }
                        to {
                            opacity: 1;
                            transform: translateY(0);
                        }
                    }
                    .animate-fade-in-left {
                        animation: fade-in-left 1s ease-out;
                    }
                    .animate-fade-in-right {
                        animation: fade-in-right 1s ease-out;
                    }
                    .animate-fade-in-up {
                        animation: fade-in-up 1s ease-out;
                    }
                `}</style>
            </div>
        </PublicLayout>
    );
};

export default Landing;

