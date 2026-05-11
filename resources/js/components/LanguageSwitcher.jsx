import React, { useState, useRef, useEffect } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import FlagIcon from './FlagIcon';

const LanguageSwitcher = ({ variant = 'light' }) => {
    const { language, changeLanguage } = useLanguage();
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef(null);
    const isDark = variant === 'dark';

    const languages = [
        { code: 'th', name: 'ไทย' },
        { code: 'mm', name: 'မြန်မာ' },
    ];

    const currentLanguage = languages.find(lang => lang.code === language) || languages[0];

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, []);

    const handleLanguageChange = (langCode) => {
        changeLanguage(langCode);
        setIsOpen(false);
    };

    return (
        <div className={`relative border-l ${isDark ? 'border-gray-700/50 pl-2 sm:pl-3' : 'pl-2 sm:pl-4'}`} ref={dropdownRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={`flex items-center gap-2 px-1 py-1 rounded-md text-sm focus:outline-none focus:ring-2 transition-colors duration-200 ${
                    isDark
                        ? 'bg-gray-800 border border-gray-600/60 text-gray-200 hover:bg-gray-700 focus:ring-cyan-500'
                        : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 focus:ring-blue-500'
                }`}
            >
                <span className="w-8 h-6 flex-shrink-0 overflow-hidden">
                    <FlagIcon countryCode={currentLanguage.code} className="w-full h-full" />
                </span>
                <span className="hidden sm:inline">{currentLanguage.name}</span>
                <svg
                    className={`w-4 h-4 transition-transform duration-200 ${isOpen ? 'transform rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </button>

            {isOpen && (
                <div className={`absolute right-0 w-[115px] rounded-md shadow-lg border z-50 ${
                    isDark ? 'bg-gray-800 border-gray-600/60' : 'bg-white border-gray-200'
                }`}>
                    <div>
                        {languages.map((lang) => (
                            <button
                                key={lang.code}
                                onClick={() => handleLanguageChange(lang.code)}
                                className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors duration-150 ${
                                    isDark
                                        ? language === lang.code
                                            ? 'bg-cyan-500/20 text-cyan-300'
                                            : 'text-gray-200 hover:bg-gray-700'
                                        : language === lang.code
                                            ? 'bg-blue-100 text-blue-700'
                                            : 'text-gray-700 hover:bg-gray-100'
                                }`}
                            >
                                <span className="w-8 h-6 flex-shrink-0 overflow-hidden">
                                    <FlagIcon countryCode={lang.code} className="w-full h-full" />
                                </span>
                                <span>{lang.name}</span>
                                {language === lang.code && (
                                    <svg
                                        className={`w-4 h-4 ml-auto ${isDark ? 'text-cyan-400' : 'text-blue-600'}`}
                                        fill="currentColor"
                                        viewBox="0 0 20 20"
                                    >
                                        <path
                                            fillRule="evenodd"
                                            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                            clipRule="evenodd"
                                        />
                                    </svg>
                                )}
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

export default LanguageSwitcher;

