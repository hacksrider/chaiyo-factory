<?php

namespace App\Helpers;

class LanguageHelper
{
    /**
     * Get localized field value based on language
     * 
     * @param mixed $model Model instance or array
     * @param string $field Base field name (e.g., 'name', 'title')
     * @param string $lang Language code ('th' or 'mm')
     * @return string|null
     */
    public static function getLocalized($model, $field, $lang = 'th')
    {
        if ($lang === 'mm') {
            $mmField = $field . '_mm';
            if (is_object($model)) {
                return $model->$mmField ?? $model->$field ?? null;
            } elseif (is_array($model)) {
                return $model[$mmField] ?? $model[$field] ?? null;
            }
        }
        
        // Default to Thai
        if (is_object($model)) {
            return $model->$field ?? null;
        } elseif (is_array($model)) {
            return $model[$field] ?? null;
        }
        
        return null;
    }

    /**
     * Apply localization to model attributes
     * 
     * @param mixed $model Model instance or array
     * @param array $fields Array of field names to localize
     * @param string $lang Language code ('th' or 'mm')
     * @return array
     */
    public static function localizeModel($model, $fields = [], $lang = 'th')
    {
        $localized = [];
        
        foreach ($fields as $field) {
            $localized[$field] = self::getLocalized($model, $field, $lang);
        }
        
        return $localized;
    }
}

