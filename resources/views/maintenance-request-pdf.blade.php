<!DOCTYPE html>
<html lang="th">
<head>
    <meta charset="UTF-8">
    <style>
        @if (!empty($fontUrl) && !empty($fontBoldUrl))
        @font-face {
            font-family: 'SarabunForm';
            font-style: normal;
            font-weight: normal;
            src: url('{{ $fontUrl }}') format('truetype');
        }
        @font-face {
            font-family: 'SarabunForm';
            font-style: normal;
            font-weight: bold;
            src: url('{{ $fontBoldUrl }}') format('truetype');
        }
        @endif
        /* หนึ่งหน้า A4 — ขนาดอ่านสบาย ใช้พื้นที่หน้าเกือบเต็ม */
        @page { size: A4 portrait; margin: 7mm 8mm; }
        * { box-sizing: border-box; }
        body {
            margin: 0;
            padding: 0;
            @if (!empty($fontUrl) && !empty($fontBoldUrl))
            font-family: 'SarabunForm', 'DejaVu Sans', sans-serif;
            @else
            font-family: 'DejaVu Sans', sans-serif;
            @endif
            font-size: 10.5px;
            line-height: 1.28;
            color: #000;
        }
        table.form {
            width: 100%;
            border-collapse: collapse;
            table-layout: fixed;
            margin: 0 0 5px;
        }
        table.form td,
        table.form th {
            border: 1px solid #000;
            padding: 2px 5px;
            vertical-align: top;
            text-align: left;
            word-wrap: break-word;
        }
        .logo-fallback {
            display: inline-block;
            border: 1px solid #000;
            padding: 3px 3px;
            font-weight: bold;
            font-size: 13px;
            letter-spacing: 1px;
        }
        .logo-img-wrap {
            display: inline-block;
            background-color: #fff;
            vertical-align: middle;
            padding: 2px 1px 2px 2px;
        }
        .logo-img {
            display: block;
            height: 26px;
            width: auto;
            max-width: 65px;
            object-fit: contain;
            background-color: #fff;
        }
        .co-th { font-size: 12px; font-weight: bold; line-height: 1.2; }
        .co-en { font-size: 10px; line-height: 1.2; }
        /* หัวซ้าย: คอลัมน์โลโก้แคบตามเนื้อหา — ลดช่องว่างก่อน co-th/co-en */
        table.form-header-brand {
            width: 100%;
            border-collapse: collapse;
            border: none;
            table-layout: auto;
        }
        table.form-header-brand td {
            border: none !important;
        }
        table.form-header-brand td.header-logo-col {
            width: 1%;
            white-space: nowrap;
            vertical-align: middle;
            padding: 0 4px 0 0 !important;
        }
        table.form-header-brand td.header-company-col {
            vertical-align: middle;
            padding: 0 !important;
        }
        .doc-title {
            font-size: 11.5px;
            font-weight: bold;
            line-height: 1.22;
            padding: 4px;
        }
        /* หัวเอกสารกึ่งกลางทั้งแนวนอนและแนวตั้งในแถวหัวตาราง */
        table.form td.doc-title {
            vertical-align: middle;
            text-align: center;
        }
        .doc-meta { font-size: 10px; line-height: 1.3; }
        .sec-head {
            font-weight: bold;
            background: #f0f0f0;
            font-size: 10.5px;
            padding: 3px 5px !important;
        }
        .lbl { font-size: 10px; }
        /* คอลัมน์เลขที่ใบแจ้งซ่อม (แคบ) */
        .doc-no-cell { font-size: 8.5px; line-height: 1.15; padding: 1px 1px !important; word-break: break-all; }
        .doc-no-val { font-size: 10px; font-weight: bold; }
        .fill {
            border-bottom: 1px dotted #000;
            min-height: 13px;
            display: block;
            margin-top: 1px;
            font-size: 10.5px;
            line-height: 1.28;
        }
        .preserve { white-space: pre-wrap; }
        /* หัวข้อชิดซ้ายตามเนื้อหา — ช่องค่าขยายไปขอบขวา เส้นประอยู่ใต้ช่องค่าเท่านั้น (ไม่ทับหัวข้อ) */
        table.field-line {
            width: 100%;
            table-layout: auto;
            border-collapse: collapse;
            margin: 0;
        }
        table.field-line td {
            border: none;
            padding: 0;
            vertical-align: bottom;
        }
        table.field-line td.field-lbl {
            white-space: nowrap;
            padding-right: 5px;
            font-size: 10px;
            font-weight: bold;
        }
        /* แถว 3 คอลัมน์ Dompdf: ป้ายยาว + nowrap ดันความกว้าง — ให้ห่อได้ในคอลัมน์แรกเท่านั้น */
        table.field-line td.field-lbl.field-lbl--wrap {
            white-space: normal;
        }
        /* ช่องวันที่ — ไม่เว้นหลังป้ายก่อนเส้นประ, ชิดค่า */
        table.field-line td.field-lbl.field-lbl--tight {
            padding-right: 0;
        }
        table.field-line td.field-fill {
            width: 100%;
            border-bottom: 1px dotted #000;
            font-size: 10.5px;
            line-height: 1.22;
            padding: 0 2px 2px 0;
            word-wrap: break-word;
        }
        table.field-line td.field-suf {
            white-space: nowrap;
            padding-left: 5px;
            font-size: 10px;
            vertical-align: bottom;
        }
        table.field-line td.field-fill .preserve {
            white-space: pre-wrap;
        }
        /* วันเวลา — ตารางชิดเนื้อหา (อย่า fixed+100% จะแบ่ง 2 คอลัมน์ครึ่งครึ่ง = ช่องว่างหลังป้ายใหญ่) */
        table.field-line.field-line--date-compact {
            table-layout: auto;
            width: auto;
            max-width: 100%;
        }
        table.field-line.field-line--date-compact td.field-lbl {
            width: 1%;
            vertical-align: bottom;
            white-space: nowrap;
        }
        table.field-line.field-line--date-compact td.field-fill {
            width: auto;
            border-bottom: none;
            vertical-align: bottom;
            white-space: nowrap;
        }
        table.field-line.field-line--date-compact td.field-fill .field-ruled {
            display: inline-block;
            border-bottom: 1px dotted #000;
            padding: 0 1px 2px 0;
            min-width: 0;
        }
        /* การดำเนินการ / อุปกรณ์ที่เปลี่ยน — ข้อความชิดซ้ายบน; เส้นประแถว 2–3 เต็มความกว้างช่อง (รวมใต้หัวข้อ) */
        table.field-line.field-line-action-block td {
            vertical-align: top;
        }
        table.field-line td.field-fill.field-fill--action-first {
            border-bottom: 1px dotted #000;
            vertical-align: top;
            padding-top: 0;
        }
        table.field-line td.field-fill.field-fill--action-first .preserve {
            display: block;
            max-height: 4.05em;
            overflow: hidden;
            white-space: pre-wrap;
        }
        table.field-line td.action-ruled-full {
            border: none;
            border-bottom: 1px dotted #000;
            min-height: 1.35em;
            font-size: 10.5px;
            line-height: 1.35;
            padding: 0 2px 2px 0;
            vertical-align: top;
        }
        /* ส่วนผู้แจ้ง: ซ้าย 88% / ขวา 12% — ใช้ % คู่กัน Dompdf ยึดได้ดี; ขวา min-width:0 กันเนื้อหาดันความกว้าง */
        table.form-reporter-wrap {
            width: 100%;
            table-layout: fixed;
            border-collapse: collapse;
            margin: 0 0 5px;
        }
        table.form-reporter-wrap td.reporter-main {
            width: 88%;
            padding: 0;
            vertical-align: top;
            border: none;
        }
        table.form-reporter-wrap td.reporter-rail {
            width: 12%;
            min-width: 0;
            max-width: 12%;
            padding: 0;
            vertical-align: top;
            border: 1px solid #000;
            border-left: none;
            overflow: hidden;
            word-break: break-all;
        }
        table.form-reporter-wrap td.reporter-rail .rail-box {
            max-width: 100%;
            overflow: hidden;
        }
        table.form-reporter-inner {
            width: 100%;
            margin: 0;
        }
        /* Dompdf/ตาราง fixed: แถวแรกที่เป็น colspan ทำให้คอลัมน์เท่ากัน — ต้องมีแถว 3 ช่องก่อน sec-head */
        table.form.form-reporter-inner {
            table-layout: fixed !important;
            margin-bottom: 0 !important;
        }
        tr.reporter-grid-lock td {
            padding: 0 !important;
            height: 1px !important;
            max-height: 2px !important;
            line-height: 0 !important;
            font-size: 0 !important;
            overflow: hidden !important;
            vertical-align: top;
            border-bottom: none !important;
        }
        tr.reporter-grid-lock td.reporter-grid-lock-a { width: 27% !important; }
        tr.reporter-grid-lock td.reporter-grid-lock-b { width: 36.5% !important; }
        tr.reporter-grid-lock td.reporter-grid-lock-c { width: 36.5% !important; }
        /* แถววัน/ผู้แจ้ง/เครื่องจักร — ไม่ใช้ grid เดียวกับลายเซ็น (ดู form-reporter-sign) */
        table.form.form-reporter-inner col.reporter-col-w-a { width: 27%; }
        table.form.form-reporter-inner col.reporter-col-w-b { width: 36.5%; }
        table.form.form-reporter-inner col.reporter-col-w-c { width: 36.5%; }
        table.form.form-reporter-inner td.reporter-td-date { width: 27%; }
        table.form.form-reporter-inner td.reporter-td-dept { width: 36.5%; }
        table.form.form-reporter-inner td.reporter-td-mach { width: 36.5%; }
        /* ลายเซ็น ผู้แจ้งซ่อม / ฝ่ายวางแผน / ผู้อนุมัติ — ตารางแยก 34/33/33 ไม่สืบทอดคอลัมน์แคบจากแถววันที่ */
        table.form.form-reporter-sign {
            width: 100%;
            margin: 0 0 5px !important;
            table-layout: fixed !important;
        }
        table.form.form-reporter-sign tr:first-child td {
            border-top: none;
        }
        .doc-no-rail {
            border-bottom: 1px solid #000;
            text-align: center;
        }
        .urgency-rail {
            text-align: center;
        }
        .cb-row { font-size: 10px; line-height: 1.38; padding: 3px 5px !important; }
        .urgency-cell {
            text-align: center;
            font-size: 8.5px;
            line-height: 1.15;
            padding: 1px 1px !important;
            vertical-align: top;
        }
        .urgency-cell strong { display: block; margin-bottom: 1px; font-size: 9px; }
        .urgency-cell .urgency-opts { text-align: left; padding: 0; font-size: 8px; line-height: 1.3; }
        .photo-frame {
            border: 1px solid #000;
            min-height: 216px;
            text-align: center;
            vertical-align: middle;
            padding: 4px;
            background-color: #fff;
        }
        .photo-frame img {
            max-width: 100%;
            max-height: 204px;
            object-fit: contain;
            background-color: #fff;
        }
        .photo-cap { font-weight: bold; font-size: 10px; margin-bottom: 3px; text-align: center; }
    </style>
</head>
<body>
@php
    $p = is_array($record->payload) ? $record->payload : [];
    $wt = is_array($p['workType'] ?? null) ? $p['workType'] : [];
    $m = is_array($p['maintenance'] ?? null) ? $p['maintenance'] : [];
    $mType = is_array($m['type'] ?? null) ? $m['type'] : [];
    $mPs = is_array($m['problematicSystem'] ?? null) ? $m['problematicSystem'] : [];
    $mPb = is_array($m['performedBy'] ?? null) ? $m['performedBy'] : [];
    $a = is_array($p['analysis'] ?? null) ? $p['analysis'] : [];
    $proc = is_array($p['procurement'] ?? null) ? $p['procurement'] : [];
    $tl = is_array($p['timeline'] ?? null) ? $p['timeline'] : [];
    $i = is_array($p['inspection'] ?? null) ? $p['inspection'] : [];
    $sig = is_array($p['signatures'] ?? null) ? $p['signatures'] : [];

    $mark = static fn (bool $on): string => $on ? '☑' : '☐';

    /*
     * Dompdf: ควรตั้ง base path = รากโปรเจกต์ (ดู MaintenanceRequestController::pdf) แล้วใช้ path สัมพันธ์ เช่น public/images/...
     * รูปก่อน/หลัง: public/storage/... ถ้ามี symlink ไม่เช่นนั้น storage/app/public/...
     * JPG ช่วยได้: Dompdf CPDF ฝัง JPEG โดยไม่ใช้ GD — PNG ใน Dompdf ยังเรียก imagecreatefrompng (ต้องมี GD)
     */
    $pdfImgProjectRel = static function (string $relativeFromProjectRoot): ?string {
        $rel = str_replace('\\', '/', ltrim($relativeFromProjectRoot, '/'));
        if (! is_file(base_path($rel))) {
            return null;
        }

        return $rel;
    };

    $maintenancePhotoProjectRel = static function (?string $dbPath): ?string {
        if ($dbPath === null || trim((string) $dbPath) === '') {
            return null;
        }
        $rel = str_replace('\\', '/', ltrim((string) $dbPath, '/'));
        $viaPublic = 'public/storage/'.$rel;
        if (is_file(base_path($viaPublic))) {
            return $viaPublic;
        }
        $viaStorage = 'storage/app/public/'.$rel;
        if (is_file(base_path($viaStorage))) {
            return $viaStorage;
        }

        return null;
    };

    $logoKanokSrc = $pdfImgProjectRel('public/images/logo-kanok.jpg')
        ?? $pdfImgProjectRel('public/images/logo-kanok.png');
    $imgBefore = $maintenancePhotoProjectRel($record->photo_before_path ?? null);
    $imgAfter = $maintenancePhotoProjectRel($record->photo_after_path ?? null);

    $na = ' ';
    $v = static fn ($x) => ($x !== null && trim((string) $x) !== '') ? $x : $na;

    $fmtNotified = $na;
    if (! empty($p['notifiedAt'])) {
        try {
            $tn = \Carbon\Carbon::parse($p['notifiedAt'])->timezone(config('app.timezone'));
            // Dompdf + ฟอนต์ไทย: เครื่องหมาย ':' ในช่วงเวลาอาจถูกแทนด้วยช่องว่าง/ไข่ปลา — ใช้จุดคั่นนาทีแทน
            $fmtNotified = $tn->format('d/m/Y').' '.$tn->format('H').'.'.$tn->format('i');
        } catch (\Throwable $e) {
            $fmtNotified = str_replace([':', '：'], '.', (string) $p['notifiedAt']);
        }
    }

    $isUrgent = (($p['urgency'] ?? 'normal') === 'urgent');
    $isNormal = ! $isUrgent;

    $wtOther = trim((string) ($wt['otherDetail'] ?? ''));

    $record->loadMissing('reviewedBy:id,name');
    $approverName = $record->reviewedBy?->name ?? '';

    $rn = trim((string) ($p['requesterName'] ?? ''));
    $dp = trim((string) ($p['department'] ?? ''));
    $requesterDeptLine = ($rn !== '' && $dp !== '') ? ($rn.' / '.$dp) : ($rn !== '' ? $rn : $dp);

    $res = $i['result'] ?? '';
    $abnormalLine = ($res === 'abnormal' && ! empty($i['abnormalReason'])) ? (string) $i['abnormalReason'] : '';
@endphp

{{-- 1. Header — โลโก้ (แทนข้อความ KANOK) + ชื่อบริษัทไชโยไปป์ + หัวกระดาษ + กล่องควบคุมเอกสาร --}}
<table class="form">
    <tr>
        <td style="width: 38%; vertical-align: middle;">
            <table class="form-header-brand">
                <tr>
                    <td class="header-logo-col">
                        @if (! empty($logoKanokSrc))
                            <span class="logo-img-wrap"><img src="{{ $logoKanokSrc }}" alt="" class="logo-img" /></span>
                        @else
                            <span class="logo-fallback">KANOK</span>
                        @endif
                    </td>
                    <td class="header-company-col">
                        <div class="co-th">บริษัท ไชโยไปป์ แอนด์ ฟิตติ้ง จำกัด</div>
                        <div class="co-en">CHAIYO PIPE AND FITTING CO., LTD.</div>
                    </td>
                </tr>
            </table>
        </td>
        <td style="width: 36%;" class="doc-title">
            ใบแจ้งซ่อม / สร้าง / ปรับปรุง / บำรุงรักษา เครื่องจักร
        </td>
        <td style="width: 26%;" class="doc-meta">
            <div><strong>เลขที่เอกสาร</strong> : FR-MTN-04</div>
            <div><strong>วันที่เริ่มบังคับใช้</strong> : 6 มกราคม 2563</div>
            <div><strong>แก้ไขครั้งที่</strong> : 1</div>
        </td>
    </tr>
</table>

{{-- 2. ส่วนของผู้แจ้ง — ตารางห่อ 2 คอลัมน์: ซ้าย 88% ขวา 12% (ขวาเทียบเดิม 4% × 3) --}}
<table class="form-reporter-wrap">
    <tr>
        <td class="reporter-main" width="88%" style="width: 88%;">
            <table class="form form-reporter-inner">
                <colgroup>
                    <col class="reporter-col-w-a" style="width: 27%;" />
                    <col class="reporter-col-w-b" style="width: 36.5%;" />
                    <col class="reporter-col-w-c" style="width: 36.5%;" />
                </colgroup>
                <tr class="reporter-grid-lock">
                    <td class="reporter-grid-lock-a">&#8203;</td>
                    <td class="reporter-grid-lock-b">&#8203;</td>
                    <td class="reporter-grid-lock-c">&#8203;</td>
                </tr>
                <tr>
                    <td colspan="3" class="sec-head">ส่วนของผู้แจ้ง</td>
                </tr>
                <tr>
                    <td class="lbl reporter-td-date" width="27%" style="width: 27%;"><table class="field-line field-line--date-compact"><tr><td class="field-lbl field-lbl--tight">วันที่ / เวลาแจ้ง:</td><td class="field-fill"><span class="field-ruled">{{ $v($fmtNotified) }}</span></td></tr></table></td>
                    <td class="lbl reporter-td-dept" width="36.5%" style="width: 36.5%;"><table class="field-line" width="100%"><tr><td class="field-lbl">ผู้แจ้ง / แผนก :</td><td class="field-fill">{{ $v($requesterDeptLine) }}</td></tr></table></td>
                    <td class="lbl reporter-td-mach" width="36.5%" style="width: 36.5%;"><table class="field-line" width="100%"><tr><td class="field-lbl">เครื่องจักร / อุปกรณ์ :</td><td class="field-fill">{{ $v($p['machineEquipment'] ?? '') }}</td></tr></table></td>
                </tr>
                <tr>
                    <td colspan="3" class="cb-row">
                        <strong>ประเภทงาน</strong> :
                        {{ $mark(! empty($wt['bm'])) }} 1. เครื่องขัดข้อง BM
                        &nbsp;&nbsp;
                        {{ $mark(! empty($wt['cm'])) }} 2. แก้ไข/ปรับปรุง CM
                        &nbsp;&nbsp;
                        {{ $mark(! empty($wt['pm'])) }} 3. หยุดเครื่อง PM
                        &nbsp;&nbsp;
                        {{ $mark(! empty($wt['other'])) }} 4. อื่นๆ
                        @if ($wtOther !== '')
                            <span class="fill" style="display:inline; border:none;"> {{ $wtOther }}</span>
                        @else
                            ...........................
                        @endif
                    </td>
                </tr>
                <tr>
                    <td colspan="3" class="lbl"><table class="field-line" width="100%"><tr><td class="field-lbl">อาการที่เสีย / ปัญหา / สาเหตุ / รายละเอียดอื่นๆ :</td><td class="field-fill"><div class="preserve" style="max-height: 52px; overflow: hidden;">{{ $v($p['symptoms'] ?? '') }}</div></td></tr></table></td>
                </tr>
                <tr>
                    <td colspan="3" class="lbl"><table class="field-line" width="100%"><tr><td class="field-lbl">หมายเหตุ :</td><td class="field-fill">{{ $v($p['remarks'] ?? '') }}</td></tr></table></td>
                </tr>
            </table>
            <table class="form form-reporter-sign">
                <tr>
                    <td class="lbl" width="34%" style="width: 34%; text-align: center;"><table class="field-line" width="100%"><tr><td class="field-lbl"><strong>ผู้แจ้งซ่อม</strong></td><td class="field-fill" style="text-align: center;">{{ $v($sig['reporter'] ?? '') }}</td></tr></table></td>
                    <td class="lbl" width="33%" style="width: 33%; text-align: center;"><table class="field-line" width="100%"><tr><td class="field-lbl"><strong>ฝ่ายวางแผน</strong></td><td class="field-fill" style="text-align: center;">{{ $na }}</td></tr></table></td>
                    <td class="lbl" width="33%" style="width: 33%; text-align: center;"><table class="field-line" width="100%"><tr><td class="field-lbl"><strong>ผู้อนุมัติ</strong></td><td class="field-fill" style="text-align: center;">{{ $v($approverName) }}</td></tr></table></td>
                </tr>
            </table>
        </td>
        <td class="reporter-rail" width="12%" style="width: 12%; max-width: 12%;">
            <div class="rail-box">
            <div class="doc-no-cell doc-no-rail">
                <strong>เลขที่ใบแจ้งซ่อม</strong><br>
                <span class="doc-no-val">{{ $record->notification_number }}</span>
            </div>
            <div class="urgency-cell urgency-rail">
                <strong>พิจารณา<br>ความเร่งด่วน</strong>
                <div class="urgency-opts">
                    {{ $mark($isUrgent) }} ด่วน<br>
                    {{ $mark($isNormal) }} ปกติ
                </div>
            </div>
            </div>
        </td>
    </tr>
</table>

{{-- 3. ส่วนของซ่อมบำรุง --}}
<table class="form">
    <tr><td colspan="3" class="sec-head">ส่วนของซ่อมบำรุง</td></tr>
    <tr>
        <td colspan="3" class="cb-row">
            <strong>ประเภท</strong> :
            {{ $mark(! empty($mType['machine'])) }} เครื่องจักร
            &nbsp;&nbsp;
            {{ $mark(! empty($mType['support'])) }} ระบบสนับสนุน
            &nbsp;&nbsp;
            {{ $mark(! empty($mType['general'])) }} ทั่วไป
        </td>
    </tr>
    <tr>
        <td style="width:34%" class="lbl"><table class="field-line" width="100%"><tr><td class="field-lbl">ผู้รับแจ้ง :</td><td class="field-fill">{{ $v($m['receiver'] ?? '') }}</td></tr></table></td>
        <td style="width:33%" class="lbl"><table class="field-line" width="100%"><tr><td class="field-lbl">หัวหน้าแผนก :</td><td class="field-fill">{{ $v($m['departmentHead'] ?? '') }}</td></tr></table></td>
        <td style="width:33%" class="lbl"><table class="field-line" width="100%"><tr><td class="field-lbl">คาดว่าจะเสร็จ :</td><td class="field-fill">{{ $v($m['expectedCompletion'] ?? '') }}</td></tr></table></td>
    </tr>
    <tr>
        <td colspan="3" class="cb-row">
            <strong>ระบบที่มีปัญหา</strong> :
            {{ $mark(! empty($mPs['electric'])) }} Electric
            &nbsp; {{ $mark(! empty($mPs['hydraulic'])) }} Hydraulic
            &nbsp; {{ $mark(! empty($mPs['pneumatic'])) }} Pneumatic
            &nbsp; {{ $mark(! empty($mPs['mechanic'])) }} Mechanic
            &nbsp; {{ $mark(! empty($mPs['water'])) }} water
            &nbsp; {{ $mark(! empty($mPs['other'])) }} Other
            @if (! empty($mPs['otherDetail']))
                … {{ $mPs['otherDetail'] }}
            @else
                ...........................
            @endif
        </td>
    </tr>
    <tr>
        <td colspan="3" class="cb-row">
            <strong>ดำเนินการโดย</strong> :
            {{ $mark(! empty($mPb['internal'])) }} ช่างภายในบริษัท
            &nbsp;&nbsp;
            {{ $mark(! empty($mPb['external'])) }} จ้างภายนอก
            &nbsp;&nbsp;
            {{ $mark(! empty($mPb['vendor'])) }} แจ้งผู้ขายตามเงื่อนไข
        </td>
    </tr>
    <tr>
        <td colspan="3" class="lbl">
            <table class="field-line field-line-action-block" width="100%">
                <tr>
                    <td class="field-lbl">การดำเนินการ / อุปกรณ์ที่เปลี่ยน :</td>
                    <td class="field-fill field-fill--action-first"><span class="preserve">{{ $v($m['actionTaken'] ?? '') }}</span></td>
                </tr>
                <tr>
                    <td colspan="2" class="action-ruled-full">&nbsp;</td>
                </tr>
                <tr>
                    <td colspan="2" class="action-ruled-full">&nbsp;</td>
                </tr>
            </table>
        </td>
    </tr>
</table>

{{-- 4. ภาพประกอบ --}}
<table class="form">
    <tr><td colspan="2" class="sec-head">ภาพประกอบ</td></tr>
    <tr>
        <td style="width:50%;">
            <div class="photo-cap">ก่อนซ่อม</div>
            <div class="photo-frame">
                @if ($imgBefore)
                    <img src="{{ $imgBefore }}" alt="" />
                @endif
            </div>
        </td>
        <td style="width:50%;">
            <div class="photo-cap">หลังซ่อม</div>
            <div class="photo-frame">
                @if ($imgAfter)
                    <img src="{{ $imgAfter }}" alt="" />
                @endif
            </div>
        </td>
    </tr>
</table>

{{-- 5. วิเคราะห์ / ป้องกัน / คำแนะนำ — แบบบรรทัดจุด --}}
<table class="form">
    <tr>
        <td colspan="2" class="lbl"><table class="field-line" width="100%"><tr><td class="field-lbl"><strong>สาเหตุ</strong> :</td><td class="field-fill">{{ $v($a['cause'] ?? '') }}</td></tr></table></td>
    </tr>
    <tr>
        <td colspan="2" class="lbl"><table class="field-line" width="100%"><tr><td class="field-lbl"><strong>การป้องกัน</strong> :</td><td class="field-fill">{{ $v($a['prevention'] ?? '') }}</td></tr></table></td>
    </tr>
    <tr>
        <td colspan="2" class="lbl"><table class="field-line" width="100%"><tr><td class="field-lbl"><strong>คำแนะนำวิธีการใช้งาน</strong> :</td><td class="field-fill">{{ $v($a['usageInstructions'] ?? '') }}</td></tr></table></td>
    </tr>
</table>

{{-- 6. กรณีสั่งซื้อ — หนึ่งแถวสามหัวข้อ --}}
<table class="form">
    <tr><td colspan="3" class="sec-head">กรณีสั่งซื้อเครื่องมือ / อุปกรณ์</td></tr>
    <tr>
        <td style="width:34%" class="lbl"><table class="field-line" width="100%"><tr><td class="field-lbl">วันที่สั่งซื้อ :</td><td class="field-fill">{{ $v($proc['orderDate'] ?? '') }}</td></tr></table></td>
        <td style="width: 33%;" class="lbl"><table class="field-line" width="100%"><tr><td class="field-lbl">เลขที่ใบขอซื้อ :</td><td class="field-fill">{{ $v($proc['prNo'] ?? '') }}</td></tr></table></td>
        <td style="width:33%" class="lbl"><table class="field-line" width="100%"><tr><td class="field-lbl">ได้รับของวันที่ :</td><td class="field-fill">{{ $v($proc['receivedDate'] ?? '') }}</td></tr></table></td>
    </tr>
</table>

{{-- 7. ระยะเวลา / ค่าใช้จ่าย --}}
<table class="form">
    <tr><td colspan="3" class="sec-head">ระยะเวลา / ค่าใช้จ่าย</td></tr>
    <tr>
        <td style="width:34%" class="lbl"><table class="field-line" width="100%"><tr><td class="field-lbl">เริ่มดำเนินการในวันที่ :</td><td class="field-fill">{{ $v($tl['startDate'] ?? '') }}</td></tr></table></td>
        <td style="width:33%" class="lbl"><table class="field-line" width="100%"><tr><td class="field-lbl">เสร็จวันที่ :</td><td class="field-fill">{{ $v($tl['completionDate'] ?? '') }}</td></tr></table></td>
        <td style="width:33%" class="lbl"><table class="field-line" width="100%"><tr><td class="field-lbl">รวมเวลาดำเนินการ :</td><td class="field-fill">{{ $v($tl['totalMinutes'] ?? '') }}</td><td class="field-suf">นาที</td></tr></table></td>
    </tr>
    <tr>
        <td colspan="2" class="lbl"><table class="field-line" width="100%"><tr><td class="field-lbl">ค่าใช้จ่ายในการซ่อมบำรุง :</td><td class="field-fill">{{ $v($tl['costBaht'] ?? '') }}</td><td class="field-suf">บาท</td></tr></table></td>
        <td class="lbl"><table class="field-line" width="100%"><tr><td class="field-lbl">ใช้เวลาซ่อมจริง :</td><td class="field-fill">{{ $v($tl['actualRepairMinutes'] ?? '') }}</td><td class="field-suf">นาที</td></tr></table></td>
    </tr>
</table>

{{-- 8. ท้ายแบบฟอร์ม — ผู้ดำเนินการ + ผลตรวจรับ + ลายเซ็นสี่ช่อง --}}
<table class="form">
    <tr>
        <td colspan="4" class="lbl"><table class="field-line" width="100%"><tr><td class="field-lbl"><strong>ผู้ดำเนินการ</strong> :</td><td class="field-fill">{{ $v($tl['performedByName'] ?? '') }}</td><td class="field-lbl">&nbsp;&nbsp;<strong>วันที่</strong> :</td><td class="field-fill">{{ $v($tl['performedDate'] ?? '') }}</td></tr></table></td>
    </tr>
    <tr>
        <td colspan="4" class="cb-row">
            <strong>ผลการตรวจรับงาน</strong> :
            {{ $mark($res === 'normal') }} ใช้งานได้ตามปกติ
            &nbsp;&nbsp;&nbsp;
            {{ $mark($res === 'abnormal') }} ใช้งานได้ไม่ปกติ
            @if ($abnormalLine !== '')
                <br><table class="field-line" width="100%" style="margin-top:4px;"><tr><td class="field-lbl"><strong>เหตุผล</strong> :</td><td class="field-fill"><div class="preserve" style="max-height: 36px; overflow: hidden;">{{ $abnormalLine }}</div></td></tr></table>
            @endif
        </td>
    </tr>
    <tr>
        <td style="width:25%; text-align:center;" class="lbl"><table class="field-line" width="100%"><tr><td class="field-lbl"><strong>ผู้ตรวจรับงาน</strong></td><td class="field-fill" style="text-align: center;">{{ $v($i['inspectorName'] ?? '') }}</td></tr></table></td>
        <td style="width:25%; text-align:center;" class="lbl"><table class="field-line" width="100%"><tr><td class="field-lbl"><strong>วันที่</strong></td><td class="field-fill" style="text-align: center;">{{ $v($i['inspectorDate'] ?? '') }}</td></tr></table></td>
        <td style="width:25%; text-align:center;" class="lbl"><table class="field-line" width="100%"><tr><td class="field-lbl"><strong>ฝ่ายวางแผนการผลิต</strong></td><td class="field-fill" style="text-align: center;">{{ $v($i['productionPlanningName'] ?? '') }}</td></tr></table></td>
        <td style="width:25%; text-align:center;" class="lbl"><table class="field-line" width="100%"><tr><td class="field-lbl"><strong>รับทราบวันที่</strong></td><td class="field-fill" style="text-align: center;">{{ $v($i['productionPlanningDate'] ?? '') }}</td></tr></table></td>
    </tr>
</table>
</body>
</html>
