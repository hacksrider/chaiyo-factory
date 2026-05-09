import thTranslations from '../translations/th';
import mmTranslations from '../translations/mm';

const translations = {
    th: thTranslations,
    mm: mmTranslations,
};

export const useTranslation = (lang = 'th') => {
    const t = (key, params = {}) => {
        const keys = key.split('.');
        let value = translations[lang] || translations['th'];
        
        for (const k of keys) {
            value = value?.[k];
            if (value === undefined) {
                // Fallback to Thai if translation not found
                let fallback = translations['th'];
                for (const fk of keys) {
                    fallback = fallback?.[fk];
                }
                if (fallback === undefined) {
                    return key;
                }
                value = fallback;
                break;
            }
        }
        
        // If value is a function, call it with params
        if (typeof value === 'function') {
            return value(params);
        }
        
        return value || key;
    };

    return { t };
};

export default translations;

