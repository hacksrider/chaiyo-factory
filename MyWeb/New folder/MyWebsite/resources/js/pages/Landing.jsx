import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { publicAPI } from '../api';
import PublicLayout from '../components/PublicLayout';
import { useLanguage } from '../contexts/LanguageContext';
import { useTranslation } from '../utils/translations';
import { getLocalized } from '../utils/languageHelper';

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
            <div className="flex justify-center items-center h-screen">
                <div className="text-xl">{t('common.loading')}</div>
            </div>
        );
    }

    return (
        <PublicLayout>
            <div className="h-full bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 relative overflow-hidden">
                {/* Decorative background elements */}
                <div className="absolute inset-0 overflow-hidden pointer-events-none">
                    <div className="absolute top-20 left-10 w-72 h-72 bg-blue-200 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob"></div>
                    <div className="absolute top-40 right-10 w-72 h-72 bg-purple-200 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob animation-delay-2000"></div>
                    <div className="absolute -bottom-8 left-1/2 w-72 h-72 bg-indigo-200 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob animation-delay-4000"></div>
                </div>

                {/* Main Content Container */}
                <div className="relative h-full flex items-center justify-center">
                    <div className="container mx-auto px-4 py-8">
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-center">
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
                                        className="text-4xl md:text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 drop-shadow-lg pb-2"
                                        style={{ paddingTop: '0.5em', paddingBottom: '0.5em', lineHeight: 1.1 }}
                                    >
                                        {t('landing.title')}
                                    </h2>
                                    <div className="text-lg md:text-xl text-gray-700 font-medium max-w-2xl mx-auto leading-relaxed">
                                        {t('landing.subtitle')}
                                    </div>
                                </div>
                                
                                <div className="flex flex-col sm:flex-row gap-4 justify-center pt-4">
                                    <button
                                        onClick={() => navigate('/problems')}
                                        className="group relative bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-10 py-5 rounded-2xl text-lg font-bold hover:from-blue-700 hover:to-indigo-700 transition-all duration-300 shadow-2xl hover:shadow-blue-500/50 hover:-translate-y-2 transform overflow-hidden"
                                    >
                                        <span className="relative z-10 flex items-center justify-center gap-2">
                                            {t('nav.problems')}
                                            <svg className="w-5 h-5 transform group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                                            </svg>
                                        </span>
                                        <div className="absolute inset-0 bg-gradient-to-r from-blue-400 to-indigo-400 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                                    </button>
                                    <button
                                        onClick={() => navigate('/machines')}
                                        className="group relative bg-gradient-to-r from-green-600 to-emerald-600 text-white px-10 py-5 rounded-2xl text-lg font-bold hover:from-green-700 hover:to-emerald-700 transition-all duration-300 shadow-2xl hover:shadow-green-500/50 hover:-translate-y-2 transform overflow-hidden"
                                    >
                                        <span className="relative z-10 flex items-center justify-center gap-2">
                                            {t('landing.machineMode')}
                                            <svg className="w-5 h-5 transform group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                                            </svg>
                                        </span>
                                        <div className="absolute inset-0 bg-gradient-to-r from-green-400 to-emerald-400 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                                    </button>
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

