import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { useTranslation } from '../../utils/translations';
import { maintenanceAPI } from '../../api';
import { useAlert } from '../../contexts/AlertContext';
import MaintenancePaperForm from './MaintenancePaperForm';
import { createDefaultMaintenancePayload, normalizePayload } from './defaultPayload';

const POLL_MS = 35000;

function statusLabel(status) {
    if (status === 'approved') return { text: 'อนุมัติแล้ว', cls: 'bg-emerald-100 text-emerald-800' };
    if (status === 'rejected') return { text: 'ปฏิเสธ', cls: 'bg-red-100 text-red-800' };
    return { text: 'รอพิจารณา', cls: 'bg-amber-100 text-amber-800' };
}

export default function MaintenanceNavSuite() {
    const navigate = useNavigate();
    const { user, isAdmin } = useAuth();
    const { language } = useLanguage();
    const { t } = useTranslation(language);
    const { showSuccess, showError } = useAlert();

    const [unreadCount, setUnreadCount] = useState(0);
    const [bellOpen, setBellOpen] = useState(false);
    const [notifList, setNotifList] = useState([]);
    const [notifLoading, setNotifLoading] = useState(false);

    const [formOpen, setFormOpen] = useState(false);
    const [formSaving, setFormSaving] = useState(false);
    const [editId, setEditId] = useState(null);
    const [editRecord, setEditRecord] = useState(null);
    const [payload, setPayload] = useState(() => createDefaultMaintenancePayload());
    const [photoBefore, setPhotoBefore] = useState(null);
    const [photoAfter, setPhotoAfter] = useState(null);
    const [clearBefore, setClearBefore] = useState(false);
    const [clearAfter, setClearAfter] = useState(false);

    const [detailOpen, setDetailOpen] = useState(false);
    const [detail, setDetail] = useState(null);
    const [rejectOpen, setRejectOpen] = useState(false);
    const [rejectNote, setRejectNote] = useState('');

    const bellRef = useRef(null);

    const refreshUnread = useCallback(async () => {
        if (!user) return;
        try {
            const { data } = await maintenanceAPI.unreadCount();
            setUnreadCount(data.count ?? 0);
        } catch {
            /* ignore */
        }
    }, [user]);

    const loadNotifications = useCallback(async () => {
        if (!user) return;
        setNotifLoading(true);
        try {
            const { data } = await maintenanceAPI.notifications();
            setNotifList(Array.isArray(data) ? data : []);
        } catch {
            setNotifList([]);
        } finally {
            setNotifLoading(false);
        }
    }, [user]);

    useEffect(() => {
        refreshUnread();
    }, [refreshUnread]);

    useEffect(() => {
        if (!user) return undefined;
        const id = window.setInterval(refreshUnread, POLL_MS);
        return () => window.clearInterval(id);
    }, [user, refreshUnread]);

    useEffect(() => {
        const onFocus = () => refreshUnread();
        window.addEventListener('focus', onFocus);
        return () => window.removeEventListener('focus', onFocus);
    }, [refreshUnread]);

    useEffect(() => {
        if (!bellOpen) return;
        const onDoc = (e) => {
            if (bellRef.current && !bellRef.current.contains(e.target)) {
                setBellOpen(false);
            }
        };
        document.addEventListener('mousedown', onDoc);
        return () => document.removeEventListener('mousedown', onDoc);
    }, [bellOpen]);

    useEffect(() => {
        if (bellOpen) loadNotifications();
    }, [bellOpen, loadNotifications]);

    const openCreateForm = () => {
        setEditId(null);
        setEditRecord(null);
        setPayload(createDefaultMaintenancePayload());
        setPhotoBefore(null);
        setPhotoAfter(null);
        setClearBefore(false);
        setClearAfter(false);
        setFormOpen(true);
    };

    const openEditFromDetail = () => {
        if (!detail) return;
        setEditId(detail.id);
        setEditRecord(detail);
        setPayload(normalizePayload(detail.payload));
        setPhotoBefore(null);
        setPhotoAfter(null);
        setClearBefore(false);
        setClearAfter(false);
        setDetailOpen(false);
        setFormOpen(true);
    };

    const openDetailById = async (requestId, notificationId = null) => {
        try {
            const { data } = await maintenanceAPI.get(requestId);
            setDetail(data);
            setDetailOpen(true);
            setBellOpen(false);
            if (notificationId) {
                await maintenanceAPI.markNotificationRead(notificationId);
                refreshUnread();
                loadNotifications();
            }
        } catch (e) {
            showError(e.response?.data?.message || 'โหลดใบไม่สำเร็จ');
        }
    };

    const submitForm = async () => {
        setFormSaving(true);
        try {
            const fd = new FormData();
            fd.append('payload', JSON.stringify(payload));
            if (photoBefore) fd.append('photo_before', photoBefore);
            if (photoAfter) fd.append('photo_after', photoAfter);
            if (editId) {
                if (clearBefore) fd.append('clear_photo_before', '1');
                if (clearAfter) fd.append('clear_photo_after', '1');
                await maintenanceAPI.update(editId, fd);
                showSuccess(t('maintenance.saved'));
            } else {
                await maintenanceAPI.create(fd);
                showSuccess(t('maintenance.created'));
            }
            setFormOpen(false);
            setEditRecord(null);
            refreshUnread();
        } catch (e) {
            showError(e.response?.data?.message || t('maintenance.saveFailed'));
        } finally {
            setFormSaving(false);
        }
    };

    const doApprove = async () => {
        if (!detail) return;
        try {
            await maintenanceAPI.approve(detail.id, {});
            showSuccess(t('maintenance.approved'));
            setDetailOpen(false);
            refreshUnread();
        } catch (e) {
            showError(e.response?.data?.message || 'ไม่สำเร็จ');
        }
    };

    const doReject = async () => {
        if (!detail || !rejectNote.trim()) {
            showError(t('maintenance.rejectNeedReason'));
            return;
        }
        try {
            await maintenanceAPI.reject(detail.id, { admin_note: rejectNote.trim() });
            showSuccess(t('maintenance.rejected'));
            setRejectOpen(false);
            setRejectNote('');
            setDetailOpen(false);
            refreshUnread();
        } catch (e) {
            showError(e.response?.data?.message || 'ไม่สำเร็จ');
        }
    };

    const canEditDetail = detail && (isAdmin || detail.user_id === user?.id);
    const showAdminActions = isAdmin && detail && detail.status === 'pending';

    if (!user) {
        return (
            <button
                type="button"
                onClick={() => navigate('/admin/login')}
                className="whitespace-nowrap rounded border border-amber-700 px-2 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-50 sm:px-3 sm:text-sm"
            >
                {t('maintenance.loginToUse')}
            </button>
        );
    }

    return (
        <>

            <div className="flex items-center gap-1 sm:gap-2">
                <button
                    type="button"
                    onClick={openCreateForm}
                    className="whitespace-nowrap rounded border border-amber-800 bg-amber-50 px-2 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100 sm:px-3 sm:text-sm"
                >
                    {t('maintenance.navButton')}
                </button>

                <div className="relative" ref={bellRef}>
                    <button
                        type="button"
                        onClick={() => setBellOpen(!bellOpen)}
                        className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 sm:h-10 sm:w-10"
                        aria-label={t('maintenance.notifications')}
                    >
                        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                        </svg>
                        {unreadCount > 0 && (
                            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
                                {unreadCount > 99 ? '99+' : unreadCount}
                            </span>
                        )}
                    </button>
                    {bellOpen && (
                        <div className="absolute right-0 top-full z-50 mt-1 w-[min(calc(100vw-2rem),22rem)] rounded-lg border border-gray-200 bg-white shadow-xl">
                            <div className="flex items-center justify-between border-b px-3 py-2">
                                <span className="text-sm font-semibold text-gray-900">{t('maintenance.notifications')}</span>
                                <button
                                    type="button"
                                    className="text-xs text-blue-600 hover:underline"
                                    onClick={async () => {
                                        try {
                                            await maintenanceAPI.markAllNotificationsRead();
                                            refreshUnread();
                                            loadNotifications();
                                        } catch {
                                            /* */
                                        }
                                    }}
                                >
                                    {t('maintenance.markAllRead')}
                                </button>
                            </div>
                            <div className="max-h-[min(60vh,22rem)] overflow-y-auto">
                                {notifLoading ? (
                                    <div className="p-4 text-center text-sm text-gray-500">{t('common.loading')}</div>
                                ) : notifList.length === 0 ? (
                                    <div className="p-4 text-center text-sm text-gray-500">{t('maintenance.noNotifications')}</div>
                                ) : (
                                    notifList.map((n) => (
                                        <button
                                            key={n.id}
                                            type="button"
                                            onClick={() => openDetailById(n.maintenance_request_id, n.id)}
                                            className={`w-full border-b px-3 py-2.5 text-left transition hover:bg-gray-50 ${n.read_at ? '' : 'bg-amber-50/90'}`}
                                        >
                                            <div className="text-sm font-medium text-gray-900">{n.title}</div>
                                            {n.body && <div className="mt-0.5 line-clamp-2 text-xs text-gray-600">{n.body}</div>}
                                            <div className="mt-1 text-[10px] text-gray-400">{new Date(n.created_at).toLocaleString()}</div>
                                        </button>
                                    ))
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Create / edit modal */}
            {formOpen && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-2 sm:p-4" role="dialog" aria-modal="true">
                    <div className="flex max-h-[95vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
                        <div className="flex shrink-0 items-center justify-between border-b px-4 py-3">
                            <h2 className="text-lg font-bold text-gray-900">
                                {editId ? t('maintenance.editForm') : t('maintenance.newForm')}
                                {editRecord?.notification_number ? ` · ${editRecord.notification_number}` : ''}
                            </h2>
                            <button
                                type="button"
                                onClick={() => setFormOpen(false)}
                                className="rounded p-2 text-gray-500 hover:bg-gray-100"
                                aria-label={t('common.close')}
                            >
                                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                        <div className="min-h-0 flex-1 overflow-y-auto bg-gray-100 p-3 sm:p-4">
                            {editId && (
                                <label className="mb-3 flex flex-wrap items-center gap-4 text-xs">
                                    <span className="flex items-center gap-2">
                                        <input type="checkbox" checked={clearBefore} onChange={(e) => setClearBefore(e.target.checked)} />
                                        {t('maintenance.clearPhotoBefore')}
                                    </span>
                                    <span className="flex items-center gap-2">
                                        <input type="checkbox" checked={clearAfter} onChange={(e) => setClearAfter(e.target.checked)} />
                                        {t('maintenance.clearPhotoAfter')}
                                    </span>
                                </label>
                            )}
                            <MaintenancePaperForm
                                payload={payload}
                                setPayload={setPayload}
                                readOnly={false}
                                canEditAdminSections={isAdmin}
                                photoBeforeUrl={!clearBefore ? editRecord?.photo_before_url : null}
                                photoAfterUrl={!clearAfter ? editRecord?.photo_after_url : null}
                                onPhotoBeforeChange={setPhotoBefore}
                                onPhotoAfterChange={setPhotoAfter}
                            />
                        </div>
                        <div className="flex shrink-0 justify-end gap-2 border-t bg-white px-4 py-3">
                            <button type="button" onClick={() => setFormOpen(false)} className="rounded-lg border px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                                {t('common.cancel')}
                            </button>
                            <button
                                type="button"
                                disabled={formSaving}
                                onClick={submitForm}
                                className="rounded-lg bg-amber-700 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-800 disabled:opacity-50"
                            >
                                {formSaving ? t('common.loading') : t('maintenance.confirmSave')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Detail modal (paper view) */}
            {detailOpen && detail && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-2 sm:p-4" role="dialog" aria-modal="true">
                    <div className="flex max-h-[95vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
                        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
                            <div>
                                <h2 className="text-lg font-bold text-gray-900">
                                    {t('maintenance.detailTitle')} {detail.notification_number}
                                </h2>
                                <p className="text-xs text-gray-600">
                                    {t('maintenance.submitter')}: {detail.user?.name || '—'} ·{' '}
                                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${statusLabel(detail.status).cls}`}>
                                        {statusLabel(detail.status).text}
                                    </span>
                                </p>
                                {detail.admin_note && (
                                    <p className="mt-1 text-xs text-gray-700">
                                        {t('maintenance.adminNote')}: {detail.admin_note}
                                    </p>
                                )}
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {canEditDetail && (
                                    <button type="button" onClick={openEditFromDetail} className="rounded-lg border border-blue-600 px-3 py-1.5 text-sm text-blue-700 hover:bg-blue-50">
                                        {t('common.edit')}
                                    </button>
                                )}
                                {showAdminActions && (
                                    <>
                                        <button type="button" onClick={doApprove} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700">
                                            {t('maintenance.approve')}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setRejectNote('');
                                                setRejectOpen(true);
                                            }}
                                            className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700"
                                        >
                                            {t('maintenance.reject')}
                                        </button>
                                    </>
                                )}
                                <button
                                    type="button"
                                    onClick={() => setDetailOpen(false)}
                                    className="rounded-lg border px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                                >
                                    {t('common.close')}
                                </button>
                            </div>
                        </div>
                        <div className="min-h-0 flex-1 overflow-y-auto bg-gray-100 p-3 sm:p-4">
                            <MaintenancePaperForm
                                payload={normalizePayload(detail.payload)}
                                setPayload={() => {}}
                                readOnly
                                canEditAdminSections={false}
                                photoBeforeUrl={detail.photo_before_url}
                                photoAfterUrl={detail.photo_after_url}
                            />
                        </div>
                    </div>
                </div>
            )}

            {rejectOpen && (
                <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4">
                    <div className="w-full max-w-md rounded-xl bg-white p-4 shadow-xl">
                        <h3 className="text-base font-bold text-gray-900">{t('maintenance.rejectTitle')}</h3>
                        <textarea
                            className="mt-3 w-full rounded border border-gray-300 p-2 text-sm"
                            rows={4}
                            value={rejectNote}
                            onChange={(e) => setRejectNote(e.target.value)}
                            placeholder={t('maintenance.rejectPlaceholder')}
                        />
                        <div className="mt-3 flex justify-end gap-2">
                            <button type="button" className="rounded border px-3 py-1.5 text-sm" onClick={() => setRejectOpen(false)}>
                                {t('common.cancel')}
                            </button>
                            <button type="button" className="rounded bg-red-600 px-3 py-1.5 text-sm text-white" onClick={doReject}>
                                {t('maintenance.rejectConfirm')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
