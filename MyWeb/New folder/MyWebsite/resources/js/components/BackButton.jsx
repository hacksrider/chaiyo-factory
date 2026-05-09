import React from 'react';
import { useNavigate } from 'react-router-dom';

const BackButton = ({ to, label = 'Back', className = '' }) => {
    const navigate = useNavigate();

    const handleBack = () => {
        if (to) {
            navigate(to);
        } else {
            navigate(-1);
        }
    };

    return (
        <button
            onClick={handleBack}
            className={`inline-flex items-center gap-2 px-4 py-2 text-blue-600 hover:text-blue-800 font-medium transition-colors duration-200 hover:bg-blue-50 rounded-lg ${className}`}
        >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            {label}
        </button>
    );
};

export default BackButton;

