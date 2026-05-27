import { useEffect, useState } from 'react';

export function useDebouncedValue(value, delayMs = 300) {
    const [debounced, setDebounced] = useState(value);

    useEffect(() => {
        const timer = window.setTimeout(() => setDebounced(value), delayMs);
        return () => window.clearTimeout(timer);
    }, [value, delayMs]);

    return debounced;
}

export default useDebouncedValue;
