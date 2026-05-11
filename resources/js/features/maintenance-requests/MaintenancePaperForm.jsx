import React from 'react';
import { normalizePayload } from './defaultPayload';

function Section({ title, children, className = '' }) {
    return (
        <div className={`border border-gray-800 ${className}`}>
            <div className="border-b border-gray-800 bg-gray-100 px-2 py-1 text-xs font-bold text-gray-900 sm:text-sm">{title}</div>
            <div className="bg-white p-2 sm:p-3">{children}</div>
        </div>
    );
}

function LabeledInput({ label, value, onChange, disabled, type = 'text', className = '' }) {
    return (
        <label className={`block text-xs text-gray-800 ${className}`}>
            <span className="mb-0.5 block font-medium">{label}</span>
            <input
                type={type}
                value={value ?? ''}
                onChange={(e) => onChange(e.target.value)}
                disabled={disabled}
                className="w-full rounded border border-gray-400 px-2 py-1 text-sm disabled:bg-gray-100"
            />
        </label>
    );
}

function LabeledTextarea({ label, value, onChange, disabled, rows = 3 }) {
    return (
        <label className="block text-xs text-gray-800">
            <span className="mb-0.5 block font-medium">{label}</span>
            <textarea
                value={value ?? ''}
                onChange={(e) => onChange(e.target.value)}
                disabled={disabled}
                rows={rows}
                className="w-full rounded border border-gray-400 px-2 py-1 text-sm disabled:bg-gray-100"
            />
        </label>
    );
}

function Check({ label, checked, onChange, disabled }) {
    return (
        <label className="inline-flex cursor-pointer items-center gap-2 text-xs sm:text-sm">
            <input
                type="checkbox"
                checked={!!checked}
                onChange={(e) => onChange(e.target.checked)}
                disabled={disabled}
                className="h-4 w-4 rounded border-gray-500"
            />
            {label}
        </label>
    );
}

/**
 * ฟอร์มจัดเลย์เอาต์คล้ายใบกระดาษ FR-MTN-04
 * @param {object} props
 * @param {object} props.payload
 * @param {function} props.setPayload
 * @param {boolean} props.readOnly
 * @param {boolean} props.canEditAdminSections — false = ซ่อมบำรุง/วิเคราะห์/ฯลฯ อ่านอย่างเดียว
 * @param {string|null} props.photoBeforeUrl
 * @param {string|null} props.photoAfterUrl
 * @param {function} props.onPhotoBeforeChange
 * @param {function} props.onPhotoAfterChange
 */
export default function MaintenancePaperForm({
    payload: payloadProp,
    setPayload,
    readOnly = false,
    canEditAdminSections = true,
    photoBeforeUrl = null,
    photoAfterUrl = null,
    onPhotoBeforeChange,
    onPhotoAfterChange,
    formId = 'maintenance-paper-form',
}) {
    const payload = normalizePayload(payloadProp);
    const disabled = readOnly;
    const adminLocked = readOnly || !canEditAdminSections;

    const patch = (partial) => {
        if (disabled || !setPayload) return;
        setPayload((prev) => normalizePayload({ ...normalizePayload(prev), ...partial }));
    };

    const patchNested = (key, sub) => {
        if (disabled || !setPayload) return;
        setPayload((prev) => {
            const p = normalizePayload(prev);
            return { ...p, [key]: { ...p[key], ...sub } };
        });
    };

    return (
        <div id={formId} className="mx-auto max-w-4xl border-2 border-gray-900 bg-white p-2 shadow-sm sm:p-4 print:shadow-none">
            {/* Header */}
            <div className="mb-3 flex flex-col gap-2 border-b-2 border-gray-900 pb-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                    <p className="text-[10px] font-semibold text-gray-900 sm:text-xs">บริษัท กนก ไชโย ท่อและข้อต่อ จำกัด</p>
                    <p className="text-[9px] text-gray-600">Kanok Chaiyo Pipe and Fitting Co., Ltd.</p>
                </div>
                <div className="text-center sm:flex-1 sm:px-4">
                    <h2 className="text-xs font-bold leading-snug text-gray-900 sm:text-sm">
                        ใบแจ้งซ่อม / สร้าง / ปรับปรุง / บำรุงรักษา เครื่องจักร
                    </h2>
                </div>
                <div className="shrink-0 border border-gray-800 p-2 text-[10px] sm:text-xs">
                    <div>เลขที่เอกสาร: FR-MTN-04</div>
                    <div>วันที่เริ่มบังคับใช้: 6 ม.ค. 2563</div>
                    <div>แก้ไขครั้งที่: 1</div>
                </div>
            </div>

            <div className="space-y-3">
                <Section title="ส่วนของผู้แจ้ง">
                    <div className="grid gap-3 sm:grid-cols-2">
                        <LabeledInput
                            label="วันที่ / เวลาแจ้ง"
                            type="datetime-local"
                            value={payload.notifiedAt}
                            onChange={(v) => patch({ notifiedAt: v })}
                            disabled={disabled}
                        />
                        <LabeledInput
                            label="ผู้แจ้ง / แผนก"
                            value={payload.requesterDepartment}
                            onChange={(v) => patch({ requesterDepartment: v })}
                            disabled={disabled}
                        />
                        <LabeledInput
                            label="เครื่องจักร / อุปกรณ์"
                            value={payload.machineEquipment}
                            onChange={(v) => patch({ machineEquipment: v })}
                            disabled={disabled}
                            className="sm:col-span-2"
                        />
                    </div>
                    <p className="mt-2 text-xs text-gray-600">เลขที่ใบแจ้งซ่อมถูกสร้างอัตโนมัติหลังบันทึก</p>
                    <div className="mt-2 flex flex-wrap gap-3">
                        <span className="text-xs font-semibold">ประเภทงาน:</span>
                        <Check label="เครื่องขัดข้อง BM" checked={payload.workType.bm} onChange={(c) => patchNested('workType', { bm: c })} disabled={disabled} />
                        <Check label="แก้ไข/ปรับปรุง CM" checked={payload.workType.cm} onChange={(c) => patchNested('workType', { cm: c })} disabled={disabled} />
                        <Check label="หยุดเครื่อง PM" checked={payload.workType.pm} onChange={(c) => patchNested('workType', { pm: c })} disabled={disabled} />
                        <Check label="อื่นๆ" checked={payload.workType.other} onChange={(c) => patchNested('workType', { other: c })} disabled={disabled} />
                    </div>
                    <LabeledInput
                        label="รายละเอียดอื่นๆ (ประเภทงาน)"
                        value={payload.workType.otherDetail}
                        onChange={(v) => patchNested('workType', { otherDetail: v })}
                        disabled={disabled}
                        className="mt-2"
                    />
                    <LabeledTextarea
                        label="อาการที่เสีย / ปัญหา / สาเหตุ / รายละเอียดอื่นๆ"
                        value={payload.symptoms}
                        onChange={(v) => patch({ symptoms: v })}
                        disabled={disabled}
                        rows={4}
                    />
                    <div className="mt-2 flex flex-wrap gap-4">
                        <span className="text-xs font-semibold">พิจารณาความเร่งด่วน:</span>
                        <Check
                            label="ด่วน"
                            checked={payload.urgency === 'urgent'}
                            onChange={() => patch({ urgency: 'urgent' })}
                            disabled={disabled}
                        />
                        <Check
                            label="ปกติ"
                            checked={payload.urgency === 'normal'}
                            onChange={() => patch({ urgency: 'normal' })}
                            disabled={disabled}
                        />
                    </div>
                    <LabeledInput label="หมายเหตุ" value={payload.remarks} onChange={(v) => patch({ remarks: v })} disabled={disabled} className="mt-2" />
                    <div className="mt-3 grid gap-2 sm:grid-cols-3">
                        <LabeledInput label="ลายเซ็น ผู้แจ้งซ่อม" value={payload.signatures.reporter} onChange={(v) => patchNested('signatures', { reporter: v })} disabled={disabled} />
                        <LabeledInput label="ฝ่ายวางแผน" value={payload.signatures.planning} onChange={(v) => patchNested('signatures', { planning: v })} disabled={disabled} />
                        <LabeledInput label="ผู้อนุมัติ" value={payload.signatures.approver} onChange={(v) => patchNested('signatures', { approver: v })} disabled={disabled} />
                    </div>
                </Section>

                <Section title="ส่วนของซ่อมบำรุง">
                    <div className="mb-2 flex flex-wrap gap-3">
                        <span className="text-xs font-semibold">ประเภท:</span>
                        <Check label="เครื่องจักร" checked={payload.maintenance.type.machine} onChange={(c) => patchNested('maintenance', { type: { ...payload.maintenance.type, machine: c } })} disabled={adminLocked} />
                        <Check label="ระบบสนับสนุน" checked={payload.maintenance.type.support} onChange={(c) => patchNested('maintenance', { type: { ...payload.maintenance.type, support: c } })} disabled={adminLocked} />
                        <Check label="ทั่วไป" checked={payload.maintenance.type.general} onChange={(c) => patchNested('maintenance', { type: { ...payload.maintenance.type, general: c } })} disabled={adminLocked} />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                        <LabeledInput label="ผู้รับแจ้ง" value={payload.maintenance.receiver} onChange={(v) => patchNested('maintenance', { receiver: v })} disabled={adminLocked} />
                        <LabeledInput label="หัวหน้าแผนก" value={payload.maintenance.departmentHead} onChange={(v) => patchNested('maintenance', { departmentHead: v })} disabled={adminLocked} />
                        <LabeledInput label="คาดว่าจะแล้วเสร็จ" type="date" value={payload.maintenance.expectedCompletion} onChange={(v) => patchNested('maintenance', { expectedCompletion: v })} disabled={adminLocked} />
                    </div>
                    <p className="mt-2 text-xs font-semibold">ระบบที่มีปัญหา</p>
                    <div className="flex flex-wrap gap-3">
                        <Check label="Electric" checked={payload.maintenance.problematicSystem.electric} onChange={(c) => patchNested('maintenance', { problematicSystem: { ...payload.maintenance.problematicSystem, electric: c } })} disabled={adminLocked} />
                        <Check label="Hydraulic" checked={payload.maintenance.problematicSystem.hydraulic} onChange={(c) => patchNested('maintenance', { problematicSystem: { ...payload.maintenance.problematicSystem, hydraulic: c } })} disabled={adminLocked} />
                        <Check label="Pneumatic" checked={payload.maintenance.problematicSystem.pneumatic} onChange={(c) => patchNested('maintenance', { problematicSystem: { ...payload.maintenance.problematicSystem, pneumatic: c } })} disabled={adminLocked} />
                        <Check label="Mechanic" checked={payload.maintenance.problematicSystem.mechanic} onChange={(c) => patchNested('maintenance', { problematicSystem: { ...payload.maintenance.problematicSystem, mechanic: c } })} disabled={adminLocked} />
                        <Check label="Water" checked={payload.maintenance.problematicSystem.water} onChange={(c) => patchNested('maintenance', { problematicSystem: { ...payload.maintenance.problematicSystem, water: c } })} disabled={adminLocked} />
                        <Check label="อื่นๆ" checked={payload.maintenance.problematicSystem.other} onChange={(c) => patchNested('maintenance', { problematicSystem: { ...payload.maintenance.problematicSystem, other: c } })} disabled={adminLocked} />
                    </div>
                    <LabeledInput label="อื่นๆ (ระบุ)" value={payload.maintenance.problematicSystem.otherDetail} onChange={(v) => patchNested('maintenance', { problematicSystem: { ...payload.maintenance.problematicSystem, otherDetail: v } })} disabled={adminLocked} className="mt-2" />
                    <div className="mt-2 flex flex-wrap gap-3">
                        <span className="text-xs font-semibold">ดำเนินการโดย:</span>
                        <Check label="ช่างภายในบริษัท" checked={payload.maintenance.performedBy.internal} onChange={(c) => patchNested('maintenance', { performedBy: { ...payload.maintenance.performedBy, internal: c } })} disabled={adminLocked} />
                        <Check label="จ้างภายนอก" checked={payload.maintenance.performedBy.external} onChange={(c) => patchNested('maintenance', { performedBy: { ...payload.maintenance.performedBy, external: c } })} disabled={adminLocked} />
                        <Check label="แจ้งผู้ขายตามเงื่อนไข" checked={payload.maintenance.performedBy.vendor} onChange={(c) => patchNested('maintenance', { performedBy: { ...payload.maintenance.performedBy, vendor: c } })} disabled={adminLocked} />
                    </div>
                    <LabeledTextarea label="การดำเนินการ / อุปกรณ์ที่เปลี่ยน" value={payload.maintenance.actionTaken} onChange={(v) => patchNested('maintenance', { actionTaken: v })} disabled={adminLocked} rows={4} />
                </Section>

                <Section title="ภาพประกอบ">
                    <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                            <p className="mb-1 text-xs font-semibold">ก่อนซ่อม</p>
                            {!readOnly && onPhotoBeforeChange && (
                                <input type="file" accept="image/*" onChange={(e) => onPhotoBeforeChange(e.target.files?.[0] || null)} className="mb-2 block w-full text-xs" />
                            )}
                            {photoBeforeUrl ? (
                                <img src={photoBeforeUrl} alt="before" className="max-h-48 w-full border border-gray-400 object-contain" />
                            ) : (
                                <div className="flex h-40 items-center justify-center border-2 border-dashed border-gray-400 text-xs text-gray-500">ไม่มีรูป</div>
                            )}
                        </div>
                        <div>
                            <p className="mb-1 text-xs font-semibold">หลังซ่อม</p>
                            {!readOnly && onPhotoAfterChange && (
                                <input type="file" accept="image/*" onChange={(e) => onPhotoAfterChange(e.target.files?.[0] || null)} className="mb-2 block w-full text-xs" />
                            )}
                            {photoAfterUrl ? (
                                <img src={photoAfterUrl} alt="after" className="max-h-48 w-full border border-gray-400 object-contain" />
                            ) : (
                                <div className="flex h-40 items-center justify-center border-2 border-dashed border-gray-400 text-xs text-gray-500">ไม่มีรูป</div>
                            )}
                        </div>
                    </div>
                </Section>

                <Section title="วิเคราะห์ / คำแนะนำ">
                    <div className="grid gap-3">
                        <LabeledInput label="สาเหตุ" value={payload.analysis.cause} onChange={(v) => patchNested('analysis', { cause: v })} disabled={adminLocked} />
                        <LabeledInput label="การป้องกัน" value={payload.analysis.prevention} onChange={(v) => patchNested('analysis', { prevention: v })} disabled={adminLocked} />
                        <LabeledInput label="คำแนะนำวิธีการใช้งาน" value={payload.analysis.usageInstructions} onChange={(v) => patchNested('analysis', { usageInstructions: v })} disabled={adminLocked} />
                    </div>
                </Section>

                <Section title="กรณีสั่งซื้อเครื่องมือ / อุปกรณ์">
                    <div className="grid gap-3 sm:grid-cols-3">
                        <LabeledInput label="วันที่สั่งซื้อ" type="date" value={payload.procurement.orderDate} onChange={(v) => patchNested('procurement', { orderDate: v })} disabled={adminLocked} />
                        <LabeledInput label="เลขที่ใบขอซื้อ" value={payload.procurement.prNo} onChange={(v) => patchNested('procurement', { prNo: v })} disabled={adminLocked} />
                        <LabeledInput label="ได้รับของวันที่" type="date" value={payload.procurement.receivedDate} onChange={(v) => patchNested('procurement', { receivedDate: v })} disabled={adminLocked} />
                    </div>
                </Section>

                <Section title="ระยะเวลา / ค่าใช้จ่าย / ผู้ดำเนินการ">
                    <div className="grid gap-3 sm:grid-cols-2">
                        <LabeledInput label="เริ่มดำเนินการในวันที่" type="date" value={payload.timeline.startDate} onChange={(v) => patchNested('timeline', { startDate: v })} disabled={adminLocked} />
                        <LabeledInput label="เสร็จวันที่" type="date" value={payload.timeline.completionDate} onChange={(v) => patchNested('timeline', { completionDate: v })} disabled={adminLocked} />
                        <LabeledInput label="รวมเวลาดำเนินการ (นาที)" value={payload.timeline.totalMinutes} onChange={(v) => patchNested('timeline', { totalMinutes: v })} disabled={adminLocked} />
                        <LabeledInput label="ค่าใช้จ่ายในการซ่อมบำรุง (บาท)" value={payload.timeline.costBaht} onChange={(v) => patchNested('timeline', { costBaht: v })} disabled={adminLocked} />
                        <LabeledInput label="ใช้เวลาซ่อมจริง (นาที)" value={payload.timeline.actualRepairMinutes} onChange={(v) => patchNested('timeline', { actualRepairMinutes: v })} disabled={adminLocked} />
                        <LabeledInput label="ผู้ดำเนินการ" value={payload.timeline.performedByName} onChange={(v) => patchNested('timeline', { performedByName: v })} disabled={adminLocked} />
                        <LabeledInput label="วันที่" type="date" value={payload.timeline.performedDate} onChange={(v) => patchNested('timeline', { performedDate: v })} disabled={adminLocked} />
                    </div>
                </Section>

                <Section title="ผลการตรวจรับงาน">
                    <div className="flex flex-wrap gap-4">
                        <Check label="ใช้งานได้ตามปกติ" checked={payload.inspection.result === 'normal'} onChange={() => patchNested('inspection', { result: 'normal' })} disabled={adminLocked} />
                        <Check label="ใช้งานได้ไม่ปกติ" checked={payload.inspection.result === 'abnormal'} onChange={() => patchNested('inspection', { result: 'abnormal' })} disabled={adminLocked} />
                    </div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <LabeledInput label="ผู้ตรวจรับงาน" value={payload.inspection.inspectorName} onChange={(v) => patchNested('inspection', { inspectorName: v })} disabled={adminLocked} />
                        <LabeledInput label="วันที่ (ผู้ตรวจ)" type="date" value={payload.inspection.inspectorDate} onChange={(v) => patchNested('inspection', { inspectorDate: v })} disabled={adminLocked} />
                        <LabeledInput label="ฝ่ายวางแผนการผลิต" value={payload.inspection.productionPlanningName} onChange={(v) => patchNested('inspection', { productionPlanningName: v })} disabled={adminLocked} />
                        <LabeledInput label="วันที่ (แผนการผลิต)" type="date" value={payload.inspection.productionPlanningDate} onChange={(v) => patchNested('inspection', { productionPlanningDate: v })} disabled={adminLocked} />
                    </div>
                </Section>
            </div>
        </div>
    );
}
