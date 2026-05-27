import React from 'react';

const Pagination = ({
    currentPage,
    lastPage,
    total,
    perPage,
    onPageChange,
    t,
    className = '',
}) => {
    if (!total) {
        return null;
    }

    const safeLastPage = Math.max(1, lastPage || 1);
    const safePage = Math.min(Math.max(1, currentPage || 1), safeLastPage);
    const start = (safePage - 1) * perPage + 1;
    const end = Math.min(safePage * perPage, total);
    const showNav = safeLastPage > 1;

    const pageNumbers = [];
    const maxVisible = 5;
    let startPage = Math.max(1, safePage - Math.floor(maxVisible / 2));
    let endPage = Math.min(safeLastPage, startPage + maxVisible - 1);
    if (endPage - startPage + 1 < maxVisible) {
        startPage = Math.max(1, endPage - maxVisible + 1);
    }
    for (let i = startPage; i <= endPage; i += 1) {
        pageNumbers.push(i);
    }

    const btnBase = 'inline-flex min-h-[2.25rem] min-w-[2.25rem] items-center justify-center rounded-lg border px-2.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40';

    return (
        <div className={`rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm ${className}`}>
            <div className={`flex flex-col gap-3 ${showNav ? 'sm:flex-row sm:items-center sm:justify-between' : ''}`}>
                <p className="text-sm text-gray-600">
                    {t('common.showingResults', { start, end, total })}
                    {showNav && (
                        <span className="ml-2 text-gray-400">
                            ({t('common.pageOf', { page: safePage, lastPage: safeLastPage })})
                        </span>
                    )}
                </p>
                {showNav && (
                    <nav className="flex flex-wrap items-center justify-center gap-1 sm:justify-end" aria-label="Pagination">
                        <button
                            type="button"
                            disabled={safePage <= 1}
                            onClick={() => onPageChange(safePage - 1)}
                            className={`${btnBase} border-gray-200 bg-white text-gray-700 hover:bg-gray-50`}
                        >
                            {t('common.previous')}
                        </button>
                        {startPage > 1 && (
                            <>
                                <button
                                    type="button"
                                    onClick={() => onPageChange(1)}
                                    className={`${btnBase} border-gray-200 bg-white text-gray-700 hover:bg-gray-50`}
                                >
                                    1
                                </button>
                                {startPage > 2 && <span className="px-1 text-gray-400">…</span>}
                            </>
                        )}
                        {pageNumbers.map((page) => (
                            <button
                                key={page}
                                type="button"
                                onClick={() => onPageChange(page)}
                                aria-current={page === safePage ? 'page' : undefined}
                                className={`${btnBase} ${
                                    page === safePage
                                        ? 'border-blue-600 bg-blue-600 text-white'
                                        : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                                }`}
                            >
                                {page}
                            </button>
                        ))}
                        {endPage < safeLastPage && (
                            <>
                                {endPage < safeLastPage - 1 && <span className="px-1 text-gray-400">…</span>}
                                <button
                                    type="button"
                                    onClick={() => onPageChange(safeLastPage)}
                                    className={`${btnBase} border-gray-200 bg-white text-gray-700 hover:bg-gray-50`}
                                >
                                    {safeLastPage}
                                </button>
                            </>
                        )}
                        <button
                            type="button"
                            disabled={safePage >= safeLastPage}
                            onClick={() => onPageChange(safePage + 1)}
                            className={`${btnBase} border-gray-200 bg-white text-gray-700 hover:bg-gray-50`}
                        >
                            {t('common.next')}
                        </button>
                    </nav>
                )}
            </div>
        </div>
    );
};

export default Pagination;
