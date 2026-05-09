/**
 * Get localized field value based on language
 * @param {Object} obj - Object containing the data
 * @param {string} field - Base field name (e.g., 'name', 'title')
 * @param {string} lang - Language code ('th' or 'mm')
 * @returns {string|null}
 */
export const getLocalized = (obj, field, lang = 'th') => {
    if (!obj) return null;
    
    if (lang === 'mm') {
        const mmField = `${field}_mm`;
        return obj[mmField] || obj[field] || null;
    }
    
    // Default to Thai
    return obj[field] || null;
};

/**
 * Get localized text with fallback
 * @param {Object} obj - Object containing the data
 * @param {string} field - Base field name
 * @param {string} lang - Language code
 * @returns {string}
 */
export const getLocalizedText = (obj, field, lang = 'th') => {
    const value = getLocalized(obj, field, lang);
    return value || '';
};


