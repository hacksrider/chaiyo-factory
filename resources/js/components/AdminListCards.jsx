import React from 'react';

export const AdminListEmpty = ({ message }) => (
    <div className="rounded-lg border border-gray-100 bg-white px-4 py-12 text-center text-sm text-gray-500 shadow-md">
        {message}
    </div>
);

export const AdminMobileCardList = ({ children }) => (
    <div className="space-y-3 lg:hidden">{children}</div>
);

export const AdminDesktopTable = ({ children }) => (
    <div className="hidden overflow-hidden rounded-lg border border-gray-100 bg-white shadow-md lg:block">
        <div className="overflow-x-auto">{children}</div>
    </div>
);

export const AdminTruncatedCell = ({ children, className = '', title, clamp = 1, tone = 'default' }) => {
    const text = typeof children === 'string' ? children : undefined;
    const clampClass = clamp === 1 ? 'truncate' : `line-clamp-${clamp}`;
    const toneClass = tone === 'muted' ? 'text-gray-500' : 'text-gray-900';

    return (
        <div className={`min-w-0 max-w-xs ${className}`} title={title ?? text}>
            <span className={`block text-sm ${toneClass} ${clampClass}`}>{children}</span>
        </div>
    );
};

export const AdminMobileCard = ({ title, badge, children, actions }) => (
    <article className="rounded-lg border border-gray-100 bg-white p-4 shadow-md">
        {(title || badge) && (
            <div className="mb-3 flex items-start justify-between gap-3">
                {title && (
                    <h2 className="line-clamp-2 min-w-0 flex-1 text-base font-semibold leading-snug text-gray-900">
                        {title}
                    </h2>
                )}
                {badge}
            </div>
        )}
        {children}
        {actions && (
            <div className="mt-4 flex flex-col gap-2 border-t border-gray-100 pt-3 sm:flex-row sm:flex-wrap">
                {actions}
            </div>
        )}
    </article>
);

export const AdminCardRow = ({ label, value, multiline = false }) => (
    <div className={`flex gap-3 text-sm ${multiline ? 'flex-col' : 'items-start justify-between'}`}>
        <dt className="shrink-0 text-gray-500">{label}</dt>
        <dd className={`min-w-0 break-words text-gray-900 ${multiline ? '' : 'text-right'}`}>{value}</dd>
    </div>
);

export const AdminCardRows = ({ children }) => (
    <dl className="space-y-2">{children}</dl>
);

export const AdminCardButton = ({ variant = 'primary', onClick, children, className = '' }) => {
    const styles = {
        primary: 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100',
        success: 'border-green-200 bg-green-50 text-green-700 hover:bg-green-100',
        danger: 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100',
    };

    return (
        <button
            type="button"
            onClick={onClick}
            className={`flex-1 rounded-lg border px-3 py-2.5 text-sm font-medium ${styles[variant] || styles.primary} ${className}`}
        >
            {children}
        </button>
    );
};

export const AdminStatusBadge = ({ active, activeLabel, inactiveLabel }) => (
    <span className={`shrink-0 rounded-full px-2 py-1 text-xs ${
        active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
    }`}>
        {active ? activeLabel : inactiveLabel}
    </span>
);
