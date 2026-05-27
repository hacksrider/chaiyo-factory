import React, { useEffect, useRef, useState } from 'react';

const ConfirmDialog = ({ show, title, message, onConfirm, onCancel, confirmText = 'ยืนยัน', cancelText = 'ยกเลิก' }) => {
    const [submitting, setSubmitting] = useState(false);
    const lockRef = useRef(false);

    useEffect(() => {
        if (!show) {
            lockRef.current = false;
            setSubmitting(false);
        }
    }, [show]);

    if (!show) return null;

    const handleConfirm = async () => {
        if (lockRef.current || !onConfirm) return;
        lockRef.current = true;
        setSubmitting(true);
        try {
            await onConfirm();
        } finally {
            lockRef.current = false;
            setSubmitting(false);
        }
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-dialog-title"
        >
            <div className="animate-scale-in max-h-[min(90dvh,32rem)] w-full max-w-md overflow-y-auto rounded-lg bg-white shadow-xl">
                <div className="p-4 sm:p-6">
                    <div className="mb-6">
                        <h3 id="confirm-dialog-title" className="text-lg font-semibold text-gray-900 break-words">
                            {title}
                        </h3>
                        {message && (
                            <p className="mt-2 text-sm text-gray-600 break-words">
                                {message}
                            </p>
                        )}
                    </div>
                    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
                        <button
                            type="button"
                            onClick={onCancel}
                            disabled={submitting}
                            className="w-full rounded-lg bg-gray-100 px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:py-2"
                        >
                            {cancelText}
                        </button>
                        <button
                            type="button"
                            onClick={handleConfirm}
                            disabled={submitting}
                            className="w-full rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:py-2"
                        >
                            {submitting ? 'กำลังดำเนินการ...' : confirmText}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ConfirmDialog;

