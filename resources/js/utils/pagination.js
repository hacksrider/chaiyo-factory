export function parsePaginatedResponse(response) {
    const payload = response?.data;

    if (payload?.data && Array.isArray(payload.data)) {
        return {
            items: payload.data,
            currentPage: payload.current_page ?? 1,
            lastPage: Math.max(1, payload.last_page ?? 1),
            total: payload.total ?? payload.data.length,
            perPage: payload.per_page ?? payload.data.length,
        };
    }

    if (Array.isArray(payload)) {
        return {
            items: payload,
            currentPage: 1,
            lastPage: 1,
            total: payload.length,
            perPage: payload.length,
        };
    }

    return {
        items: [],
        currentPage: 1,
        lastPage: 1,
        total: 0,
        perPage: 20,
    };
}
