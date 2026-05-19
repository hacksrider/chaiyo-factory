import { useCallback, useRef, useState } from 'react';

/**
 * Prevents duplicate async submit/save/confirm clicks.
 * Uses a ref for synchronous lock (before React re-render) plus state for UI disabled.
 *
 * @returns {{ isSubmitting: boolean, run: (fn: () => void | Promise<void>) => Promise<boolean> }}
 */
export function useSubmitGuard() {
    const lockRef = useRef(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const run = useCallback(async (fn) => {
        if (lockRef.current) return false;
        lockRef.current = true;
        setIsSubmitting(true);
        try {
            await fn();
            return true;
        } finally {
            lockRef.current = false;
            setIsSubmitting(false);
        }
    }, []);

    return { isSubmitting, run };
}
