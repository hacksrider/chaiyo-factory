import React from 'react';

const AdminSearchBar = ({ value, onChange, placeholder, className = '' }) => (
    <div className={`mb-6 ${className}`}>
        <input
            type="search"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className="w-full max-w-md rounded-lg border border-gray-300 px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
    </div>
);

export default AdminSearchBar;
