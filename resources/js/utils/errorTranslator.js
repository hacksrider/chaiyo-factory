// Helper function to translate Laravel validation errors
export const translateValidationError = (errorMessage, t, fieldName = '') => {
    if (!errorMessage) return errorMessage;

    // Common Laravel validation error patterns
    const errorTranslations = {
        // Required field
        'required': () => t('errors.fieldRequired', { field: fieldName }),
        'The :attribute field is required.': () => t('errors.fieldRequired', { field: fieldName }),
        
        // Unique constraint
        'has already been taken': () => t('errors.fieldTaken', { field: fieldName }),
        'The :attribute has already been taken.': () => t('errors.fieldTaken', { field: fieldName }),
        
        // Max length
        'may not be greater than': () => t('errors.maxLength', { field: fieldName }),
        'The :attribute may not be greater than :max characters.': () => t('errors.maxLength', { field: fieldName }),
        
        // Min length
        'must be at least': () => t('errors.minLength', { field: fieldName }),
        'The :attribute must be at least :min characters.': () => t('errors.minLength', { field: fieldName }),
        
        // Invalid format
        'must be a valid email': () => t('errors.invalidEmail', { field: fieldName }),
        'The :attribute must be a valid email.': () => t('errors.invalidEmail', { field: fieldName }),
        
        // File type
        'must be a file of type': () => t('errors.invalidFileType', { field: fieldName }),
        'The :attribute must be a file of type: :values.': () => t('errors.invalidFileType', { field: fieldName }),
        
        // File size
        'may not be greater than': () => t('errors.fileTooLarge', { field: fieldName }),
        'The :attribute may not be greater than :max kilobytes.': () => t('errors.fileTooLarge', { field: fieldName }),
        
        // Image validation
        'must be an image': () => t('errors.mustBeImage', { field: fieldName }),
        'The :attribute must be an image.': () => t('errors.mustBeImage', { field: fieldName }),
        
        // Exists validation
        'is invalid': () => t('errors.invalidSelection', { field: fieldName }),
        'The selected :attribute is invalid.': () => t('errors.invalidSelection', { field: fieldName }),
    };

    // Try to find match - check longer patterns first
    const sortedPatterns = Object.entries(errorTranslations).sort((a, b) => b[0].length - a[0].length);
    
    for (const [pattern, translator] of sortedPatterns) {
        if (errorMessage.toLowerCase().includes(pattern.toLowerCase())) {
            return translator();
        }
    }

    // If no match found, return original message
    return errorMessage;
};

// Helper function to format validation errors from Laravel response
export const formatValidationErrors = (errors, t) => {
    if (!errors || typeof errors !== 'object') return null;

    const errorMessages = Object.keys(errors).map(key => {
        // Try to get field name from translation
        let fieldName = t(`admin.${key}`);
        if (!fieldName || fieldName === `admin.${key}`) {
            fieldName = t(`common.${key}`);
        }
        if (!fieldName || fieldName === `common.${key}`) {
            // Try machineCode, zoneCode, etc.
            if (key === 'code') {
                fieldName = t('common.code');
            } else {
                fieldName = key;
            }
        }
        
        const fieldErrors = errors[key].map(error => {
            return translateValidationError(error, t, fieldName);
        });
        return `${fieldName}: ${fieldErrors.join(', ')}`;
    });

    return errorMessages.join('\n');
};

