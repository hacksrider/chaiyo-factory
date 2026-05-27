import React, { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { useTranslation } from '../utils/translations';

const UserIcon = ({ className = 'h-5 w-5' }) => (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
        <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
        />
    </svg>
);

const UserMenuDropdown = ({ userName, logoutLabel, onLogout }) => {
    const location = useLocation();
    const { language } = useLanguage();
    const { t } = useTranslation(language);
    const [open, setOpen] = useState(false);
    const menuRef = useRef(null);

    useEffect(() => {
        setOpen(false);
    }, [location.pathname]);

    useEffect(() => {
        if (!open) return;

        const handlePointerDown = (event) => {
            if (menuRef.current && !menuRef.current.contains(event.target)) {
                setOpen(false);
            }
        };

        const handleEscape = (event) => {
            if (event.key === 'Escape') {
                setOpen(false);
            }
        };

        document.addEventListener('pointerdown', handlePointerDown);
        document.addEventListener('keydown', handleEscape);

        return () => {
            document.removeEventListener('pointerdown', handlePointerDown);
            document.removeEventListener('keydown', handleEscape);
        };
    }, [open]);

    const handleLogout = async () => {
        setOpen(false);
        await onLogout();
    };

    return (
        <div className="relative" ref={menuRef}>
            <button
                type="button"
                className={`inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg text-gray-700 transition hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 md:h-auto md:w-auto md:max-w-xs md:gap-1 md:px-3 md:py-2 md:text-sm md:font-semibold ${open ? 'bg-gray-100' : ''}`}
                aria-haspopup="menu"
                aria-expanded={open}
                aria-controls="user-menu-dropdown"
                aria-label={userName || t('nav.userAccount')}
                onClick={() => setOpen((prev) => !prev)}
            >
                <span className="md:hidden">
                    <UserIcon />
                </span>
                <span className="hidden max-w-[9rem] truncate md:inline sm:max-w-xs">{userName}</span>
                <svg
                    className={`ml-1 hidden h-4 w-4 flex-shrink-0 text-gray-500 transition-transform md:block ${open ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden
                >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </button>
            {open && (
                <>
                    <button
                        type="button"
                        className="fixed inset-0 z-[45] bg-black/20 md:hidden"
                        aria-label={t('common.close')}
                        onClick={() => setOpen(false)}
                    />
                    <div
                        id="user-menu-dropdown"
                        role="menu"
                        className="fixed inset-x-3 top-[3.75rem] z-50 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl md:absolute md:inset-x-auto md:right-0 md:top-full md:mt-2 md:min-w-[12rem] md:rounded-md md:shadow-lg"
                    >
                        <div className="border-b border-gray-100 bg-gray-50 px-4 py-3 md:hidden">
                            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                                {t('nav.userAccount')}
                            </p>
                            <p className="mt-0.5 truncate text-sm font-semibold text-gray-900">{userName}</p>
                        </div>
                        <button
                            type="button"
                            role="menuitem"
                            onClick={handleLogout}
                            className="w-full px-4 py-3 text-left text-sm text-red-600 hover:bg-red-50 md:py-2.5"
                        >
                            {logoutLabel}
                        </button>
                    </div>
                </>
            )}
        </div>
    );
};

export default UserMenuDropdown;
