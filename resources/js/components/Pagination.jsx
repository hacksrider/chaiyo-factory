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
    if (!lastPage || lastPage <= 1) {
        return null;
    }

    const start = total === 0 ? 0 : (currentPage - 1) * perPage + 1;
    const end = Math.min(currentPage * perPage, total);

    const pageNumbers = [];
    const maxVisible = 5;
    let startPage = Math.max(1, currentPage - Math.floor(maxVisible / 2));
    let endPage = Math.min(lastPage, startPage + maxVisible - 1);
    if (endPage - startPage + 1 < maxVisible) {
        startPage = Math.max(1, endPage - maxVisible + 1);
    }
    for (let i = startPage; i <= endPage; i += 1) {
        pageNumbers.push(i);
    }

    const btnBase = 'inline-flex min-h-[2.25rem] min-w-[2.25rem] items-center justify-center rounded-lg border px-2.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40';

    return (
        <div className={`flex flex-col items-center gap-3 sm:flex-row sm:justify-between ${className}`}>
            <p className="text-sm text-gray-500">
                {t('common.showingResults', { start, end, total })}
            </p>
            <nav className="flex flex-wrap items-center justify-center gap-1" aria-label="Pagination">
                <button
                    type="button"
                    disabled={currentPage <= 1}
                    onClick={() => onPageChange(currentPage - 1)}
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
                        aria-current={page === currentPage ? 'page' : undefined}
                        className={`${btnBase} ${
                            page === currentPage
                                ? 'border-blue-600 bg-blue-600 text-white'
                                : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                        }`}
                    >
                        {page}
                    </button>
                ))}
                {endPage < lastPage && (
                    <>
                        {endPage < lastPage - 1 && <span className="px-1 text-gray-400">…</span>}
                        <button
                            type="button"
                            onClick={() => onPageChange(lastPage)}
                            className={`${btnBase} border-gray-200 bg-white text-gray-700 hover:bg-gray-50`}
                        >
                            {lastPage}
                        </button>
                    </>
                )}
                <button
                    type="button"
                    disabled={currentPage >= lastPage}
                    onClick={() => onPageChange(currentPage + 1)}
                    className={`${btnBase} border-gray-200 bg-white text-gray-700 hover:bg-gray-50`}
                >
                    {t('common.next')}
                </button>
            </nav>
        </div>
    );
};

export default Pagination;
