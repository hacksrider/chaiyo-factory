import React from 'react';

const MediaPreview = ({ file, existingPath, type = 'image', onRemove, onRemoveExisting }) => {
    const [preview, setPreview] = React.useState(null);

    React.useEffect(() => {
        if (file) {
            const reader = new FileReader();
            reader.onloadend = () => {
                setPreview(reader.result);
            };
            if (type === 'image') {
                reader.readAsDataURL(file);
            } else {
                reader.readAsDataURL(file);
            }
        } else {
            setPreview(null);
        }
    }, [file, type]);

    const getUrl = () => {
        if (preview) return preview;
        if (existingPath) {
            if (type === 'image') {
                return `/storage/${existingPath}`;
            } else {
                return `/storage/${existingPath}`;
            }
        }
        return null;
    };

    const url = getUrl();

    if (!url) return null;

    const handleRemove = () => {
        if (onRemove) {
            onRemove();
        }
    };

    const handleRemoveExisting = () => {
        if (onRemoveExisting) {
            onRemoveExisting();
        }
    };

    const showRemoveButton = (file && onRemove) || (existingPath && !file && onRemoveExisting);

    if (type === 'image') {
        return (
            <div className="mt-2 relative inline-block">
                <img
                    src={url}
                    alt="Preview"
                    className="max-w-full h-auto max-h-48 rounded-lg border border-gray-300"
                />
                {showRemoveButton && (
                    <button
                        type="button"
                        onClick={file ? handleRemove : handleRemoveExisting}
                        className="absolute top-2 right-2 bg-red-500 text-white rounded-full p-1.5 hover:bg-red-600 transition-colors shadow-lg"
                        title="ลบ"
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                )}
            </div>
        );
    } else {
        return (
            <div className="mt-2 relative inline-block">
                <video
                    src={url}
                    controls
                    className="max-w-full h-auto max-h-48 rounded-lg border border-gray-300"
                >
                    Your browser does not support the video tag.
                </video>
                {showRemoveButton && (
                    <button
                        type="button"
                        onClick={file ? handleRemove : handleRemoveExisting}
                        className="absolute top-2 right-2 bg-red-500 text-white rounded-full p-1.5 hover:bg-red-600 transition-colors shadow-lg"
                        title="ลบ"
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                )}
            </div>
        );
    }
};

export default MediaPreview;

