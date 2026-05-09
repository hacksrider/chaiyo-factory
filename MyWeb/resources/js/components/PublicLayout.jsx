import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useTranslation } from '../utils/translations';
import LanguageSwitcher from './LanguageSwitcher';
import AdminLayout from './AdminLayout';
import { publicAPI } from '../api';

const PublicLayout = ({ children }) => {
    const navigate = useNavigate();
    const { isAdmin } = useAuth();
    const { language } = useLanguage();
    const { t } = useTranslation(language);
    const [isAIDropdownOpen, setIsAIDropdownOpen] = useState(false);
    const [aiGems, setAiGems] = useState([]);
    const [loadingAiGems, setLoadingAiGems] = useState(false);
    const aiDropdownRef = useRef(null);

    useEffect(() => {
        fetchAiGems();
    }, []);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (aiDropdownRef.current && !aiDropdownRef.current.contains(event.target)) {
                setIsAIDropdownOpen(false);
            }
        };

        if (isAIDropdownOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isAIDropdownOpen]);

    const fetchAiGems = async () => {
        try {
            setLoadingAiGems(true);
            const response = await publicAPI.getAiGems();
            setAiGems(response.data);
        } catch (error) {
            console.error('Error fetching AI Gems:', error);
        } finally {
            setLoadingAiGems(false);
        }
    };

    // If admin is logged in, use AdminLayout
    if (isAdmin) {
        return <AdminLayout>{children}</AdminLayout>;
    }

    // Otherwise use simple public layout
    return (
        <div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
            {/* Simple Header for non-admin users - Fixed */}
            <header className="flex-shrink-0 bg-white shadow-sm">
                <div className="container mx-auto px-4 py-4 flex justify-between items-center">
                    <div className="flex items-center gap-4">
                        <h1 
                            onClick={() => navigate('/')}
                            className="text-2xl font-bold text-blue-600 cursor-pointer hover:text-blue-800 transition"
                        >
                            {t('landing.title')}
                        </h1>
                        <div className="flex gap-2">
                            <button
                                onClick={() => navigate('/problems')}
                                className="px-3 py-1 text-sm text-blue-600 hover:text-blue-800 font-medium border border-blue-600 rounded hover:bg-blue-50"
                            >
                                {t('nav.problems')}
                            </button>
                            <button
                                onClick={() => navigate('/machines')}
                                className="px-3 py-1 text-sm text-green-600 hover:text-green-800 font-medium border border-green-600 rounded hover:bg-green-50"
                            >
                                {t('nav.machines')}
                            </button>
                            <div className="relative" ref={aiDropdownRef}>
                                <button
                                    onClick={() => setIsAIDropdownOpen(!isAIDropdownOpen)}
                                    className="px-3 py-1 text-sm text-purple-600 hover:text-purple-800 font-medium border border-purple-600 rounded hover:bg-purple-50 transition flex items-center gap-1"
                                >
                                    {t('nav.askAI')}
                                    <svg 
                                        className={`w-4 h-4 transition-transform ${isAIDropdownOpen ? 'rotate-180' : ''}`} 
                                        fill="none" 
                                        stroke="currentColor" 
                                        viewBox="0 0 24 24"
                                    >
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                    </svg>
                                </button>
                                {isAIDropdownOpen && (
                                    <div className="absolute top-full left-0 mt-1 bg-white border border-purple-200 rounded-md shadow-lg min-w-[180px] z-50 overflow-hidden max-h-[400px] overflow-y-auto">
                                        {loadingAiGems ? (
                                            <div className="px-4 py-2 text-sm text-gray-500 text-center">
                                                {t('common.loading')}
                                            </div>
                                        ) : aiGems.length > 0 ? (
                                            aiGems
                                                .filter(gem => gem.is_active)
                                                .sort((a, b) => {
                                                    const orderA = a.order ?? 999;
                                                    const orderB = b.order ?? 999;
                                                    if (orderA !== orderB) {
                                                        return orderA - orderB;
                                                    }
                                                    // If order is same, sort by name
                                                    return (a.name || '').localeCompare(b.name || '');
                                                })
                                                .map((gem) => (
                                                    <button
                                                        key={gem.id}
                                                        onClick={() => {
                                                            window.open(gem.gem_url, '_blank');
                                                            setIsAIDropdownOpen(false);
                                                        }}
                                                        className="w-full text-left px-4 py-2 text-sm text-purple-600 hover:bg-purple-50 transition"
                                                    >
                                                        {gem.name}
                                                    </button>
                                                ))
                                        ) : (
                                            <div className="px-4 py-2 text-sm text-gray-500 text-center">
                                                {t('admin.noAiGems')}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-4">
                        <LanguageSwitcher />
                        <button
                            onClick={() => navigate('/admin/login')}
                            className="px-4 py-2 text-blue-600 hover:text-blue-800 font-medium"
                        >
                            {t('nav.adminLogin')}
                        </button>
                    </div>
                </div>
            </header>
            <main className="flex-1 overflow-y-auto">{children}</main>
        </div>
    );
};

export default PublicLayout;

