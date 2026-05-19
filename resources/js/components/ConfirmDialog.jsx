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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 animate-scale-in">
                <div className="p-6">
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">
                        {title}
                    </h3>
                    <p className="text-sm text-gray-600 mb-6">
                        {message}
                    </p>
                    <div className="flex justify-end space-x-3">
                        <button
                            type="button"
                            onClick={onCancel}
                            disabled={submitting}
                            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {cancelText}
                        </button>
                        <button
                            type="button"
                            onClick={handleConfirm}
                            disabled={submitting}
                            className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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

