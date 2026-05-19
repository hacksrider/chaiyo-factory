import React, { createContext, useContext, useState } from 'react';
import Alert from '../components/Alert';
import ConfirmDialog from '../components/ConfirmDialog';
import { useLanguage } from './LanguageContext';
import { useTranslation } from '../utils/translations';

const AlertContext = createContext();

export const useAlert = () => {
    const context = useContext(AlertContext);
    if (!context) {
        throw new Error('useAlert must be used within AlertProvider');
    }
    return context;
};

export const AlertProvider = ({ children }) => {
    const { language } = useLanguage();
    const { t } = useTranslation(language);
    
    const [alert, setAlert] = useState({
        show: false,
        type: 'info',
        title: '',
        message: '',
    });

    const [confirmDialog, setConfirmDialog] = useState({
        show: false,
        title: '',
        message: '',
        onConfirm: null,
        confirmText: t('common.confirm'),
        cancelText: t('common.cancel'),
    });

    const showAlert = (type, title, message) => {
        setAlert({
            show: true,
            type,
            title,
            message,
        });
    };

    const hideAlert = () => {
        setAlert({
            show: false,
            type: 'info',
            title: '',
            message: '',
        });
    };

    const showSuccess = (message, title = null) => {
        showAlert('success', title || t('common.success'), message);
    };

    const showError = (message, title = null) => {
        showAlert('error', title || t('errors.errorOccurred'), message);
    };

    const showWarning = (message, title = null) => {
        showAlert('warning', title || t('common.warning'), message);
    };

    const showInfo = (message, title = null) => {
        showAlert('info', title || t('common.info'), message);
    };

    const showConfirm = (message, title = null, onConfirm, confirmText = null, cancelText = null) => {
        setConfirmDialog({
            show: true,
            title: title || t('common.confirm'),
            message,
            onConfirm: async () => {
                if (onConfirm) await onConfirm();
                setConfirmDialog({ show: false, title: '', message: '', onConfirm: null });
            },
            confirmText: confirmText || t('common.confirm'),
            cancelText: cancelText || t('common.cancel'),
        });
    };

    const hideConfirm = () => {
        setConfirmDialog({ show: false, title: '', message: '', onConfirm: null });
    };

    return (
        <AlertContext.Provider value={{ 
            showAlert, 
            hideAlert, 
            showSuccess, 
            showError, 
            showWarning, 
            showInfo,
            showConfirm,
            hideConfirm,
        }}>
            {children}
            <Alert
                show={alert.show}
                type={alert.type}
                title={alert.title}
                message={alert.message}
                onClose={hideAlert}
            />
            <ConfirmDialog
                show={confirmDialog.show}
                title={confirmDialog.title}
                message={confirmDialog.message}
                onConfirm={confirmDialog.onConfirm}
                onCancel={hideConfirm}
                confirmText={confirmDialog.confirmText}
                cancelText={confirmDialog.cancelText}
            />
        </AlertContext.Provider>
    );
};

