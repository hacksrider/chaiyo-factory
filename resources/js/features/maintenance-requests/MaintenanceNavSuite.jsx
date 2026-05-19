import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { useTranslation } from '../../utils/translations';
import { maintenanceAPI } from '../../api';
import { useAlert } from '../../contexts/AlertContext';
import MaintenancePaperForm from './MaintenancePaperForm';
import { createDefaultMaintenancePayload, normalizePayload } from './defaultPayload';
import { IconMaintenanceHub, IconLogin } from '../../components/NavToolbarIcons';
import { useSubmitGuard } from '../../hooks/useSubmitGuard';

const POLL_MS = 35000;

/** ไอคอนดินสอ / ถังขยะ สำหรับคอลัมน์จัดการในตารางประวัติ */
function IconPencil({ className = 'h-4 w-4' }) {
    return (
        <svg className={className} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
        </svg>
    );
}

function IconTrash({ className = 'h-4 w-4' }) {
    return (
        <svg className={className} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
        </svg>
    );
}

/** คีย์ i18n สำหรับประเภทแจ้งเตือน (สอดคล้อง event_type จาก API) */
function maintenanceNotifLabelKey(eventType) {
    const m = {
        submitted: 'notifKind_submitted',
        approved: 'notifKind_approved',
        rejected: 'notifKind_rejected',
        updated_by_admin: 'notifKind_updated_by_admin',
        updated_by_technician: 'notifKind_updated_by_technician',
        updated_by_submitter: 'notifKind_updated_by_submitter',
        tech_completed: 'notifKind_tech_completed',
        owner_inspection_submitted: 'notifKind_owner_inspection_submitted',
        maintenance_closed: 'notifKind_maintenance_closed',
    };
    return m[eventType] || 'notifKind_unknown';
}

const NOTIF_TYPE_STYLE = {
    submitted: 'border-blue-200 bg-blue-50 text-blue-700',
    approved: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    rejected: 'border-red-200 bg-red-50 text-red-700',
    updated_by_admin: 'border-amber-200 bg-amber-50 text-amber-800',
    updated_by_technician: 'border-orange-200 bg-orange-50 text-orange-800',
    updated_by_submitter: 'border-yellow-200 bg-yellow-50 text-yellow-900',
    tech_completed: 'border-cyan-200 bg-cyan-50 text-cyan-800',
    owner_inspection_submitted: 'border-violet-200 bg-violet-50 text-violet-800',
    maintenance_closed: 'border-slate-300 bg-slate-100 text-slate-800',
    default: 'border-gray-200 bg-gray-50 text-gray-600',
};

/** ไอคอนประเภทแจ้งเตือนในแถบกระดิ่ง */
function MaintenanceNotifTypeIcon({ eventType, className = 'h-4 w-4' }) {
    const c = className;
    const p = (d) => (
        <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    );
    const svg = (children) => (
        <svg className={c} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden>
            {children}
        </svg>
    );
    switch (eventType) {
        case 'submitted':
            return svg(
                <>
                    {p('M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z')}
                </>
            );
        case 'approved':
            return svg(<>{p('M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z')}</>);
        case 'rejected':
            return svg(<>{p('M6 18L18 6M6 6l12 12')}</>);
        case 'updated_by_admin':
            return svg(<>{p('M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.297 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955-.26 1.431l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.431l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z')}{p('M15 12a3 3 0 11-6 0 3 3 0 016 0z')}</>);
        case 'updated_by_technician':
            return svg(<>{p('M3.75 13.5L14.25 2.25 12 10.5h9l-9.75 11.25L12 13.5H3.75z')}</>);
        case 'updated_by_submitter':
            return svg(<>{p('M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125')}</>);
        case 'tech_completed':
            return svg(<>{p('M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.001.701.647.293.99l-4.222 3.602a.562.562 0 00-.182.557l1.285 5.385a.562.562 0 00-.84.604l-4.625-2.854a.562.562 0 00-.586 0L4.772 19.53a.562.562 0 00-.84-.604l1.285-5.385a.562.562 0 00-.182-.557L.688 10.182c-.309.342-.203.993.293.99l5.518-.442a.563.563 0 00.475-.345L9.118 3.5a.562.562 0 011.04 0z')}</>);
        case 'owner_inspection_submitted':
            return svg(<>{p('M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.1 0a51.897 51.897 0 00-1.26.164c-1.06.168-1.837.86-1.837 1.852v11.65a1.79 1.79 0 01-1.835 1.852 48.424 48.424 0 00-5.137 0 1.79 1.79 0 01-1.835-1.852V8.107c0-.993.777-1.684 1.836-1.852a51.897 51.897 0 001.26-.164m0 0a50.11 50.11 0 012.818.124c1.163.152 1.917.86 1.917 1.852V19.5M5.25 4.5h9')}</>);
        case 'maintenance_closed':
            return svg(<>{p('M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75M5.25 21.75h13.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H5.25a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z')}</>);
        default:
            return svg(<>{p('M14.857 17.082a23.848 23.848 0 005.454-1.082A2.02 2.02 0 0021 16.005V12a15.99 15.99 0 00-4.64-11.954 1.018 1.018 0 00-1.176 0A15.99 15.99 0 008 12v4.005c0 1.1.684 2.067 1.702 2.368.79.226 1.603.415 2.428.56M9.228 20.667A14.935 14.935 0 0112 21c1.838 0 3.568-.332 5.134-.942')}</>);
    }
}

function MaintenanceNotifTypeBadge({ eventType, label }) {
    const k = eventType && NOTIF_TYPE_STYLE[eventType] ? eventType : 'default';
    const shell = NOTIF_TYPE_STYLE[k];
    return (
        <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${shell}`}
            title={label}
            aria-label={label}
        >
            <MaintenanceNotifTypeIcon eventType={eventType || ''} />
        </span>
    );
}

function ReferenceImageGallery({ open, onClose, items, language }) {
    const { t } = useTranslation(language);
    const [index, setIndex] = useState(0);
    const [fullscreen, setFullscreen] = useState(false);

    useEffect(() => {
        if (open) {
            setIndex(0);
            setFullscreen(false);
        }
    }, [open]);

    const list = Array.isArray(items) ? items.filter((x) => x?.url) : [];
    if (!open || list.length === 0) return null;

    const cur = list[Math.min(index, list.length - 1)];
    const go = (d) => setIndex((i) => (i + d + list.length) % list.length);

    const shell = fullscreen
        ? 'fixed inset-0 z-[200] flex flex-col bg-black text-white'
        : 'fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-3 sm:p-6 text-gray-900 [color-scheme:light]';
    const panel = fullscreen ? 'flex h-full w-full flex-col' : 'flex max-h-[min(92vh,44rem)] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl';

    return (
        <div className={shell} role="dialog" aria-modal="true">
            <div className={panel}>
                <div className="flex shrink-0 items-center justify-between gap-2 border-b border-gray-200 bg-white px-3 py-2 sm:px-4">
                    <div className="min-w-0 text-sm font-semibold text-gray-900">
                        {t('maintenance.referenceGalleryTitle')} ({index + 1}/{list.length})
                    </div>
                    <div className="flex flex-wrap items-center gap-1">
                        <button
                            type="button"
                            onClick={() => setFullscreen((f) => !f)}
                            className="rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-800 hover:bg-gray-50"
                        >
                            {fullscreen ? t('maintenance.exitFullscreen') : t('maintenance.fullscreen')}
                        </button>
                        <a
                            href={cur.url}
                            download={cur.downloadName || cur.label || 'reference.jpg'}
                            className="rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-800 hover:bg-gray-50"
                        >
                            {t('maintenance.downloadImage')}
                        </a>
                        <button
                            type="button"
                            onClick={onClose}
                            className="rounded border border-gray-400 bg-white px-2 py-1 text-xs text-gray-800 hover:bg-gray-50"
                        >
                            {t('common.close')}
                        </button>
                    </div>
                </div>
                <div className={`min-h-0 flex-1 overflow-auto ${fullscreen ? 'bg-black' : 'bg-gray-100'}`}>
                    <div className="flex h-full min-h-[200px] items-center justify-center p-2">
                        <img
                            src={cur.url}
                            alt=""
                            className={`max-h-full max-w-full object-contain`}
                        />
                    </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-gray-200 bg-white px-3 py-2">
                    <button
                        type="button"
                        onClick={() => go(-1)}
                        className="rounded border border-gray-300 bg-white px-3 py-1 text-xs text-gray-800 hover:bg-gray-50"
                    >
                        ‹ {t('maintenance.prevImage')}
                    </button>
                    <div className="max-w-[12rem] truncate text-center text-xs text-gray-600" title={cur.label}>
                        {cur.label}
                    </div>
                    <button
                        type="button"
                        onClick={() => go(1)}
                        className="rounded border border-gray-300 bg-white px-3 py-1 text-xs text-gray-800 hover:bg-gray-50"
                    >
                        {t('maintenance.nextImage')} ›
                    </button>
                </div>
            </div>
        </div>
    );
}

function normalizeMaintenanceStatus(status) {
    if (status === 'pending') return 'pending_review';
    return status;
}

function statusLabel(status) {
    const s = normalizeMaintenanceStatus(status);
    if (s === 'pending_review') return { text: 'รอ Admin พิจารณา', cls: 'bg-amber-100 text-amber-800' };
    if (s === 'approved') return { text: 'อนุมัติแล้ว — รอช่าง', cls: 'bg-emerald-100 text-emerald-800' };
    if (s === 'awaiting_acceptance') return { text: 'ช่างเสร็จ — รอตรวจรับ', cls: 'bg-cyan-100 text-cyan-800' };
    if (s === 'awaiting_admin_closure') return { text: 'รอลงนามฝ่ายแผนการผลิต', cls: 'bg-violet-100 text-violet-900' };
    if (s === 'completed') return { text: 'ปิดงานสมบูรณ์', cls: 'bg-slate-200 text-slate-900' };
    if (s === 'rejected') return { text: 'ปฏิเสธ', cls: 'bg-red-100 text-red-800' };
    return { text: s || '—', cls: 'bg-gray-100 text-gray-800' };
}

function DecisionBanner({ detail }) {
    const rb = detail?.reviewed_by;
    const dStr = detail?.reviewed_at ? new Date(detail.reviewed_at).toLocaleString() : '';
    const s = normalizeMaintenanceStatus(detail?.status);
    if (s === 'approved' && rb) {
        return (
            <div className="mb-3 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-950">
                <span className="font-semibold">ผลการพิจารณา:</span> อนุมัติโดย <strong>{rb.name}</strong>
                {dStr ? ` · ${dStr}` : ''}
            </div>
        );
    }
    if (s === 'rejected' && rb) {
        return (
            <div className="mb-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-950">
                <span className="font-semibold">ผลการพิจารณา:</span> ปฏิเสธโดย <strong>{rb.name}</strong>
                {dStr ? ` · ${dStr}` : ''}
            </div>
        );
    }
    if (s === 'pending_review') {
        return (
            <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                <span className="font-semibold">สถานะ:</span> รอผู้ดูแลระบบพิจารณา — หลังอนุมัติจะส่งต่อให้ช่างดำเนินการ
            </div>
        );
    }
    if (s === 'approved') {
        return (
            <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50/80 px-3 py-2 text-sm text-emerald-950">
                <span className="font-semibold">สถานะ:</span> อนุมัติแล้ว — ช่างกรอกส่วนซ่อมบำรุงและกดเสร็จสิ้นเมื่อซ่อมเสร็จ
            </div>
        );
    }
    if (s === 'awaiting_acceptance') {
        const tStr = detail?.tech_completed_at ? new Date(detail.tech_completed_at).toLocaleString() : '';
        return (
            <div className="mb-3 rounded-lg border border-cyan-300 bg-cyan-50 px-3 py-2 text-sm text-cyan-950">
                <span className="font-semibold">สถานะ:</span> ช่างแจ้งซ่อมเสร็จแล้ว — ผู้แจ้งกรุณาตรวจรับงานในส่วน &quot;ผลการตรวจรับงาน&quot;
                {tStr ? ` · ${tStr}` : ''}
            </div>
        );
    }
    if (s === 'awaiting_admin_closure') {
        return (
            <div className="mb-3 rounded-lg border border-violet-300 bg-violet-50 px-3 py-2 text-sm text-violet-950">
                <span className="font-semibold">สถานะ:</span> ผู้แจ้งส่งผลตรวจรับแล้ว — รอฝ่ายวางแผนการผลิต (Admin) ลงนามปิดงาน
            </div>
        );
    }
    if (s === 'completed') {
        const aStr = detail?.owner_accepted_at ? new Date(detail.owner_accepted_at).toLocaleString() : '';
        return (
            <div className="mb-3 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900">
                <span className="font-semibold">สถานะ:</span> ปิดงานสมบูรณ์ (ลงนามฝ่ายแผนการผลิตครบแล้ว)
                {aStr ? ` · ${aStr}` : ''}
            </div>
        );
    }
    return null;
}

function briefMachineFromPayload(payload) {
    const p = payload && typeof payload === 'object' ? payload : {};
    const s = String(p.machineEquipment || '').trim();
    if (!s) return '—';
    return s.length > 36 ? `${s.slice(0, 36)}…` : s;
}

/**
 * @param {{ variant?: 'light' | 'dark' }} props
 */
export default function MaintenanceNavSuite({ variant = 'light' }) {
    const navigate = useNavigate();
    const { user, isAdmin, isTechnician } = useAuth();
    const { language } = useLanguage();
    const { t } = useTranslation(language);
    const { showSuccess, showError } = useAlert();

    const isDark = variant === 'dark';

    const [unreadCount, setUnreadCount] = useState(0);
    const [bellOpen, setBellOpen] = useState(false);
    const [notifList, setNotifList] = useState([]);
    const [notifLoading, setNotifLoading] = useState(false);

    const [formOpen, setFormOpen] = useState(false);
    const { isSubmitting: formSaving, run: withFormGuard } = useSubmitGuard();
    const { isSubmitting: detailBusy, run: withDetailGuard } = useSubmitGuard();
    const [editId, setEditId] = useState(null);
    const [editRecord, setEditRecord] = useState(null);
    const [payload, setPayload] = useState(() => createDefaultMaintenancePayload());
    const [photoBefore, setPhotoBefore] = useState(null);
    const [photoAfter, setPhotoAfter] = useState(null);
    const [clearBefore, setClearBefore] = useState(false);
    const [clearAfter, setClearAfter] = useState(false);
    const [referenceFiles, setReferenceFiles] = useState([]);

    const [detailOpen, setDetailOpen] = useState(false);
    const [detail, setDetail] = useState(null);
    const [rejectOpen, setRejectOpen] = useState(false);
    const [rejectNote, setRejectNote] = useState('');

    const [hubOpen, setHubOpen] = useState(false);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [historyRows, setHistoryRows] = useState([]);

    const bellRef = useRef(null);

    const formMode = useMemo(() => {
        if (!formOpen) return 'full_readonly';
        if (!editId) return 'reporter_edit';
        const raw = editRecord?.status;
        const st = raw === 'pending' ? 'pending_review' : raw;
        if (isAdmin) {
            if (st === 'awaiting_admin_closure') return 'admin_closure_edit';
            return 'admin_edit';
        }
        if (isTechnician && st === 'approved') return 'technician_edit';
        const isOwner = editRecord?.user_id === user?.id;
        if (isOwner && (st === 'pending_review' || st === 'pending')) return 'reporter_edit';
        if (isOwner && st === 'awaiting_acceptance') return 'owner_inspection_edit';
        return 'full_readonly';
    }, [formOpen, editId, editRecord, isAdmin, isTechnician, user?.id]);

    const beforePreviewUrl = useMemo(() => (photoBefore ? URL.createObjectURL(photoBefore) : null), [photoBefore]);
    const afterPreviewUrl = useMemo(() => (photoAfter ? URL.createObjectURL(photoAfter) : null), [photoAfter]);

    useEffect(() => {
        return () => {
            if (beforePreviewUrl) URL.revokeObjectURL(beforePreviewUrl);
        };
    }, [beforePreviewUrl]);

    useEffect(() => {
        return () => {
            if (afterPreviewUrl) URL.revokeObjectURL(afterPreviewUrl);
        };
    }, [afterPreviewUrl]);

    const displayPhotoBefore = !clearBefore ? (beforePreviewUrl || editRecord?.photo_before_url || null) : null;
    const displayPhotoAfter = !clearAfter ? (afterPreviewUrl || editRecord?.photo_after_url || null) : null;

    const referencePreviewItems = useMemo(
        () =>
            referenceFiles.map((f) => ({
                url: URL.createObjectURL(f),
                label: f.name,
                downloadName: f.name,
            })),
        [referenceFiles]
    );

    useEffect(() => {
        return () => {
            referencePreviewItems.forEach((x) => URL.revokeObjectURL(x.url));
        };
    }, [referencePreviewItems]);

    const formReferenceGalleryItems = useMemo(() => {
        if (editId && Array.isArray(editRecord?.reference_image_urls) && editRecord.reference_image_urls.length > 0) {
            const num = editRecord.notification_number || String(editId);
            return editRecord.reference_image_urls.map((url, i) => ({
                url,
                label: `${num} · ${i + 1}`,
                downloadName: `${num}-ref-${i + 1}.jpg`,
            }));
        }
        return referencePreviewItems;
    }, [editId, editRecord?.notification_number, editRecord?.reference_image_urls, referencePreviewItems]);

    const detailReferenceGalleryItems = useMemo(() => {
        if (!detail?.reference_image_urls?.length) return [];
        const num = detail.notification_number || String(detail.id);
        return detail.reference_image_urls.map((url, i) => ({
            url,
            label: `${num} · ${i + 1}`,
            downloadName: `${num}-ref-${i + 1}.jpg`,
        }));
    }, [detail?.reference_image_urls, detail?.notification_number, detail?.id]);

    const [refGalleryOpen, setRefGalleryOpen] = useState(false);
    const [refGalleryItems, setRefGalleryItems] = useState([]);
    const openRefGallery = (items) => {
        if (!items?.length) return;
        setRefGalleryItems(items);
        setRefGalleryOpen(true);
    };

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

    const loadHistory = useCallback(async () => {
        if (!user) return;
        setHistoryLoading(true);
        try {
            const { data } = await maintenanceAPI.list();
            setHistoryRows(Array.isArray(data?.data) ? data.data : []);
        } catch {
            setHistoryRows([]);
            showError(t('maintenance.historyLoadFailed'));
        } finally {
            setHistoryLoading(false);
        }
    }, [user, showError, t]);

    const openHub = () => {
        setHubOpen(true);
        void loadHistory();
    };

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

    /** เติมชื่อบัญชีเมื่อ user โหลดทีหลัง */
    useEffect(() => {
        if (!formOpen || editId || !user?.name) return;
        setPayload((prev) => {
            const p = normalizePayload(prev);
            const name = user.name.trim();
            const next = { ...p };
            if (!next.requesterName?.trim()) next.requesterName = name;
            if (!next.signatures?.reporter?.trim()) {
                next.signatures = { ...next.signatures, reporter: name };
            }
            return normalizePayload(next);
        });
    }, [formOpen, editId, user?.name]);

    useEffect(() => {
        if (!formOpen || formMode !== 'owner_inspection_edit') return;
        setPayload((prev) => {
            const p = normalizePayload(prev);
            const rn = p.requesterName?.trim();
            if (!rn || p.inspection?.inspectorName?.trim()) return p;
            return { ...p, inspection: { ...p.inspection, inspectorName: rn } };
        });
    }, [formOpen, formMode]);

    const openCreateForm = () => {
        setEditId(null);
        setEditRecord(null);
        const name = user?.name?.trim() || '';
        const fresh = createDefaultMaintenancePayload();
        setPayload(
            normalizePayload({
                ...fresh,
                requesterName: name,
                signatures: { ...fresh.signatures, reporter: name },
            })
        );
        setPhotoBefore(null);
        setPhotoAfter(null);
        setClearBefore(false);
        setClearAfter(false);
        setReferenceFiles([]);
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

    const openEditFromHistory = async (requestId) => {
        try {
            const { data } = await maintenanceAPI.get(requestId);
            setEditId(data.id);
            setEditRecord(data);
            setPayload(normalizePayload(data.payload));
            setPhotoBefore(null);
            setPhotoAfter(null);
            setClearBefore(false);
            setClearAfter(false);
            setFormOpen(true);
        } catch (e) {
            showError(e.response?.data?.message || t('maintenance.saveFailed'));
        }
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

    const submitForm = () => {
        void withFormGuard(async () => {
            if (!editId) {
                const p = normalizePayload(payload);
                const wt = p.workType || {};
                const hasWt = !!(wt.bm || wt.cm || wt.pm || wt.other);
                if (!String(p.registerWorkCategory ?? '').trim()) {
                    showError(t('maintenance.registerCategoryRequired'));
                    return;
                }
                if (!hasWt) {
                    showError(t('maintenance.workTypeRequired'));
                    return;
                }
                if (wt.other && !String(wt.otherDetail ?? '').trim()) {
                    showError(t('maintenance.workTypeOtherDetailRequired'));
                    return;
                }
            }
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
                referenceFiles.forEach((f) => fd.append('reference_images[]', f));
                await maintenanceAPI.create(fd);
                showSuccess(t('maintenance.created'));
                setReferenceFiles([]);
            }
            setFormOpen(false);
            setEditRecord(null);
            refreshUnread();
            if (hubOpen) void loadHistory();
        }).catch((e) => {
            showError(e.response?.data?.message || t('maintenance.saveFailed'));
        });
    };

    const submitTechnicianComplete = () => {
        if (!editId) return;
        void withFormGuard(async () => {
            const fd = new FormData();
            fd.append('payload', JSON.stringify(payload));
            if (photoBefore) fd.append('photo_before', photoBefore);
            if (photoAfter) fd.append('photo_after', photoAfter);
            if (clearBefore) fd.append('clear_photo_before', '1');
            if (clearAfter) fd.append('clear_photo_after', '1');
            await maintenanceAPI.update(editId, fd);
            await maintenanceAPI.technicianComplete(editId);
            showSuccess(t('maintenance.technicianCompleted'));
            setFormOpen(false);
            setEditRecord(null);
            refreshUnread();
            if (hubOpen) void loadHistory();
            if (detailOpen && detail?.id === editId) {
                const { data } = await maintenanceAPI.get(editId);
                setDetail(data);
            }
        }).catch((e) => {
            showError(e.response?.data?.message || t('maintenance.saveFailed'));
        });
    };

    const submitOwnerInspection = () => {
        if (!editId) return;
        void withFormGuard(async () => {
            const fd = new FormData();
            fd.append('payload', JSON.stringify({ inspection: payload.inspection }));
            await maintenanceAPI.ownerSubmitInspection(editId, fd);
            showSuccess(t('maintenance.ownerInspectionSubmitted'));
            setFormOpen(false);
            setEditRecord(null);
            refreshUnread();
            if (hubOpen) void loadHistory();
        }).catch((e) => {
            showError(e.response?.data?.message || t('maintenance.saveFailed'));
        });
    };

    const submitAdminClose = () => {
        if (!editId) return;
        void withFormGuard(async () => {
            const fd = new FormData();
            fd.append('payload', JSON.stringify({ inspection: payload.inspection }));
            await maintenanceAPI.adminCloseMaintenance(editId, fd);
            showSuccess(t('maintenance.adminClosed'));
            setFormOpen(false);
            setEditRecord(null);
            refreshUnread();
            if (hubOpen) void loadHistory();
            if (detailOpen && detail?.id === editId) {
                const { data } = await maintenanceAPI.get(editId);
                setDetail(data);
            }
        }).catch((e) => {
            showError(e.response?.data?.message || t('maintenance.saveFailed'));
        });
    };

    const printDetailPdf = async () => {
        if (!detail?.id) return;
        try {
            await maintenanceAPI.openPdfForPrint(detail.id);
        } catch (e) {
            const msg = e?.message;
            if (msg === 'POPUP_BLOCKED') {
                showError(t('maintenance.printPdfBlocked'));
                return;
            }
            showError(msg || t('maintenance.saveFailed'));
        }
    };

    const doApprove = () => {
        if (!detail) return;
        void withDetailGuard(async () => {
            await maintenanceAPI.approve(detail.id, {});
            showSuccess(t('maintenance.approved'));
            const { data } = await maintenanceAPI.get(detail.id);
            setDetail(data);
            refreshUnread();
            if (hubOpen) void loadHistory();
        }).catch((e) => {
            showError(e.response?.data?.message || 'ไม่สำเร็จ');
        });
    };

    const doReject = () => {
        if (!detail || !rejectNote.trim()) {
            showError(t('maintenance.rejectNeedReason'));
            return;
        }
        void withDetailGuard(async () => {
            await maintenanceAPI.reject(detail.id, { admin_note: rejectNote.trim() });
            showSuccess(t('maintenance.rejected'));
            setRejectOpen(false);
            setRejectNote('');
            const { data } = await maintenanceAPI.get(detail.id);
            setDetail(data);
            refreshUnread();
            if (hubOpen) void loadHistory();
        }).catch((e) => {
            showError(e.response?.data?.message || 'ไม่สำเร็จ');
        });
    };

    const normalizedDetailStatus = detail ? normalizeMaintenanceStatus(detail.status) : '';
    const canEditDetail =
        detail &&
        (isAdmin ||
            (isTechnician && normalizedDetailStatus === 'approved') ||
            (detail.user_id === user?.id && ['pending_review', 'pending'].includes(detail.status)) ||
            (detail.user_id === user?.id && normalizedDetailStatus === 'awaiting_acceptance'));

    const showAdminActions = isAdmin && detail && ['pending_review', 'pending'].includes(detail.status);

    const primaryBtn = isDark
        ? 'border-amber-400/70 bg-amber-500/15 text-amber-100 hover:bg-amber-500/25'
        : 'border-amber-800 bg-amber-50 text-amber-900 hover:bg-amber-100';

    const bellBtn = isDark
        ? 'border-gray-600 text-gray-200 hover:bg-gray-800'
        : 'border-gray-300 text-gray-700 hover:bg-gray-50';

    const loginBtn = isDark
        ? 'border-amber-400/50 text-amber-100 hover:bg-gray-800'
        : 'border-amber-700 text-amber-800 hover:bg-amber-50';

    const panelCls = 'border border-gray-200 bg-white text-gray-900 shadow-xl';
    const hubShell = 'border border-gray-200 bg-white text-gray-900';
    const hubTh = 'border-b border-gray-200 bg-gray-100 text-gray-800';
    const hubRow = 'border-b border-gray-100 text-gray-900 hover:bg-gray-50 cursor-pointer transition-colors';

    const canEditHistoryRow = (row) => {
        const st = normalizeMaintenanceStatus(row.status);
        if (isAdmin) return true;
        if (row.user_id === user?.id && ['pending_review', 'pending'].includes(row.status)) return true;
        if (isTechnician && st === 'approved') return true;
        if (row.user_id === user?.id && st === 'awaiting_acceptance') return true;
        return false;
    };

    const canDeleteMaintenanceRow = (row) => {
        if (!row) return false;
        if (isAdmin) return true;
        if (row.user_id !== user?.id) return false;
        return ['pending_review', 'pending', 'rejected', 'completed'].includes(row.status);
    };

    const deleteMaintenanceById = async (requestId) => {
        if (!window.confirm(t('maintenance.deleteRequestConfirm'))) return;
        try {
            await maintenanceAPI.delete(requestId);
            showSuccess(t('maintenance.historyDeleted'));
            if (detailOpen && detail?.id === requestId) {
                setDetailOpen(false);
                setDetail(null);
            }
            if (formOpen && editId === requestId) {
                setFormOpen(false);
                setEditId(null);
                setEditRecord(null);
            }
            refreshUnread();
            if (hubOpen) void loadHistory();
        } catch (e) {
            showError(e.response?.data?.message || t('maintenance.deleteFailed'));
        }
    };

    const deleteOneNotification = async (notificationId) => {
        if (!window.confirm(t('maintenance.deleteNotificationConfirm'))) return;
        try {
            await maintenanceAPI.deleteNotification(notificationId);
            showSuccess(t('maintenance.notificationDeleted'));
            refreshUnread();
            void loadNotifications();
        } catch (e) {
            showError(e.response?.data?.message || t('maintenance.deleteFailed'));
        }
    };

    const deleteAllNotificationsAction = async () => {
        if (!window.confirm(t('maintenance.deleteAllNotificationsConfirm'))) return;
        try {
            await maintenanceAPI.deleteAllNotifications();
            showSuccess(t('maintenance.notificationsCleared'));
            refreshUnread();
            void loadNotifications();
        } catch (e) {
            showError(e.response?.data?.message || t('maintenance.deleteFailed'));
        }
    };

    if (!user) {
        return (
            <button
                type="button"
                onClick={() => navigate('/admin/login')}
                className={`inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border sm:h-auto sm:w-auto sm:gap-2 sm:px-3 sm:py-1.5 sm:text-sm ${loginBtn}`}
                title={t('maintenance.loginToUse')}
                aria-label={t('maintenance.loginToUse')}
            >
                <IconLogin className="h-5 w-5 shrink-0 sm:-ml-0.5" />
                <span className="hidden max-w-[14rem] truncate sm:inline">{t('maintenance.loginToUse')}</span>
            </button>
        );
    }

    return (
        <>
            <div className="flex items-center gap-1 sm:gap-2">
                <button
                    type="button"
                    onClick={openHub}
                    className={`inline-flex h-9 w-9 flex-shrink-0 items-center justify-center gap-2 rounded-lg border font-semibold sm:h-auto sm:w-auto sm:px-3 sm:py-1.5 sm:text-sm ${primaryBtn}`}
                    title={t('maintenance.navButton')}
                    aria-label={t('maintenance.navButton')}
                >
                    <IconMaintenanceHub className="h-5 w-5 shrink-0" />
                    <span className="hidden whitespace-nowrap sm:inline">{t('maintenance.navButton')}</span>
                </button>

                <div className="relative" ref={bellRef}>
                    <button
                        type="button"
                        onClick={() => setBellOpen(!bellOpen)}
                        className={`relative flex h-9 w-9 items-center justify-center rounded-lg border sm:h-10 sm:w-10 ${bellBtn}`}
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
                        <div className={`absolute right-0 top-full z-[80] mt-1 w-[min(calc(100vw-2rem),22rem)] rounded-lg ${panelCls}`}>
                            <div className="flex items-center justify-between gap-2 border-b border-gray-200 px-3 py-2">
                                <span className="text-sm font-semibold text-gray-900">{t('maintenance.notifications')}</span>
                                <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1 text-xs">
                                    <button
                                        type="button"
                                        className="text-red-600 hover:underline"
                                        onClick={() => void deleteAllNotificationsAction()}
                                    >
                                        {t('maintenance.clearNotificationHistory')}
                                    </button>
                                    <span className="text-gray-300">|</span>
                                    <button
                                        type="button"
                                        className="text-blue-600 hover:underline"
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
                            </div>
                            <div className="max-h-[min(60vh,22rem)] overflow-y-auto">
                                {notifLoading ? (
                                    <div className="p-4 text-center text-sm text-gray-500">{t('common.loading')}</div>
                                ) : notifList.length === 0 ? (
                                    <div className="p-4 text-center text-sm text-gray-500">{t('maintenance.noNotifications')}</div>
                                ) : (
                                    notifList.map((n) => (
                                        <div
                                            key={n.id}
                                            className={`flex border-b border-gray-100 ${n.read_at ? '' : 'bg-amber-50/90'}`}
                                        >
                                            <button
                                                type="button"
                                                onClick={() => openDetailById(n.maintenance_request_id, n.id)}
                                                className="flex min-w-0 flex-1 items-start gap-2 px-2 py-2.5 text-left text-sm text-gray-900 transition hover:bg-gray-50/80 sm:px-3"
                                            >
                                                <span className="mt-0.5 shrink-0 self-start">
                                                    <MaintenanceNotifTypeBadge
                                                        eventType={n.event_type}
                                                        label={t(`maintenance.${maintenanceNotifLabelKey(n.event_type)}`)}
                                                    />
                                                </span>
                                                <span className="min-w-0 flex-1">
                                                    <span className="block font-medium text-gray-900">{n.title}</span>
                                                    {n.body && (
                                                        <span className="mt-0.5 block line-clamp-2 text-xs text-gray-600">{n.body}</span>
                                                    )}
                                                    <span className="mt-1 block text-[10px] text-gray-500">
                                                        {new Date(n.created_at).toLocaleString()}
                                                    </span>
                                                </span>
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => void deleteOneNotification(n.id)}
                                                className="flex shrink-0 items-center justify-center border-l border-gray-100 px-2.5 py-2 text-red-600 hover:bg-red-50"
                                                title={t('maintenance.deleteThisNotification')}
                                                aria-label={t('maintenance.deleteThisNotification')}
                                            >
                                                <IconTrash className="h-4 w-4" />
                                            </button>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {hubOpen && (
                <div
                    className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-2 text-gray-900 [color-scheme:light] sm:p-4"
                    role="dialog"
                    aria-modal="true"
                >
                    <div className={`flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl shadow-2xl ${hubShell}`}>
                        <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-4 py-3">
                            <h2 className="text-base font-bold text-gray-900 sm:text-lg">{t('maintenance.hubTitle')}</h2>
                            <div className="flex flex-wrap items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => openCreateForm()}
                                    className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 sm:text-sm"
                                >
                                    {t('maintenance.createNewButton')}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setHubOpen(false)}
                                    className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-800 hover:bg-gray-100 sm:text-sm"
                                >
                                    {t('common.close')}
                                </button>
                            </div>
                        </div>
                        <div className="min-h-0 flex-1 overflow-y-auto bg-white p-3 sm:p-4">
                            {historyLoading ? (
                                <div className="py-8 text-center text-sm text-gray-500">{t('common.loading')}</div>
                            ) : historyRows.length === 0 ? (
                                <div className="py-8 text-center text-sm text-gray-500">{t('maintenance.historyEmpty')}</div>
                            ) : (
                                <div className="overflow-x-auto rounded-lg border border-gray-200">
                                    <table className="min-w-full divide-y text-left text-xs sm:text-sm">
                                        <thead>
                                            <tr className={hubTh}>
                                                <th className="whitespace-nowrap px-2 py-2 sm:px-3">{t('maintenance.colDocNo')}</th>
                                                <th className="whitespace-nowrap px-2 py-2 sm:px-3">{t('maintenance.colDate')}</th>
                                                <th className="whitespace-nowrap px-2 py-2 sm:px-3">{t('maintenance.colReporterName')}</th>
                                                <th className="min-w-[6rem] px-2 py-2 sm:px-3">{t('maintenance.colMachine')}</th>
                                                <th className="whitespace-nowrap px-2 py-2 sm:px-3">{t('maintenance.colStatus')}</th>
                                                <th className="whitespace-nowrap px-2 py-2 sm:px-3">{t('maintenance.colApprover')}</th>
                                                {isAdmin && (
                                                    <>
                                                        <th className="whitespace-nowrap px-2 py-2 sm:px-3">{t('maintenance.colTechDone')}</th>
                                                        <th className="whitespace-nowrap px-2 py-2 sm:px-3">{t('maintenance.colInspectionSent')}</th>
                                                        <th className="whitespace-nowrap px-2 py-2 sm:px-3">{t('maintenance.colClosed')}</th>
                                                    </>
                                                )}
                                                <th className="whitespace-nowrap px-2 py-2 sm:px-3">{t('maintenance.actionsCol')}</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100">
                                            {historyRows.map((row) => {
                                                const rb = row.reviewed_by;
                                                const nst = normalizeMaintenanceStatus(row.status);
                                                let approverCell = '—';
                                                if (['pending', 'pending_review'].includes(row.status)) {
                                                    approverCell = t('maintenance.notReviewedYet');
                                                } else if (rb?.name) {
                                                    approverCell = rb.name;
                                                }
                                                const st = statusLabel(row.status);
                                                const techDone = !!row.tech_completed_at || nst === 'awaiting_acceptance' || nst === 'awaiting_admin_closure' || nst === 'completed';
                                                const inspectionSent = nst === 'awaiting_admin_closure' || nst === 'completed';
                                                const fullyClosed = nst === 'completed';
                                                const reporterName = row.payload?.requesterName?.trim() || row.user?.name || '—';
                                                return (
                                                    <tr
                                                        key={row.id}
                                                        className={hubRow}
                                                        onClick={() => openDetailById(row.id)}
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter' || e.key === ' ') {
                                                                e.preventDefault();
                                                                openDetailById(row.id);
                                                            }
                                                        }}
                                                        tabIndex={0}
                                                        aria-label={`${t('maintenance.detailTitle')} ${row.notification_number}`}
                                                    >
                                                        <td className="whitespace-nowrap px-2 py-2 font-mono text-[11px] text-gray-900 sm:px-3 sm:text-sm">{row.notification_number}</td>
                                                        <td className="whitespace-nowrap px-2 py-2 text-[11px] text-gray-600 sm:px-3 sm:text-sm">
                                                            {row.created_at ? new Date(row.created_at).toLocaleString() : '—'}
                                                        </td>
                                                        <td className="max-w-[10rem] truncate px-2 py-2 text-gray-900 sm:px-3" title={reporterName}>
                                                            {reporterName}
                                                        </td>
                                                        <td className="max-w-[10rem] truncate px-2 py-2 text-gray-900 sm:max-w-xs sm:px-3" title={briefMachineFromPayload(row.payload)}>
                                                            {briefMachineFromPayload(row.payload)}
                                                        </td>
                                                        <td className="whitespace-nowrap px-2 py-2 sm:px-3">
                                                            <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold sm:text-xs ${st.cls}`}>{st.text}</span>
                                                        </td>
                                                        <td className="max-w-[8rem] truncate px-2 py-2 text-[11px] text-gray-900 sm:px-3" title={approverCell}>
                                                            {approverCell}
                                                        </td>
                                                        {isAdmin && (
                                                            <>
                                                                <td className="whitespace-nowrap px-2 py-2 text-center text-gray-900 sm:px-3">{techDone ? '✓' : '—'}</td>
                                                                <td className="whitespace-nowrap px-2 py-2 text-center text-gray-900 sm:px-3">{inspectionSent ? '✓' : '—'}</td>
                                                                <td className="whitespace-nowrap px-2 py-2 text-center text-gray-900 sm:px-3">{fullyClosed ? '✓' : '—'}</td>
                                                            </>
                                                        )}
                                                        <td className="whitespace-nowrap px-2 py-2 sm:px-3">
                                                            <div className="flex flex-nowrap items-center justify-end gap-0.5">
                                                                {canEditHistoryRow(row) && (
                                                                    <button
                                                                        type="button"
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            openEditFromHistory(row.id);
                                                                        }}
                                                                        className="inline-flex rounded border border-amber-600 p-1 text-amber-800 hover:bg-amber-50 sm:p-1.5"
                                                                        title={t('common.edit')}
                                                                        aria-label={t('common.edit')}
                                                                    >
                                                                        <IconPencil />
                                                                    </button>
                                                                )}
                                                                {canDeleteMaintenanceRow(row) && (
                                                                    <button
                                                                        type="button"
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            void deleteMaintenanceById(row.id);
                                                                        }}
                                                                        className="inline-flex rounded border border-red-500 p-1 text-red-700 hover:bg-red-50 sm:p-1.5"
                                                                        title={t('common.delete')}
                                                                        aria-label={t('common.delete')}
                                                                    >
                                                                        <IconTrash />
                                                                    </button>
                                                                )}
                                                            </div>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {formOpen && (
                <div
                    className="fixed inset-0 z-[105] flex items-center justify-center bg-black/50 p-2 text-gray-900 [color-scheme:light] sm:p-4"
                    role="dialog"
                    aria-modal="true"
                >
                    <div className="flex max-h-[95vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-gray-200 bg-white text-gray-900 shadow-2xl">
                        <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-4 py-3">
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
                        <div className="min-h-0 flex-1 overflow-y-auto bg-gray-100 p-3 text-gray-900 sm:p-4">
                            {editId && (formMode === 'technician_edit' || formMode === 'admin_edit') && (
                                <label className="mb-3 flex flex-wrap items-center gap-4 text-xs font-medium text-gray-800">
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
                            {!editId && (
                                <div className="mb-3 rounded-lg border border-amber-200/80 bg-white px-3 py-3 text-sm text-gray-900 shadow-sm">
                                    <div className="font-semibold text-gray-900">{t('maintenance.referencePhotosSection')}</div>
                                    <p className="mt-1 text-xs text-gray-600">{t('maintenance.referencePhotosHint')}</p>
                                    <input
                                        type="file"
                                        accept="image/*"
                                        multiple
                                        className="mt-2 block w-full max-w-md text-xs text-gray-800 file:mr-2 file:rounded file:border file:border-gray-300 file:bg-gray-50 file:px-2 file:py-1"
                                        onChange={(e) => {
                                            const list = Array.from(e.target.files || []);
                                            setReferenceFiles((prev) => [...prev, ...list]);
                                            e.target.value = '';
                                        }}
                                    />
                                    {referenceFiles.length > 0 && (
                                        <ul className="mt-2 max-h-28 space-y-1 overflow-y-auto text-xs">
                                            {referenceFiles.map((f, i) => (
                                                <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-2 rounded border border-gray-100 bg-gray-50 px-2 py-1">
                                                    <span className="truncate" title={f.name}>
                                                        {f.name}
                                                    </span>
                                                    <button
                                                        type="button"
                                                        className="shrink-0 text-red-600 hover:underline"
                                                        onClick={() => setReferenceFiles((prev) => prev.filter((_, j) => j !== i))}
                                                    >
                                                        {t('common.delete')}
                                                    </button>
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </div>
                            )}
                            {formReferenceGalleryItems.length > 0 && (
                                <div className="mb-3">
                                    <button
                                        type="button"
                                        onClick={() => openRefGallery(formReferenceGalleryItems)}
                                        className="rounded-lg border border-blue-600 bg-white px-3 py-1.5 text-sm font-medium text-blue-800 hover:bg-blue-50"
                                    >
                                        {t('maintenance.viewReferenceGallery')} ({formReferenceGalleryItems.length})
                                    </button>
                                </div>
                            )}
                            <MaintenancePaperForm
                                formMode={formMode}
                                payload={payload}
                                setPayload={setPayload}
                                readOnly={false}
                                photoBeforeUrl={displayPhotoBefore}
                                photoAfterUrl={displayPhotoAfter}
                                onPhotoBeforeChange={setPhotoBefore}
                                onPhotoAfterChange={setPhotoAfter}
                            />
                        </div>
                        <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-gray-200 bg-white px-4 py-3">
                            <button
                                type="button"
                                onClick={() => setFormOpen(false)}
                                className="rounded-lg border border-gray-400 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50"
                            >
                                {t('common.cancel')}
                            </button>
                            {formMode === 'technician_edit' && (
                                <>
                                    <button
                                        type="button"
                                        disabled={formSaving}
                                        onClick={submitForm}
                                        className="rounded-lg border border-gray-500 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
                                    >
                                        {formSaving ? t('common.loading') : t('maintenance.saveDraft')}
                                    </button>
                                    <button
                                        type="button"
                                        disabled={formSaving}
                                        onClick={submitTechnicianComplete}
                                        className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
                                    >
                                        {formSaving ? t('common.loading') : t('maintenance.technicianDone')}
                                    </button>
                                </>
                            )}
                            {formMode === 'owner_inspection_edit' && (
                                <>
                                    <button
                                        type="button"
                                        disabled={formSaving}
                                        onClick={submitForm}
                                        className="rounded-lg border border-gray-500 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
                                    >
                                        {formSaving ? t('common.loading') : t('maintenance.saveDraft')}
                                    </button>
                                    <button
                                        type="button"
                                        disabled={formSaving}
                                        onClick={submitOwnerInspection}
                                        className="rounded-lg bg-amber-700 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-800 disabled:opacity-50"
                                    >
                                        {formSaving ? t('common.loading') : t('maintenance.ownerAcceptBtn')}
                                    </button>
                                </>
                            )}
                            {formMode === 'admin_closure_edit' && (
                                <>
                                    <button
                                        type="button"
                                        disabled={formSaving}
                                        onClick={submitForm}
                                        className="rounded-lg border border-gray-500 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
                                    >
                                        {formSaving ? t('common.loading') : t('maintenance.saveDraft')}
                                    </button>
                                    <button
                                        type="button"
                                        disabled={formSaving}
                                        onClick={submitAdminClose}
                                        className="rounded-lg bg-violet-800 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-900 disabled:opacity-50"
                                    >
                                        {formSaving ? t('common.loading') : t('maintenance.adminCloseBtn')}
                                    </button>
                                </>
                            )}
                            {(formMode === 'reporter_edit' || formMode === 'admin_edit') && (
                                <button
                                    type="button"
                                    disabled={formSaving}
                                    onClick={submitForm}
                                    className="rounded-lg bg-amber-700 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-800 disabled:opacity-50"
                                >
                                    {formSaving ? t('common.loading') : t('maintenance.confirmSave')}
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {detailOpen && detail && (
                <div
                    className="fixed inset-0 z-[105] flex items-center justify-center bg-black/50 p-2 text-gray-900 [color-scheme:light] sm:p-4"
                    role="dialog"
                    aria-modal="true"
                >
                    <div className="flex max-h-[95vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-gray-200 bg-white text-gray-900 shadow-2xl">
                        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-gray-200 bg-slate-50 px-4 py-3">
                            <div className="min-w-0 flex-1">
                                <h2 className="text-lg font-bold text-gray-900">
                                    {t('maintenance.detailTitle')} {detail.notification_number}
                                </h2>
                                <p className="mt-0.5 text-xs text-gray-600">
                                    <span className="font-medium text-gray-800">{t('maintenance.colReporterName')}:</span>{' '}
                                    {detail.payload?.requesterName?.trim() || detail.user?.name || '—'}
                                    {detail.user?.username ? ` (${t('maintenance.accountUser')}: ${detail.user.username})` : ''}
                                </p>
                                <p className="mt-1 text-xs text-gray-600">
                                    <span className={`inline-flex rounded-full px-2 py-0.5 font-semibold ${statusLabel(detail.status).cls}`}>{statusLabel(detail.status).text}</span>
                                    {detail.created_at && (
                                        <span className="ml-2 text-gray-500">ยืนยันส่งเมื่อ {new Date(detail.created_at).toLocaleString()}</span>
                                    )}
                                </p>
                                {detail.admin_note && (
                                    <p className="mt-2 text-xs text-gray-800">
                                        <span className="font-semibold">{t('maintenance.adminNote')}:</span> {detail.admin_note}
                                    </p>
                                )}
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {detailReferenceGalleryItems.length > 0 && (
                                    <button
                                        type="button"
                                        onClick={() => openRefGallery(detailReferenceGalleryItems)}
                                        className="rounded-lg border border-blue-600 bg-white px-3 py-1.5 text-sm font-medium text-blue-800 hover:bg-blue-50"
                                    >
                                        {t('maintenance.viewReferenceGallery')} ({detailReferenceGalleryItems.length})
                                    </button>
                                )}
                                {normalizedDetailStatus === 'completed' && (
                                    <button
                                        type="button"
                                        onClick={printDetailPdf}
                                        className="rounded-lg border border-gray-700 bg-white px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-100"
                                    >
                                        {t('maintenance.printPdf')}
                                    </button>
                                )}
                                {canEditDetail && (
                                    <button type="button" onClick={openEditFromDetail} className="rounded-lg border border-blue-600 px-3 py-1.5 text-sm text-blue-700 hover:bg-blue-50">
                                        {t('common.edit')}
                                    </button>
                                )}
                                {showAdminActions && (
                                    <>
                                        <button type="button" onClick={doApprove} disabled={detailBusy} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed">
                                            {detailBusy ? t('common.loading') : t('maintenance.approve')}
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
                                {canDeleteMaintenanceRow(detail) && (
                                    <button
                                        type="button"
                                        onClick={() => void deleteMaintenanceById(detail.id)}
                                        className="rounded-lg border border-red-600 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50"
                                    >
                                        {t('maintenance.deleteFromHistory')}
                                    </button>
                                )}
                                <button
                                    type="button"
                                    onClick={() => {
                                        setDetailOpen(false);
                                        if (hubOpen) void loadHistory();
                                    }}
                                    className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100"
                                >
                                    {t('common.close')}
                                </button>
                            </div>
                        </div>
                        <div className="min-h-0 flex-1 overflow-y-auto bg-gray-100 p-3 text-gray-900 sm:p-4">
                            <MaintenancePaperForm
                                formMode="full_readonly"
                                payload={normalizePayload(detail.payload)}
                                setPayload={() => {}}
                                readOnly
                                photoBeforeUrl={detail.photo_before_url}
                                photoAfterUrl={detail.photo_after_url}
                                decisionBanner={<DecisionBanner detail={detail} />}
                            />
                        </div>
                    </div>
                </div>
            )}

            <ReferenceImageGallery
                open={refGalleryOpen}
                onClose={() => {
                    setRefGalleryOpen(false);
                    setRefGalleryItems([]);
                }}
                items={refGalleryItems}
                language={language}
            />

            {rejectOpen && (
                <div className="fixed inset-0 z-[115] flex items-center justify-center bg-black/40 p-4 text-gray-900 [color-scheme:light]">
                    <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-4 text-gray-900 shadow-xl">
                        <h3 className="text-base font-bold text-gray-900">{t('maintenance.rejectTitle')}</h3>
                        <textarea
                            className="mt-3 w-full rounded border border-gray-300 p-2 text-sm text-gray-900"
                            rows={4}
                            value={rejectNote}
                            onChange={(e) => setRejectNote(e.target.value)}
                            placeholder={t('maintenance.rejectPlaceholder')}
                        />
                        <div className="mt-3 flex justify-end gap-2">
                            <button
                                type="button"
                                className="rounded border border-gray-400 bg-white px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50"
                                onClick={() => setRejectOpen(false)}
                            >
                                {t('common.cancel')}
                            </button>
                            <button type="button" disabled={detailBusy} className="rounded bg-red-600 px-3 py-1.5 text-sm text-white disabled:opacity-50 disabled:cursor-not-allowed" onClick={doReject}>
                                {detailBusy ? t('common.loading') : t('maintenance.rejectConfirm')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
