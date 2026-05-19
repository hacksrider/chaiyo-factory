import React, { useId } from 'react';
import { normalizePayload } from './defaultPayload';
import { getDepartmentSuggestions, rememberDepartment } from './departmentStorage';
import { getMachineEquipmentSuggestions, rememberMachineEquipment } from './machineEquipmentStorage';
import { REGISTER_WORK_CATEGORIES } from './registerWorkCategories';

function Section({ title, children, className = '' }) {
    return (
        <div className={`border border-gray-800 ${className}`}>
            <div className="border-b border-gray-800 bg-gray-100 px-2 py-1 text-xs font-bold !text-gray-900 sm:text-sm">{title}</div>
            <div className="bg-white p-2 !text-gray-900 sm:p-3">{children}</div>
        </div>
    );
}

function LabeledInput({ label, value, onChange, disabled, type = 'text', className = '', list = null }) {
    return (
        <label className={`block min-w-0 text-xs !text-gray-800 ${className}`}>
            <span className="mb-0.5 block font-medium !text-gray-800">{label}</span>
            <input
                type={type}
                value={value ?? ''}
                onChange={(e) => onChange(e.target.value)}
                disabled={disabled}
                list={list}
                className="w-full rounded border border-gray-400 px-2 py-1 text-sm !text-gray-900 disabled:bg-gray-100"
            />
        </label>
    );
}

function LabeledTextarea({ label, value, onChange, disabled, rows = 3 }) {
    return (
        <label className="block text-xs !text-gray-800">
            <span className="mb-0.5 block font-medium !text-gray-800">{label}</span>
            <textarea
                value={value ?? ''}
                onChange={(e) => onChange(e.target.value)}
                disabled={disabled}
                rows={rows}
                className="w-full rounded border border-gray-400 px-2 py-1 text-sm !text-gray-900 disabled:bg-gray-100"
            />
        </label>
    );
}

function Check({ label, checked, onChange, disabled }) {
    return (
        <label className="inline-flex cursor-pointer items-center gap-2 text-xs !text-gray-900 sm:text-sm">
            <input
                type="checkbox"
                checked={!!checked}
                onChange={(e) => onChange(e.target.checked)}
                disabled={disabled}
                className="h-4 w-4 shrink-0 rounded border-gray-600 text-amber-600"
            />
            <span className="!text-gray-900">{label}</span>
        </label>
    );
}

function reporterDisabled(formMode, readOnly) {
    if (readOnly) return true;
    return !['reporter_edit', 'admin_edit'].includes(formMode);
}

function techBlockDisabled(formMode, readOnly) {
    if (readOnly) return true;
    return !['technician_edit', 'admin_edit'].includes(formMode);
}

function inspectionOwnerDisabled(formMode, readOnly) {
    if (readOnly) return true;
    if (formMode === 'owner_inspection_edit') return false;
    if (formMode === 'admin_edit') return false;
    return true;
}

function inspectionPlanningDisabled(formMode, readOnly) {
    if (readOnly) return true;
    if (formMode === 'admin_closure_edit') return false;
    if (formMode === 'admin_edit') return false;
    return true;
}

function showBelowReporter(formMode) {
    return ['technician_edit', 'owner_inspection_edit', 'admin_closure_edit', 'full_readonly', 'admin_edit'].includes(formMode);
}

/**
 * @param {object} props
 * @param {'reporter_edit'|'technician_edit'|'owner_inspection_edit'|'admin_closure_edit'|'full_readonly'|'admin_edit'} props.formMode
 * @param {string|null} props.photoBeforeUrl — แสดงรูป (เซิร์ฟเวอร์หรือ preview)
 * @param {string|null} props.photoAfterUrl
 */
export default function MaintenancePaperForm({
    payload: payloadProp,
    setPayload,
    readOnly = false,
    formMode = 'full_readonly',
    photoBeforeUrl = null,
    photoAfterUrl = null,
    onPhotoBeforeChange,
    onPhotoAfterChange,
    formId = 'maintenance-paper-form',
    decisionBanner = null,
}) {
    const payload = normalizePayload(payloadProp);
    const repDis = reporterDisabled(formMode, readOnly);
    const techDis = techBlockDisabled(formMode, readOnly);
    const insOwnerDis = inspectionOwnerDisabled(formMode, readOnly);
    const insPlanDis = inspectionPlanningDisabled(formMode, readOnly);
    const showRest = showBelowReporter(formMode);
    const photosEditable = !readOnly && ['technician_edit', 'admin_edit'].includes(formMode);

    const deptListId = useId();
    const machineListId = useId();

    const patch = (partial) => {
        if (repDis || !setPayload) return;
        setPayload((prev) => normalizePayload({ ...normalizePayload(prev), ...partial }));
    };

    const patchNested = (key, sub) => {
        if (!setPayload) return;
        if (key === 'workType' || key === 'signatures') {
            if (repDis) return;
        } else if (key === 'inspection') {
            const ownerKeys = ['result', 'abnormalReason', 'inspectorName', 'inspectorDate'];
            const planKeys = ['productionPlanningName', 'productionPlanningDate'];
            const filtered = {};
            Object.entries(sub).forEach(([k, v]) => {
                if (ownerKeys.includes(k)) {
                    if (!insOwnerDis) filtered[k] = v;
                } else if (planKeys.includes(k)) {
                    if (!insPlanDis) filtered[k] = v;
                }
            });
            if (Object.keys(filtered).length === 0) return;
            setPayload((prev) => {
                const p = normalizePayload(prev);
                return { ...p, inspection: { ...p.inspection, ...filtered } };
            });
            return;
        } else if (key === 'maintenance' || key === 'analysis' || key === 'procurement' || key === 'timeline') {
            if (techDis) return;
        }
        setPayload((prev) => {
            const p = normalizePayload(prev);
            return { ...p, [key]: { ...p[key], ...sub } };
        });
    };

    const deptOptions = getDepartmentSuggestions();
    const machineOptions = getMachineEquipmentSuggestions();

    return (
        <div
            id={formId}
            className="mx-auto max-w-4xl border-2 border-gray-900 bg-white p-2 !text-gray-900 shadow-sm [color-scheme:light] sm:p-4 print:mx-0 print:max-w-none print:shadow-none"
        >

            {/* Header */}
            <div className="mb-3 flex flex-col items-center gap-2 border-b-2 border-gray-900 pb-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 flex items-start gap-1 print:gap-1 sm:gap-1.5">
                    <img
                        src="/images/logo-kanok.png"
                        alt=""
                        className="h-7 w-auto shrink-0 bg-white p-0.5 object-contain sm:h-8 print:h-7"
                    />
                    <div>
                        <p className="text-[10px] font-semibold !text-gray-900 sm:text-xs">บริษัท ไชโยไปป์ แอนด์ ฟิตติ้ง จำกัด</p>
                        <p className="text-[9px] text-gray-600">CHAIYO PIPE AND FITTING CO., LTD.</p>
                    </div>
                </div>
                <div className="text-center sm:flex-1 sm:px-4">
                    <h2 className="text-xs font-bold leading-snug !text-gray-900 sm:text-sm">
                        ใบแจ้งซ่อม / สร้าง / ปรับปรุง / บำรุงรักษา เครื่องจักร
                    </h2>
                </div>
                <div className="shrink-0 border border-gray-800 p-2 text-[10px] !text-gray-900 sm:text-xs">
                    <div>เลขที่เอกสาร: FR-MTN-04</div>
                    <div>วันที่เริ่มบังคับใช้: 6 ม.ค. 2563</div>
                    <div>แก้ไขครั้งที่: 1</div>
                </div>
            </div>

            {decisionBanner}

            <div className="space-y-3">
                <Section title="ส่วนของผู้แจ้ง">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-4">
                        <LabeledInput
                            label="วันที่ / เวลาแจ้ง"
                            type="datetime-local"
                            value={payload.notifiedAt}
                            onChange={(v) => patch({ notifiedAt: v })}
                            disabled={repDis}
                        />
                        <LabeledInput
                            label="ผู้แจ้ง"
                            value={payload.requesterName}
                            onChange={(v) => patch({ requesterName: v })}
                            disabled={repDis}
                        />
                        <label className="block min-w-0 text-xs !text-gray-800">
                            <span className="mb-0.5 block font-medium !text-gray-800">แผนก</span>
                            <datalist id={deptListId}>
                                {deptOptions.map((d) => (
                                    <option key={d} value={d} />
                                ))}
                            </datalist>
                            <input
                                type="text"
                                value={payload.department ?? ''}
                                onChange={(e) => patch({ department: e.target.value })}
                                onBlur={(e) => !repDis && rememberDepartment(e.target.value)}
                                disabled={repDis}
                                list={deptListId}
                                placeholder="เลือกหรือพิมพ์แผนก"
                                className="w-full rounded border border-gray-400 px-2 py-1 text-sm !text-gray-900 disabled:bg-gray-100"
                            />
                        </label>
                        <label className="block min-w-0 text-xs !text-gray-800">
                            <span className="mb-0.5 block font-medium !text-gray-800">เครื่องจักร / อุปกรณ์</span>
                            <datalist id={machineListId}>
                                {machineOptions.map((m) => (
                                    <option key={m} value={m} />
                                ))}
                            </datalist>
                            <input
                                type="text"
                                value={payload.machineEquipment ?? ''}
                                onChange={(e) => patch({ machineEquipment: e.target.value })}
                                onBlur={(e) => !repDis && rememberMachineEquipment(e.target.value)}
                                disabled={repDis}
                                list={machineListId}
                                placeholder="เลือกหรือพิมพ์รหัสเครื่อง"
                                className="w-full rounded border border-gray-400 px-2 py-1 text-sm !text-gray-900 disabled:bg-gray-100"
                            />
                        </label>
                    </div>
                    <label className="mt-2 block min-w-0 text-xs !text-gray-800 print:hidden">
                        <span className="mb-0.5 block font-medium !text-gray-800">ประเภทงาน (ทะเบียน)</span>
                        <select
                            value={payload.registerWorkCategory ?? ''}
                            onChange={(e) => patch({ registerWorkCategory: e.target.value })}
                            disabled={repDis}
                            className="w-full rounded border border-gray-400 px-2 py-1 text-sm !text-gray-900 disabled:bg-gray-100"
                        >
                            <option value="">— เลือกประเภท —</option>
                            {REGISTER_WORK_CATEGORIES.map((opt) => (
                                <option key={opt} value={opt}>
                                    {opt}
                                </option>
                            ))}
                        </select>
                    </label>
                    <p className="mt-2 text-xs text-gray-600">เลขที่ใบแจ้งซ่อมถูกสร้างอัตโนมัติหลังบันทึก</p>
                    <div className="mt-2 flex flex-wrap gap-3">
                        <span className="text-xs font-semibold !text-gray-900">ประเภทงาน:</span>
                        <Check label="เครื่องขัดข้อง BM" checked={payload.workType.bm} onChange={(c) => patchNested('workType', { bm: c })} disabled={repDis} />
                        <Check label="แก้ไข/ปรับปรุง CM" checked={payload.workType.cm} onChange={(c) => patchNested('workType', { cm: c })} disabled={repDis} />
                        <Check label="หยุดเครื่อง PM" checked={payload.workType.pm} onChange={(c) => patchNested('workType', { pm: c })} disabled={repDis} />
                        <Check label="อื่นๆ" checked={payload.workType.other} onChange={(c) => patchNested('workType', { other: c, otherDetail: c ? payload.workType.otherDetail : '' })} disabled={repDis} />
                    </div>
                    {payload.workType.other && (
                        <LabeledInput
                            label="ระบุ (ประเภทงานอื่นๆ)"
                            value={payload.workType.otherDetail}
                            onChange={(v) => patchNested('workType', { otherDetail: v })}
                            disabled={repDis}
                            className="mt-2"
                        />
                    )}
                    <LabeledTextarea
                        label="อาการที่เสีย / ปัญหา / สาเหตุ / รายละเอียดอื่นๆ"
                        value={payload.symptoms}
                        onChange={(v) => patch({ symptoms: v })}
                        disabled={repDis}
                        rows={4}
                    />
                    <div className="mt-2 flex flex-wrap gap-4">
                        <span className="text-xs font-semibold !text-gray-900">พิจารณาความเร่งด่วน:</span>
                        <Check
                            label="ด่วน"
                            checked={payload.urgency === 'urgent'}
                            onChange={() => patch({ urgency: 'urgent' })}
                            disabled={repDis}
                        />
                        <Check
                            label="ปกติ"
                            checked={payload.urgency === 'normal'}
                            onChange={() => patch({ urgency: 'normal' })}
                            disabled={repDis}
                        />
                    </div>
                    <LabeledInput label="หมายเหตุ" value={payload.remarks} onChange={(v) => patch({ remarks: v })} disabled={repDis} className="mt-2" />
                    <LabeledInput
                        label="ลายเซ็น ผู้แจ้งซ่อม (พิมพ์ชื่อ)"
                        value={payload.signatures.reporter}
                        onChange={(v) => patchNested('signatures', { reporter: v })}
                        disabled={repDis}
                        className="mt-3 max-w-md"
                    />
                </Section>

                {showRest && (
                    <>
                <Section title="ส่วนของซ่อมบำรุง">
                    <div className="mb-2 flex flex-wrap gap-3">
                        <span className="text-xs font-semibold !text-gray-900">ประเภท:</span>
                        <Check label="เครื่องจักร" checked={payload.maintenance.type.machine} onChange={(c) => patchNested('maintenance', { type: { ...payload.maintenance.type, machine: c } })} disabled={techDis} />
                        <Check label="ระบบสนับสนุน" checked={payload.maintenance.type.support} onChange={(c) => patchNested('maintenance', { type: { ...payload.maintenance.type, support: c } })} disabled={techDis} />
                        <Check label="ทั่วไป" checked={payload.maintenance.type.general} onChange={(c) => patchNested('maintenance', { type: { ...payload.maintenance.type, general: c } })} disabled={techDis} />
                    </div>
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                        <LabeledInput label="ผู้รับแจ้ง" value={payload.maintenance.receiver} onChange={(v) => patchNested('maintenance', { receiver: v })} disabled={techDis} />
                        <LabeledInput label="หัวหน้าแผนก" value={payload.maintenance.departmentHead} onChange={(v) => patchNested('maintenance', { departmentHead: v })} disabled={techDis} />
                        <LabeledInput label="คาดว่าจะแล้วเสร็จ" type="date" value={payload.maintenance.expectedCompletion} onChange={(v) => patchNested('maintenance', { expectedCompletion: v })} disabled={techDis} />
                    </div>
                    <p className="mt-2 text-xs font-semibold !text-gray-900">ระบบที่มีปัญหา</p>
                    <div className="flex flex-wrap gap-3">
                        <Check label="Electric" checked={payload.maintenance.problematicSystem.electric} onChange={(c) => patchNested('maintenance', { problematicSystem: { ...payload.maintenance.problematicSystem, electric: c } })} disabled={techDis} />
                        <Check label="Hydraulic" checked={payload.maintenance.problematicSystem.hydraulic} onChange={(c) => patchNested('maintenance', { problematicSystem: { ...payload.maintenance.problematicSystem, hydraulic: c } })} disabled={techDis} />
                        <Check label="Pneumatic" checked={payload.maintenance.problematicSystem.pneumatic} onChange={(c) => patchNested('maintenance', { problematicSystem: { ...payload.maintenance.problematicSystem, pneumatic: c } })} disabled={techDis} />
                        <Check label="Mechanic" checked={payload.maintenance.problematicSystem.mechanic} onChange={(c) => patchNested('maintenance', { problematicSystem: { ...payload.maintenance.problematicSystem, mechanic: c } })} disabled={techDis} />
                        <Check label="Water" checked={payload.maintenance.problematicSystem.water} onChange={(c) => patchNested('maintenance', { problematicSystem: { ...payload.maintenance.problematicSystem, water: c } })} disabled={techDis} />
                        <Check label="อื่นๆ" checked={payload.maintenance.problematicSystem.other} onChange={(c) => patchNested('maintenance', { problematicSystem: { ...payload.maintenance.problematicSystem, other: c, otherDetail: c ? payload.maintenance.problematicSystem.otherDetail : '' } })} disabled={techDis} />
                    </div>
                    {payload.maintenance.problematicSystem.other && (
                        <LabeledInput label="อื่นๆ (ระบุ)" value={payload.maintenance.problematicSystem.otherDetail} onChange={(v) => patchNested('maintenance', { problematicSystem: { ...payload.maintenance.problematicSystem, otherDetail: v } })} disabled={techDis} className="mt-2" />
                    )}
                    <div className="mt-2 flex flex-wrap gap-3">
                        <span className="text-xs font-semibold !text-gray-900">ดำเนินการโดย:</span>
                        <Check label="ช่างภายในบริษัท" checked={payload.maintenance.performedBy.internal} onChange={(c) => patchNested('maintenance', { performedBy: { ...payload.maintenance.performedBy, internal: c } })} disabled={techDis} />
                        <Check label="จ้างภายนอก" checked={payload.maintenance.performedBy.external} onChange={(c) => patchNested('maintenance', { performedBy: { ...payload.maintenance.performedBy, external: c } })} disabled={techDis} />
                        <Check label="แจ้งผู้ขายตามเงื่อนไข" checked={payload.maintenance.performedBy.vendor} onChange={(c) => patchNested('maintenance', { performedBy: { ...payload.maintenance.performedBy, vendor: c } })} disabled={techDis} />
                    </div>
                    <LabeledTextarea label="การดำเนินการ / อุปกรณ์ที่เปลี่ยน" value={payload.maintenance.actionTaken} onChange={(v) => patchNested('maintenance', { actionTaken: v })} disabled={techDis} rows={4} />
                </Section>

                <Section title="ภาพประกอบ">
                    <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                            <p className="mb-1 text-xs font-semibold !text-gray-900">ก่อนซ่อม</p>
                            {photosEditable && onPhotoBeforeChange && (
                                <input
                                    type="file"
                                    accept="image/*"
                                    onChange={(e) => onPhotoBeforeChange(e.target.files?.[0] || null)}
                                    className="mb-2 block w-full text-xs !text-gray-800 file:mr-2 file:rounded file:border file:border-gray-400 file:bg-white file:px-2 file:py-1 file:text-xs file:!text-gray-800"
                                />
                            )}
                            {photoBeforeUrl ? (
                                <img src={photoBeforeUrl} alt="before" className="max-h-56 w-full border border-gray-400 bg-white object-contain" />
                            ) : (
                                <div className="flex h-44 items-center justify-center border-2 border-dashed border-gray-400 text-xs text-gray-500">ไม่มีรูป</div>
                            )}
                        </div>
                        <div>
                            <p className="mb-1 text-xs font-semibold !text-gray-900">หลังซ่อม</p>
                            {photosEditable && onPhotoAfterChange && (
                                <input
                                    type="file"
                                    accept="image/*"
                                    onChange={(e) => onPhotoAfterChange(e.target.files?.[0] || null)}
                                    className="mb-2 block w-full text-xs !text-gray-800 file:mr-2 file:rounded file:border file:border-gray-400 file:bg-white file:px-2 file:py-1 file:text-xs file:!text-gray-800"
                                />
                            )}
                            {photoAfterUrl ? (
                                <img src={photoAfterUrl} alt="after" className="max-h-56 w-full border border-gray-400 bg-white object-contain" />
                            ) : (
                                <div className="flex h-44 items-center justify-center border-2 border-dashed border-gray-400 text-xs text-gray-500">ไม่มีรูป</div>
                            )}
                        </div>
                    </div>
                </Section>

                <Section title="วิเคราะห์ / คำแนะนำ">
                    <div className="grid gap-3">
                        <LabeledInput label="สาเหตุ" value={payload.analysis.cause} onChange={(v) => patchNested('analysis', { cause: v })} disabled={techDis} />
                        <LabeledInput label="การป้องกัน" value={payload.analysis.prevention} onChange={(v) => patchNested('analysis', { prevention: v })} disabled={techDis} />
                        <LabeledInput label="คำแนะนำวิธีการใช้งาน" value={payload.analysis.usageInstructions} onChange={(v) => patchNested('analysis', { usageInstructions: v })} disabled={techDis} />
                    </div>
                </Section>

                <Section title="กรณีสั่งซื้อเครื่องมือ / อุปกรณ์">
                    <div className="grid gap-3 sm:grid-cols-3">
                        <LabeledInput label="วันที่สั่งซื้อ" type="date" value={payload.procurement.orderDate} onChange={(v) => patchNested('procurement', { orderDate: v })} disabled={techDis} />
                        <LabeledInput label="เลขที่ใบขอซื้อ" value={payload.procurement.prNo} onChange={(v) => patchNested('procurement', { prNo: v })} disabled={techDis} />
                        <LabeledInput label="ได้รับของวันที่" type="date" value={payload.procurement.receivedDate} onChange={(v) => patchNested('procurement', { receivedDate: v })} disabled={techDis} />
                    </div>
                </Section>

                <Section title="ระยะเวลา / ค่าใช้จ่าย / ผู้ดำเนินการ">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <LabeledInput label="เริ่มดำเนินการในวันที่" type="date" value={payload.timeline.startDate} onChange={(v) => patchNested('timeline', { startDate: v })} disabled={techDis} />
                        <LabeledInput label="เสร็จวันที่" type="date" value={payload.timeline.completionDate} onChange={(v) => patchNested('timeline', { completionDate: v })} disabled={techDis} />
                    </div>
                    <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-3">
                        <LabeledInput label="รวมเวลาดำเนินการ (นาที)" value={payload.timeline.totalMinutes} onChange={(v) => patchNested('timeline', { totalMinutes: v })} disabled={techDis} />
                        <LabeledInput label="ค่าใช้จ่ายในการซ่อมบำรุง (บาท)" value={payload.timeline.costBaht} onChange={(v) => patchNested('timeline', { costBaht: v })} disabled={techDis} />
                        <LabeledInput label="ใช้เวลาซ่อมจริง (นาที)" value={payload.timeline.actualRepairMinutes} onChange={(v) => patchNested('timeline', { actualRepairMinutes: v })} disabled={techDis} />
                    </div>
                    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <LabeledInput label="ผู้ดำเนินการ" value={payload.timeline.performedByName} onChange={(v) => patchNested('timeline', { performedByName: v })} disabled={techDis} />
                        <LabeledInput label="วันที่" type="date" value={payload.timeline.performedDate} onChange={(v) => patchNested('timeline', { performedDate: v })} disabled={techDis} />
                    </div>
                </Section>

                <Section title="ผลการตรวจรับงาน">
                    <div className="flex flex-wrap gap-4">
                        <Check label="ใช้งานได้ตามปกติ" checked={payload.inspection.result === 'normal'} onChange={() => patchNested('inspection', { result: 'normal' })} disabled={insOwnerDis} />
                        <Check label="ใช้งานได้ไม่ปกติ" checked={payload.inspection.result === 'abnormal'} onChange={() => patchNested('inspection', { result: 'abnormal' })} disabled={insOwnerDis} />
                    </div>
                    {payload.inspection.result === 'abnormal' && (
                        <div className="mt-2">
                            <LabeledTextarea
                                label="เหตุผล (กรณีใช้งานไม่ปกติ)"
                                value={payload.inspection.abnormalReason ?? ''}
                                onChange={(v) => patchNested('inspection', { abnormalReason: v })}
                                disabled={insOwnerDis}
                                rows={3}
                            />
                        </div>
                    )}
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <LabeledInput label="ผู้ตรวจรับงาน" value={payload.inspection.inspectorName} onChange={(v) => patchNested('inspection', { inspectorName: v })} disabled={insOwnerDis} />
                        <LabeledInput label="วันที่ (ผู้ตรวจ)" type="date" value={payload.inspection.inspectorDate} onChange={(v) => patchNested('inspection', { inspectorDate: v })} disabled={insOwnerDis} />
                        <LabeledInput label="ฝ่ายวางแผนการผลิต (ลงนามโดย Admin)" value={payload.inspection.productionPlanningName} onChange={(v) => patchNested('inspection', { productionPlanningName: v })} disabled={insPlanDis} />
                        <LabeledInput label="วันที่ (แผนการผลิต)" type="date" value={payload.inspection.productionPlanningDate} onChange={(v) => patchNested('inspection', { productionPlanningDate: v })} disabled={insPlanDis} />
                    </div>
                </Section>
                    </>
                )}
            </div>
        </div>
    );
}
