import { useMemo } from 'react';

export const LIST_PAGE_SIZE = 20;

export function useClientList(items, { search = '', searchKeys = [], page = 1, perPage = LIST_PAGE_SIZE } = {}) {
    const filtered = useMemo(() => {
        const list = items ?? [];
        const q = search.trim().toLowerCase();
        if (!q) return list;

        return list.filter((item) =>
            searchKeys.some((key) => {
                const val = key.split('.').reduce((obj, part) => obj?.[part], item);
                return val != null && String(val).toLowerCase().includes(q);
            })
        );
    }, [items, search, searchKeys]);

    const lastPage = Math.max(1, Math.ceil(filtered.length / perPage) || 1);
    const safePage = Math.min(Math.max(1, page), lastPage);

    const paginated = useMemo(() => {
        const start = (safePage - 1) * perPage;
        return filtered.slice(start, start + perPage);
    }, [filtered, safePage, perPage]);

    return { filtered, paginated, lastPage, safePage, total: filtered.length, perPage };
}

export default useClientList;
