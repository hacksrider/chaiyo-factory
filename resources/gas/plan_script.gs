// ─── Google Apps Script — Production Plan Web App ────────────────────────────
// Deploy as:  Web app → Execute as: Me → Who has access: Anyone
// ─────────────────────────────────────────────────────────────────────────────

var PLAN_SHEET    = 'แผนการผลิต';
var DAILY_SHEET   = 'Daily';
var MONTHLY_SHEET = 'Monthly';

// Chaiyo Data Center — รหัส/ชื่อสินค้า (getProductLookup)
// https://docs.google.com/spreadsheets/d/1DU1vKhImRmJlvb1nDv4PQTMObRoq1IuNkQzp9s0c-Qs
var DC_LOOKUP_SPREADSHEET_ID = '1DU1vKhImRmJlvb1nDv4PQTMObRoq1IuNkQzp9s0c-Qs';
/** ชีตที่มีคอลัมน์รหัสชิ้นงาน — เว้นว่าง = ชีตแรกของไฟล์ */
var DC_LOOKUP_CODE_SHEET = '';
/** ชีตที่มีคอลัมน์ชื่อชิ้นงาน — เว้นว่าง = ใช้ชีตเดียวกับรหัส (รหัส+ชื่ออยู่คนละคอลในชีตเดียวกัน) */
var DC_LOOKUP_NAME_SHEET = '';

function respond(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  try {
    var action  = String(e.parameter.action  || '').trim();
    var machine = String(e.parameter.machine || '').trim();
    var jobNo   = String(e.parameter.jobNo   || '').trim();
    var status  = String(e.parameter.status  || '').trim();

    if (action === 'getProductionPlan') return respond(getProductionPlan(machine, status));
    if (action === 'getDailyPlan')      return respond(getDailyPlan(machine, jobNo, String(e.parameter.sinceDate || '').trim()));
    if (action === 'getMonthlyPlan')    return respond(getMonthlyPlan(machine, jobNo));
    if (action === 'getHeaders')        return respond(getHeaders());
    if (action === 'getSample')         return respond(getSample(machine));
    if (action === 'getDailySample')    return respond(getDailySample());
    if (action === 'getProductLookup')  return respond(getProductLookup());
    if (action === 'getProductDetails') return respond(getProductDetails());

    return respond({ error: 'Unknown action: ' + action });
  } catch (err) {
    return respond({ error: err.message, stack: err.stack });
  }
}

// ─── doPost — write operations ────────────────────────────────────────────────

function doPost(e) {
  try {
    var params = JSON.parse(e.postData.contents);
    var action = String(params.action || '').trim();

    if (action === 'updateDailyProduced') return respond(updateDailyProduced(params));
    if (action === 'updatePlanProduced')  return respond(updatePlanProduced(params));

    return respond({ error: 'Unknown action: ' + action });
  } catch (err) {
    return respond({ error: err.message, stack: err.stack });
  }
}

// ─── updateDailyProduced ──────────────────────────────────────────────────────
// หา row ใน Daily sheet ที่ตรงกับ machineId + jobNo + date
// แล้ว update ช่องกะ A/B/C ด้วยจำนวนของดีที่ผลิตได้
//
// params: { machineId, jobNo, date (yyyy-MM-dd), shift ('A'|'B'|'C'), produced (number) }
// ─────────────────────────────────────────────────────────────────────────────

function updateDailyProduced(params) {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(DAILY_SHEET);
  if (!sheet) return { success: false, error: 'ไม่พบ Sheet: ' + DAILY_SHEET };

  var targetMachine = String(params.machineId || '').trim();
  var targetJobNo   = String(params.jobNo     || '').trim();
  var targetDate    = String(params.date      || '').trim(); // yyyy-MM-dd
  var shift         = String(params.shift     || '').toUpperCase().trim(); // A/B/C
  var produced      = Number(params.produced  || 0);

  if (!targetMachine || !targetJobNo || !shift) {
    return { success: false, error: 'Missing required params: machineId, jobNo, shift' };
  }

  var lastRow = sheet.getLastRow();
  var lastCol = Math.min(sheet.getLastColumn(), 22);
  if (lastRow < 2) return { success: false, error: 'Daily sheet is empty' };

  // ── หา header row เพื่อระบุ column index ────────────────────────────────
  var H = {};
  for (var r = 1; r <= Math.min(10, lastRow); r++) {
    var rowVals = sheet.getRange(r, 1, 1, lastCol).getValues()[0];
    for (var c = 0; c < rowVals.length; c++) {
      if (String(rowVals[c] || '').trim() === 'Mc No.') {
        for (var cc = 0; cc < rowVals.length; cc++) {
          var key = String(rowVals[cc] || '').replace(/\s+/g, '').toLowerCase();
          if (key) H[key] = cc;
        }
        break;
      }
    }
    if (Object.keys(H).length > 0) break;
  }

  function ph(/* keys */) {
    for (var i = 0; i < arguments.length; i++) {
      var k = String(arguments[i]).replace(/\s+/g, '').toLowerCase();
      if (H[k] !== undefined) return H[k];
    }
    return -1;
  }

  var IDX_DATE    = ph('วันที่', 'Date')                         >= 0 ? ph('วันที่', 'Date')                         :  0;
  var IDX_MACHINE = ph('Mc No.', 'MachineID', 'เครื่อง')         >= 0 ? ph('Mc No.', 'MachineID', 'เครื่อง')         :  3;
  var IDX_JOBNO   = ph('เลขใบขอ', 'JobNo', 'Job No')             >= 0 ? ph('เลขใบขอ', 'JobNo', 'Job No')             :  4;
  var IDX_SHIFT_A = ph('กะA', 'กะ A', 'ShiftA')                  >= 0 ? ph('กะA', 'กะ A', 'ShiftA')                  : 12;
  var IDX_SHIFT_B = ph('กะB', 'กะ B', 'ShiftB')                  >= 0 ? ph('กะB', 'กะ B', 'ShiftB')                  : 13;
  var IDX_SHIFT_C = ph('กะC', 'กะ C', 'ShiftC')                  >= 0 ? ph('กะC', 'กะ C', 'ShiftC')                  : 14;
  var IDX_TOTAL   = ph('รวม', 'Total')                            >= 0 ? ph('รวม', 'Total')                            : 15;

  var shiftColIdx = shift === 'A' ? IDX_SHIFT_A : shift === 'B' ? IDX_SHIFT_B : IDX_SHIFT_C;
  if (shiftColIdx < 0) return { success: false, error: 'ไม่พบ column กะ ' + shift };

  // ── สแกน rows หา match ──────────────────────────────────────────────────
  var data     = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var lastDate = '';
  var matched  = []; // เก็บ sheet row numbers ที่ match (1-indexed)

  for (var i = 0; i < data.length; i++) {
    var row = data[i];

    // Forward-fill date
    var rawDate = row[IDX_DATE];
    if (rawDate instanceof Date) {
      lastDate = fmtDate(rawDate);
    } else {
      var ds = String(rawDate || '').trim();
      if (ds && !ds.match(/^วันที่/) && !ds.match(/^Monthly/)) {
        var parsed = new Date(ds);
        lastDate = !isNaN(parsed) ? fmtDate(parsed) : ds;
      }
    }

    var rowMachine = String(row[IDX_MACHINE] || '').trim();
    var rowJobNo   = String(row[IDX_JOBNO]   || '').trim();

    // match: machineId + jobNo ต้องตรง; date ตรงด้วยถ้าส่งมา
    var dateMatch = !targetDate || lastDate === targetDate;
    if (rowMachine === targetMachine && rowJobNo === targetJobNo && dateMatch) {
      matched.push(i + 2); // +2: header row 1, data starts row 2
    }
  }

  if (matched.length === 0) {
    return { success: false, error: 'ไม่พบแถวที่ตรงกับ ' + targetMachine + ' / ' + targetJobNo + ' / ' + targetDate };
  }

  // อัปเดตทุก row ที่ match (ปกติควรมีแถวเดียว)
  var updated = 0;
  for (var m = 0; m < matched.length; m++) {
    var sheetRow = matched[m];
    // เขียนค่ากะที่เลือก
    sheet.getRange(sheetRow, shiftColIdx + 1).setValue(produced);

    // คำนวณ total ใหม่ = กะ A + B + C
    if (IDX_TOTAL >= 0) {
      var rowData = sheet.getRange(sheetRow, 1, 1, lastCol).getValues()[0];
      var a   = Number(rowData[IDX_SHIFT_A]) || 0;
      var b   = Number(rowData[IDX_SHIFT_B]) || 0;
      var c_  = Number(rowData[IDX_SHIFT_C]) || 0;
      // ใส่ค่าที่เพิ่งอัปเดตด้วย (rowData ยังเป็นค่าเก่า)
      if (shift === 'A') a   = produced;
      if (shift === 'B') b   = produced;
      if (shift === 'C') c_  = produced;
      sheet.getRange(sheetRow, IDX_TOTAL + 1).setValue(a + b + c_);
    }
    updated++;
  }

  return { success: true, updated: updated, rows: matched };
}

// ─── updatePlanProduced ───────────────────────────────────────────────────────
// อัปเดต Sheet "แผนการผลิต" เมื่อกด Finished Order:
//   1. หาแถวที่คอลัม A = jobNo
//   2. หาคอลัมวันที่ตรงกับ date แล้ว **บวกสะสม** goodCount ลงไป
//   3. คอลัม V (น้ำหนักของดี) — บวกสะสม goodWeight
//   4. คอลัม W (น้ำหนักของเสีย) — บวกสะสม ngWeight
//   5. คอลัม X (พนักงานนั่งเครื่อง) — ต่อท้าย employeeId (ไม่ซ้ำ, คั่นด้วย ", ")
//
// params: { jobNo, date (yyyy-MM-dd), goodCount, goodWeight, ngWeight, employeeId }
// ─────────────────────────────────────────────────────────────────────────────

function updatePlanProduced(params) {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(PLAN_SHEET);
  if (!sheet) return { success: false, error: 'ไม่พบ Sheet: ' + PLAN_SHEET };

  var targetJobNo    = String(params.jobNo       || '').trim();
  var targetDate     = String(params.date        || '').trim(); // yyyy-MM-dd
  var goodCount      = Number(params.goodCount   || 0);
  var goodWeight     = Number(params.goodWeight  || 0);
  var ngWeight       = Number(params.ngWeight    || 0);
  var employeeId     = String(params.employeeId  || '').trim();

  if (!targetJobNo) return { success: false, error: 'Missing required param: jobNo' };

  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2) return { success: false, error: 'แผนการผลิต sheet is empty' };

  // ── อ่าน header row ────────────────────────────────────────────────────────
  var rawHdrs = sheet.getRange(1, 1, 1, lastCol).getValues()[0];

  // สร้าง header map (ชื่อ → index) และหา date column index
  var H = {};
  var targetDateColIdx = -1;

  for (var c = 0; c < rawHdrs.length; c++) {
    var rawH = rawHdrs[c];
    if (rawH instanceof Date) {
      // เปรียบเทียบกับ targetDate
      var colDateStr = Utilities.formatDate(rawH, 'Asia/Bangkok', 'yyyy-MM-dd');
      if (colDateStr === targetDate) targetDateColIdx = c;
    } else {
      var key = normHeader(rawH);
      if (key) H[key] = c;
    }
  }

  // หา index ของคอลัมแบบตายตัว V/W/X (ถ้าไม่เจอจาก header ให้ fallback ตาม 0-based index)
  function hIdx(/* names */) {
    for (var i = 0; i < arguments.length; i++) {
      var k = String(arguments[i]);
      if (H[k] !== undefined) return H[k];
    }
    return -1;
  }

  var IDX_GOOD_WEIGHT = hIdx('น้ำหนักของดี (Kg)', 'น้ำหนักของดี(Kg)', 'น้ำหนักของดี');
  var IDX_NG_WEIGHT   = hIdx('น้ำหนักของเสีย (Kg)', 'น้ำหนักของเสีย(Kg)', 'น้ำหนักของเสีย');
  var IDX_OPERATOR    = hIdx('พนักงานนั่งเครื่อง');

  // fallback ตาม column letter V=21, W=22, X=23 (0-based)
  if (IDX_GOOD_WEIGHT < 0) IDX_GOOD_WEIGHT = 21;
  if (IDX_NG_WEIGHT   < 0) IDX_NG_WEIGHT   = 22;
  if (IDX_OPERATOR    < 0) IDX_OPERATOR    = 23;

  // ── สแกนหาแถวที่ column A = targetJobNo ───────────────────────────────────
  var data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var matched = [];
  for (var i = 0; i < data.length; i++) {
    var cellA = String(data[i][0] || '').trim();
    if (cellA === targetJobNo) {
      matched.push({ dataIdx: i, sheetRow: i + 2 });
    }
  }

  if (matched.length === 0) {
    return { success: false, error: 'ไม่พบเลขใบคำขอ ' + targetJobNo + ' ในแผนการผลิต' };
  }

  var updated = 0;
  for (var m = 0; m < matched.length; m++) {
    var sheetRow = matched[m].sheetRow;

    // 1) บวกสะสม goodCount ลงคอลัมวันที่ (ถ้าหาวันที่เจอ)
    if (targetDateColIdx >= 0) {
      var dateCell = sheet.getRange(sheetRow, targetDateColIdx + 1);
      var existing = Number(dateCell.getValue()) || 0;
      dateCell.setValue(existing + goodCount);
    }

    // 2) บวกสะสม น้ำหนักของดี (col V)
    if (IDX_GOOD_WEIGHT >= 0 && goodWeight > 0) {
      var gwCell = sheet.getRange(sheetRow, IDX_GOOD_WEIGHT + 1);
      gwCell.setValue((Number(gwCell.getValue()) || 0) + goodWeight);
    }

    // 3) บวกสะสม น้ำหนักของเสีย (col W)
    if (IDX_NG_WEIGHT >= 0 && ngWeight > 0) {
      var nwCell = sheet.getRange(sheetRow, IDX_NG_WEIGHT + 1);
      nwCell.setValue((Number(nwCell.getValue()) || 0) + ngWeight);
    }

    // 4) ต่อท้าย employeeId (col X) — ไม่ซ้ำ, คั่นด้วย ", "
    if (IDX_OPERATOR >= 0 && employeeId) {
      var opCell   = sheet.getRange(sheetRow, IDX_OPERATOR + 1);
      var existing = String(opCell.getValue() || '').trim();
      var ids      = existing ? existing.split(',').map(function(x) { return x.trim(); }) : [];
      if (ids.indexOf(employeeId) < 0) {
        ids.push(employeeId);
        opCell.setValue(ids.join(', '));
      }
    }

    updated++;
  }

  return {
    success: true,
    updated: updated,
    rows: matched.map(function(m) { return m.sheetRow; }),
    dateColFound: targetDateColIdx >= 0,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(v) {
  if (!v) return '';
  if (v instanceof Date) return Utilities.formatDate(v, 'Asia/Bangkok', 'yyyy-MM-dd');
  var s = String(v).trim();
  return s;
}

/**
 * Normalise a raw cell header value to a stable string key:
 *   - collapses whitespace (tabs, multiple spaces) to single space
 *   - replaces newlines with space
 *   - trims
 * Returns '__date__' if the raw value is a Date object.
 */
function normHeader(raw) {
  if (raw instanceof Date) return '__date__';
  return String(raw).replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// ─── Debug ────────────────────────────────────────────────────────────────────

function getHeaders() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var out = {};
  [PLAN_SHEET, DAILY_SHEET, MONTHLY_SHEET].forEach(function(name) {
    var sheet = ss.getSheetByName(name);
    if (!sheet) { out[name] = 'NOT FOUND'; return; }
    var raw = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    out[name] = raw.map(function(h) {
      return h instanceof Date
        ? 'DATE:' + Utilities.formatDate(h, 'Asia/Bangkok', 'yyyy-MM-dd')
        : String(h);
    });
  });
  return out;
}

function getSample(machine) {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(PLAN_SHEET);
  if (!sheet) return { error: 'ไม่พบ Sheet: ' + PLAN_SHEET };

  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  var rawHdrs = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var rows    = sheet.getRange(2, 1, Math.min(5, lastRow - 1), lastCol).getValues();

  var normHdrs = rawHdrs.map(function(h, i) {
    return h instanceof Date
      ? 'DATE:' + Utilities.formatDate(h, 'Asia/Bangkok', 'yyyy-MM-dd')
      : normHeader(h) + ' [col' + (i + 1) + ']';
  });

  var samples = rows.map(function(row) {
    var obj = {};
    normHdrs.forEach(function(h, i) { obj[h] = row[i]; });
    return obj;
  });

  return {
    sheetName: PLAN_SHEET,
    headers:   normHdrs,
    totalRows: lastRow - 1,
    totalCols: lastCol,
    machineFilter: machine,
    samples:   samples,
  };
}

// ─── getProductionPlan ────────────────────────────────────────────────────────
//
// SPEED OPTIMISATION: reads ONLY fixed columns (skips 90+ date columns).
// Date columns start where Date objects appear in the header row.
// dailyProduction is intentionally left empty {} — the frontend fetches
// per-order daily data lazily via getDailyPlan when the user expands a card.

function getProductionPlan(machine, status) {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(PLAN_SHEET);
  if (!sheet) return { error: 'ไม่พบ Sheet: ' + PLAN_SHEET };

  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2) return [];

  // ── Step 1: Read ONLY the header row (cheap) ──────────────────────────────
  var rawHdrs = sheet.getRange(1, 1, 1, lastCol).getValues()[0];

  var H            = {};   // normalisedHeader → colIndex
  var firstDateCol = lastCol; // will be the index of the first Date-header column

  for (var c = 0; c < rawHdrs.length; c++) {
    if (rawHdrs[c] instanceof Date) {
      if (c < firstDateCol) firstDateCol = c; // mark where date zone begins
    } else {
      var key = normHeader(rawHdrs[c]);
      if (key) H[key] = c;
    }
  }

  // ── Step 2: Read ONLY the fixed columns (skip 90+ date columns) ───────────
  // e.g. 25 cols instead of 115 → ~4-5× less data → much faster
  var fixedCols = firstDateCol; // how many columns to actually read
  var data = sheet.getRange(2, 1, lastRow - 1, fixedCols).getValues();

  // Helpers ──────────────────────────────────────────────────────────────────
  function v(row, name) {
    var idx = H[name];
    return (idx !== undefined && idx < fixedCols) ? row[idx] : '';
  }
  function n(row, name) { return Number(v(row, name))          || 0; }
  function s(row, name) { return String(v(row, name) || '').trim(); }
  function d(row, name) { return fmtDate(v(row, name));            }

  // ── Step 3: Map rows ───────────────────────────────────────────────────────
  var result = [];
  for (var r = 0; r < data.length; r++) {
    var row = data[r];

    // Job number = column A (index 0) regardless of header text
    var jobNo = String(row[0] || '').trim();
    if (!jobNo) continue;

    var machineId = s(row, 'EM');
    var rowStatus = s(row, 'Status');

    if (machine && machineId !== machine) continue;
    if (status  && rowStatus !== status)  continue;

    result.push({
      jobNo:            jobNo,
      machineId:        machineId,
      productCode:      s(row, 'Product'),
      productName:      s(row, 'Product name'),
      productType:      s(row, 'ประเภทงาน'),
      supplier:         s(row, 'Supplier'),
      status:           rowStatus,
      seq:              n(row, 'No.'),
      month:            n(row, 'MONTH'),
      plannedQty:       n(row, 'จำนวน วางแผนผลิต'),
      producedQty:      n(row, 'จำนวนที่ผลิตแล้ว'),
      weightPerUnit:    n(row, 'Weight'),
      totalOrderWeight: n(row, 'น้ำหนักยอดสั่งผลิตรวมทั้งหมด'),
      goodWeight:       n(row, 'น้ำหนักของดี (Kg)'),
      ngWeight:         n(row, 'น้ำหนักของเสีย (Kg)'),
      mcCapacityKg:     n(row, 'กำลังผลิต MC (Kg/Day)'),
      mcCapacityRolls:  n(row, 'กำลังผลิต PD (ม้วน/วัน)'),
      operatorId:       s(row, 'พนักงานนั่งเครื่อง'),
      technicianId:     s(row, 'ช่างประจำเครื่อง'),
      diff:             n(row, 'Diff.'),
      dueDate:          d(row, 'กำหนดส่งสินค้า'),
      startDate:        d(row, 'วันที่เริ่มผลิต'),
      expectedFinish:   d(row, 'วันที่คาดว่าจะเสร็จ'),
      actualFinish:     d(row, 'วันที่ผลิตเสร็จ'),
      dailyProduction:  {},  // intentionally empty — loaded lazily per-order
    });
  }
  return result;
}

// ─── getDailyPlan ─────────────────────────────────────────────────────────────
//
// FIX: Daily sheet row 1 is ALL EMPTY (merged decorative title cells).
//   The real column headers ("วันที่", "Mc No.", "เลขใบขอ" …) live in a later
//   row that repeats for each day block.
//
// Strategy:
//   1. Scan the first 8 rows to find the actual column-header row.
//   2. Use those indices; fall back to known hard-coded positions if not found.
//   3. Identify real data rows by checking that IDX_MACHINE column looks like
//      a machine ID (starts with "EM " followed by digits).
//   4. Forward-fill the date across merged cells (blank col A = same date).
//
// Column layout (confirmed via getDailySample):
//   A=0 วันที่  B=1 Monthly  C=2 ลำดับ  D=3 Mc No.  E=4 เลขใบขอ  F=5 รหัสสินค้า
//   G=6 เป้าหมาย/กะ  H=7 เป้าหมาย/วัน  I=8 ยอดสั่ง  J=9 ผลิตแล้ว
//   K=10 ค้างผลิต  L=11 (empty)  M=12 กะ A  N=13 กะ B  O=14 กะ C
//   P=15 รวม  Q=16 %ทำได้จริง (decimal)  …  U=20 status ("OVER DUE" etc.)
//   NOTE: No ชื่อสินค้า column in this sheet.

function getDailyPlan(machine, jobNo, sinceDate) {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(DAILY_SHEET);
  if (!sheet) return { error: 'ไม่พบ Sheet: ' + DAILY_SHEET };

  var lastRow = sheet.getLastRow();
  var lastCol = Math.min(sheet.getLastColumn(), 22);
  if (lastRow < 2) return [];

  // ── Step 1: Find the real column-header row ─────────────────────────────
  // IMPORTANT: Only trigger on "Mc No." — "วันที่" appears earlier in a summary
  // area (row 2 col 12) which would give wrong column indices. "Mc No." uniquely
  // identifies the actual data-header row (row 4, then repeating every ~12 rows).
  var H = {};
  var headerFound = false;
  for (var r = 1; r <= Math.min(10, lastRow); r++) {
    var rowVals = sheet.getRange(r, 1, 1, lastCol).getValues()[0];
    for (var c = 0; c < rowVals.length; c++) {
      var cell = String(rowVals[c] || '').trim();
      if (cell === 'Mc No.') {
        // This is the real header row — map all non-empty cells
        for (var cc = 0; cc < rowVals.length; cc++) {
          var key = normHeader(rowVals[cc]);
          if (key) H[key] = cc;
        }
        headerFound = true;
        break;
      }
    }
    if (headerFound) break;
  }

  // ── Step 2: Resolve column indices (header map → hardcoded fallback) ────
  function pickH() {
    for (var i = 0; i < arguments.length; i++) {
      if (H[arguments[i]] !== undefined) return H[arguments[i]];
    }
    return -1;
  }

  // Actual column layout (confirmed via getDailySample):
  // A=0 วันที่  B=1 Monthly  C=2 ลำดับ  D=3 Mc No.  E=4 เลขใบขอ  F=5 รหัสสินค้า
  // G=6 เป้าหมาย/กะ  H=7 เป้าหมาย/วัน  I=8 ยอดสั่ง  J=9 ผลิตแล้ว
  // K=10 ค้างผลิต  L=11 (empty)  M=12 กะ A  N=13 กะ B  O=14 กะ C
  // P=15 รวม  Q=16 %ทำได้จริง (stored as decimal 0.0–1.0)
  // R=17 deadline1  S=18 deadline2  T=19 flag  U=20 status/OVER DUE  V=21 weight
  // NOTE: There is NO ชื่อสินค้า column in this sheet.

  var IDX_DATE     = pickH('วันที่',        'Date')                        >= 0 ? pickH('วันที่',        'Date')                        :  0;
  var IDX_MACHINE  = pickH('Mc No.',        'MachineID', 'EM', 'เครื่อง') >= 0 ? pickH('Mc No.',        'MachineID', 'EM', 'เครื่อง') :  3;
  var IDX_JOBNO    = pickH('เลขใบขอ',       'JobNo',     'Job No')         >= 0 ? pickH('เลขใบขอ',       'JobNo',     'Job No')         :  4;
  var IDX_PRODCODE = pickH('รหัสสินค้า',    'Product',   'ProductCode')    >= 0 ? pickH('รหัสสินค้า',    'Product',   'ProductCode')    :  5;
  // No ชื่อสินค้า column — IDX_PRODNAME stays -1; productName will be empty
  var IDX_PRODNAME = pickH('ชื่อสินค้า',    'Product name', 'ProductName');
  var IDX_TGT_SFT  = pickH('เป้าหมาย/กะ',  'เป้า/กะ',  'Target/Shift')   >= 0 ? pickH('เป้าหมาย/กะ',  'เป้า/กะ',  'Target/Shift')   :  6;
  var IDX_TGT_DAY  = pickH('เป้าหมาย/วัน', 'เป้า/วัน', 'Target/Day')     >= 0 ? pickH('เป้าหมาย/วัน', 'เป้า/วัน', 'Target/Day')     :  7;
  var IDX_ORDERED  = pickH('ยอดสั่ง',       'Total Ordered')               >= 0 ? pickH('ยอดสั่ง',       'Total Ordered')               :  8;
  var IDX_PRODUCED = pickH('ผลิตแล้ว',      'Produced')                    >= 0 ? pickH('ผลิตแล้ว',      'Produced')                    :  9;
  var IDX_REMAIN   = pickH('ค้างผลิต',      'Remaining')                   >= 0 ? pickH('ค้างผลิต',      'Remaining')                   : 10;
  var IDX_SHIFT_A  = pickH('กะ A', 'กะA',   'ShiftA')                      >= 0 ? pickH('กะ A', 'กะA',   'ShiftA')                      : 12;
  var IDX_SHIFT_B  = pickH('กะ B', 'กะB',   'ShiftB')                      >= 0 ? pickH('กะ B', 'กะB',   'ShiftB')                      : 13;
  var IDX_SHIFT_C  = pickH('กะ C', 'กะC',   'ShiftC')                      >= 0 ? pickH('กะ C', 'กะC',   'ShiftC')                      : 14;
  var IDX_TOTAL    = pickH('รวม',    'Total')                               >= 0 ? pickH('รวม',    'Total')                               : 15;
  var IDX_PCT      = pickH('%ทำได้จริง', '%')                               >= 0 ? pickH('%ทำได้จริง', '%')                               : 16;
  // No หมายเหตุ column — col 20 has status text ("OVER DUE" etc.)
  var IDX_REMARKS  = pickH('หมายเหตุ', 'Remarks', 'Status')                >= 0 ? pickH('หมายเหตุ', 'Remarks', 'Status')                : 20;

  // ── Step 3: Find starting row (ถ้ามี sinceDate) แล้ว Read data ──────────
  // อ่าน column วันที่ (col A) ก่อน เพื่อหา row แรกที่ date >= sinceDate
  // → ไม่ต้องอ่านข้อมูลทุก column ของ row เก่าที่ไม่ต้องการ

  var useSinceFilter = sinceDate && sinceDate.length === 10 && !jobNo;
  var startDataRow   = 2; // row เริ่มต้นอ่านข้อมูล (1-indexed, row 1 = header)

  if (useSinceFilter && lastRow > 2) {
    // อ่านเฉพาะ column A (วันที่) ทั้งหมด — เร็วกว่าอ่านทุก column มาก
    var dateCol  = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    var lastFill = '';
    var cutoff   = 2; // row ที่ date < sinceDate ล่าสุด (scan from bottom up)
    for (var di = dateCol.length - 1; di >= 0; di--) {
      var dv = dateCol[di][0];
      if (dv instanceof Date) {
        lastFill = fmtDate(dv);
      } else {
        var dvs = String(dv || '').trim();
        if (dvs && !dvs.match(/^วันที่/) && !dvs.match(/^Monthly/)) lastFill = dvs;
      }
      if (lastFill && lastFill < sinceDate) {
        cutoff = di + 3; // +2: 1-indexed sheet row, +1: start AFTER this row
        break;
      }
    }
    startDataRow = Math.max(2, cutoff - 5); // buffer 5 rows for safety (merged cells)
  }

  var dataRows = lastRow - startDataRow;
  var data     = dataRows > 0 ? sheet.getRange(startDataRow, 1, dataRows, lastCol).getValues() : [];
  var result   = [];
  var lastDate = '';

  for (var i = 0; i < data.length; i++) {
    var row = data[i];

    // Only accept rows whose machine column looks like a real machine ID
    var rawMachine = String(row[IDX_MACHINE] || '').trim();
    if (!rawMachine || !rawMachine.match(/^EM\s*\d/i)) continue;

    // Forward-fill the date (merged cells leave col A blank after the first row of each day)
    var rawDate = row[IDX_DATE];
    if (rawDate instanceof Date) {
      lastDate = fmtDate(rawDate);
    } else {
      var ds = String(rawDate || '').trim();
      if (ds && !ds.match(/^วันที่/) && !ds.match(/^Monthly/)) {
        var parsed = new Date(ds);
        if (!isNaN(parsed)) {
          lastDate = fmtDate(parsed);
        } else {
          lastDate = ds; // keep raw string for unusual formats
        }
      }
      // blank → keep lastDate (same day as above)
    }

    // ข้ามข้อมูลที่เก่ากว่า sinceDate (เช่น ประวัติก่อนเมื่อวาน)
    if (useSinceFilter && lastDate && lastDate < sinceDate) continue;

    var mid = rawMachine;
    var jno = String(row[IDX_JOBNO] || '').trim();

    if (machine && mid !== machine) continue;
    if (jobNo   && jno !== jobNo)   continue;

    // achievementPct is stored as a decimal (0.0–1.0) → convert to percentage (0–100)
    var rawPct = Number(row[IDX_PCT]) || 0;
    var pct    = rawPct <= 1 ? Math.round(rawPct * 1000) / 10 : Math.round(rawPct * 10) / 10;

    result.push({
      date:           lastDate,
      machineId:      mid,
      jobNo:          jno,
      productCode:    String(row[IDX_PRODCODE] || '').trim(),
      productName:    IDX_PRODNAME >= 0 ? String(row[IDX_PRODNAME] || '').trim() : '',
      targetPerShift: Math.round((Number(row[IDX_TGT_SFT]) || 0) * 10) / 10,
      targetPerDay:   Math.round((Number(row[IDX_TGT_DAY])  || 0) * 10) / 10,
      totalOrdered:   Number(row[IDX_ORDERED])   || 0,
      totalProduced:  Number(row[IDX_PRODUCED])  || 0,
      remaining:      Number(row[IDX_REMAIN])    || 0,
      shiftA:         Number(row[IDX_SHIFT_A])   || 0,
      shiftB:         Number(row[IDX_SHIFT_B])   || 0,
      shiftC:         Number(row[IDX_SHIFT_C])   || 0,
      totalPerDay:    Number(row[IDX_TOTAL])      || 0,
      achievementPct: pct,
      remarks:        String(row[IDX_REMARKS] || '').trim(),
    });
  }
  return result;
}

// ─── getDailySample — debug: raw column values from Daily sheet ──────────────

function getDailySample() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(DAILY_SHEET);
  if (!sheet) return { error: 'ไม่พบ Sheet: ' + DAILY_SHEET };

  var lastCol = Math.min(sheet.getLastColumn(), 22);
  var cols    = [];
  for (var c = 0; c < lastCol; c++) {
    cols.push('col' + c + '(col' + String.fromCharCode(65 + c) + ')');
  }

  var result = [];
  for (var r = 1; r <= Math.min(15, sheet.getLastRow()); r++) {
    var row = sheet.getRange(r, 1, 1, lastCol).getValues()[0];
    var obj = { _sheetRow: r };
    for (var c = 0; c < row.length; c++) {
      var v = row[c];
      obj['col' + c] = v instanceof Date
        ? 'DATE:' + Utilities.formatDate(v, 'Asia/Bangkok', 'yyyy-MM-dd')
        : v;
    }
    result.push(obj);
  }
  return { cols: cols, rows: result };
}

// ─── getMonthlyPlan ───────────────────────────────────────────────────────────

function getMonthlyPlan(machine, jobNo) {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(MONTHLY_SHEET);
  if (!sheet) return { error: 'ไม่พบ Sheet: ' + MONTHLY_SHEET };

  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2) return [];

  var rawHdrs = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var headers = rawHdrs.map(normHeader);
  var data    = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

  var H = {};
  headers.forEach(function(h, i) { if (h) H[h] = i; });

  function pickIdx2(/* ...names */) {
    for (var i = 0; i < arguments.length; i++) {
      if (H[arguments[i]] !== undefined) return H[arguments[i]];
    }
    return -1;
  }

  var idxJobNo   = pickIdx2('JobNo', 'เลขใบขอ', 'Job No');
  var idxMachine = pickIdx2('MachineID', 'Machine', 'EM', 'เครื่อง');
  if (idxJobNo < 0)   idxJobNo   = 0;
  if (idxMachine < 0) idxMachine = 2;

  var result = [];
  data.forEach(function(row) {
    var jno = String(row[idxJobNo]   || '').trim();
    var mid = String(row[idxMachine] || '').trim();
    if (!jno) return;
    if (machine && mid !== machine) return;
    if (jobNo   && jno !== jobNo)   return;

    var obj = { jobNo: jno, machineId: mid };
    headers.forEach(function(h, i) { if (h) obj[h] = row[i]; });
    result.push(obj);
  });
  return result;
}

// ─── getProductLookup — read product codes + names from Chaiyo Data Center ───
//
// ใช้ Script ชุดเดียวกับแผนผลิต (ไฟล์นี้ / deploy เป็น GAS_PLAN_URL) — Laravel เรียก action=getProductLookup
//
// ตั้งชื่อชีตที่ต้นไฟล์: DC_LOOKUP_CODE_SHEET / DC_LOOKUP_NAME_SHEET
//   - ทั้งคู่ว่าง → อ่านชีตแรก คอลัมน์รหัส + ชื่อในชีตเดียวกัน (แถวเดียวกัน)
//   - กำหนดทั้งสองเป็นคนละชื่อ → อ่านข้ามชีต (ดู dcBuildLookup_ ด้านล่าง)
//
// Returns: { "398-16(PN2.5)": "ท่อเกษตรพีอี (PN2.5)...", ... }

function dcGetSheetByName_(ss, sheetName) {
  var n = String(sheetName || '').trim();
  if (n) {
    var sh = ss.getSheetByName(n);
    if (sh) return sh;
  }
  return ss.getSheets()[0];
}

/** หาแถวหัวตาราง + index คอลัมน์รหัส / ชื่อ */
function dcDetectHeaderIndices_(data) {
  var IDX_CODE = -1;
  var IDX_NAME = -1;
  var dataStart = 1;

  for (var r = 0; r < Math.min(10, data.length); r++) {
    for (var c = 0; c < data[r].length; c++) {
      var cell = normHeader(data[r][c]);
      var low = cell.toLowerCase();
      if (cell === 'รหัสชิ้นงาน' || low === 'productcode' || cell === 'รหัส') {
        IDX_CODE = c;
        dataStart = r + 1;
      }
      if (cell.indexOf('ชื่อชิ้นงาน') === 0 || low === 'productname' || cell === 'ชื่อสินค้า') {
        IDX_NAME = c;
        dataStart = r + 1;
      }
    }
  }
  if (IDX_CODE < 0) IDX_CODE = 3;
  if (IDX_NAME < 0) IDX_NAME = 4;
  return { idxCode: IDX_CODE, idxName: IDX_NAME, dataStart: dataStart };
}

function dcMapFromOneSheet_(data, idxCode, idxName, dataStart) {
  var result = {};
  for (var i = dataStart; i < data.length; i++) {
    var code = String(data[i][idxCode] || '').trim();
    var name = String(data[i][idxName] || '').trim();
    if (code) result[code] = name;
  }
  return result;
}

/**
 * รหัสกับชื่ออยู่คนละชีต:
 * - ถ้าชีตชื่อมีทั้งคอลัมน์รหัส+ชื่อ → สร้าง map จากชีตชื่ออย่างเดียว
 * - ถ้าชีตชื่อมีแค่ชื่อ (ไม่มีหัวรหัส) → จับคู่แถวต่อแถวกับชีตรหัส (แถว 2 กับแถว 2)
 */
function dcBuildLookup_(ss) {
  var codeSheet = dcGetSheetByName_(ss, DC_LOOKUP_CODE_SHEET);
  var nameSheetName = String(DC_LOOKUP_NAME_SHEET || '').trim();
  var sameSheet = !nameSheetName || nameSheetName === String(DC_LOOKUP_CODE_SHEET || '').trim();

  if (sameSheet) {
    var data = codeSheet.getDataRange().getValues();
    if (data.length < 2) return {};
    var h = dcDetectHeaderIndices_(data);
    return dcMapFromOneSheet_(data, h.idxCode, h.idxName, h.dataStart);
  }

  var nameSheet = dcGetSheetByName_(ss, DC_LOOKUP_NAME_SHEET);
  var dataCode = codeSheet.getDataRange().getValues();
  var dataName = nameSheet.getDataRange().getValues();
  if (dataCode.length < 2 || dataName.length < 2) return {};

  var hCode = dcDetectHeaderIndices_(dataCode);
  var hName = dcDetectHeaderIndices_(dataName);

  // ชีตชื่อมีทั้งรหัสและชื่อ → ใช้ชีตชื่อเป็นแหล่งหลัก
  if (hName.idxCode >= 0 && hName.idxName >= 0) {
    return dcMapFromOneSheet_(dataName, hName.idxCode, hName.idxName, hName.dataStart);
  }

  // ชีตชื่อมีแค่ชื่อ — จับคู่แถวกับชีตรหัส
  if (hCode.idxCode < 0) return {};
  var idxNameOnly = hName.idxName >= 0 ? hName.idxName : 4;
  var result = {};
  var nCode = dataCode.length;
  var nName = dataName.length;
  var iCode = hCode.dataStart;
  var iName = hName.dataStart;
  while (iCode < nCode && iName < nName) {
    var code = String(dataCode[iCode][hCode.idxCode] || '').trim();
    var name = String(dataName[iName][idxNameOnly] || '').trim();
    if (code) result[code] = name;
    iCode++;
    iName++;
  }
  return result;
}

function getProductLookup() {
  try {
    var ss = SpreadsheetApp.openById(DC_LOOKUP_SPREADSHEET_ID);
    return dcBuildLookup_(ss);
  } catch (err) {
    return { _error: 'getProductLookup failed: ' + err.message };
  }
}

// ─── getProductDetails — รายละเอียดสินค้าครบทุกคอลัมน์ จาก Sheet "Product" ────
//
// Spreadsheet: https://docs.google.com/spreadsheets/d/16RN4t1bqkdv-zxpcsIHZ6GUoCtMZ9pnM0yPYC4OiDDQ
// Sheet name : Product
//
// คอลัมน์ใน Sheet (แถวที่ 1 = header):
//   B: รหัสชิ้นงาน  C: ชื่อชิ้นงาน  D: ประเภทของ PE  E: ขนาด  F: ความยาว
//   G: ค่ารับแรงดัน (PN)  H: ตรา  I: แถบสี  J: น้ำหนักมาตรฐาน  K: Min  L: Max
//
// Returns: { [productCode]: { name, peType, size, length, pn, brand,
//                             colorStripe, stdWeight, minWeight, maxWeight } }

var PRODUCT_DETAIL_SPREADSHEET_ID = '16RN4t1bqkdv-zxpcsIHZ6GUoCtMZ9pnM0yPYC4OiDDQ';
var PRODUCT_DETAIL_SHEET_NAME     = 'Product';

function getProductDetails() {
  try {
    var ss    = SpreadsheetApp.openById(PRODUCT_DETAIL_SPREADSHEET_ID);
    var sheet = ss.getSheetByName(PRODUCT_DETAIL_SHEET_NAME);
    if (!sheet) return { _error: 'Sheet "' + PRODUCT_DETAIL_SHEET_NAME + '" not found' };

    var data = sheet.getDataRange().getValues();
    if (data.length < 2) return {};

    // ค้นหา index ของแต่ละคอลัมน์จาก header row (แถวแรก) — case-insensitive
    var headers = data[0].map(function(h) { return String(h || '').trim().toLowerCase(); });
    function findIdx(keywords) {
      for (var k = 0; k < keywords.length; k++) {
        var kw = keywords[k].toLowerCase();
        for (var c = 0; c < headers.length; c++) {
          if (headers[c] === kw || headers[c].indexOf(kw) === 0) return c;
        }
      }
      return -1;
    }

    var IDX = {
      code:        findIdx(['รหัสชิ้นงาน', 'productcode', 'รหัส']),
      name:        findIdx(['ชื่อชิ้นงาน', 'productname', 'ชื่อสินค้า']),
      peType:      findIdx(['ประเภทของ pe', 'ประเภท']),
      size:        findIdx(['ขนาด', 'size']),
      length:      findIdx(['ความยาว', 'length']),
      pn:          findIdx(['ค่ารับแรงดัน', 'pn']),
      brand:       findIdx(['ตรา', 'brand']),
      colorStripe: findIdx(['แถบสี', 'colorstripe']),
      // weight columns: ไม่ใช้ header detection เพราะ header อาจเลื่อนกับข้อมูลจริง
      // ข้อมูลจริงใน Sheet: col I(8)=stdWeight, J(9)=Min, K(10)=Max
      stdWeight:   8,
      minWeight:   9,
      maxWeight:   10,
    };

    // fallback ตามตำแหน่ง column จริงใน Sheet Product
    // (col A=index 0 = ลำดับ, B=1=รหัส, ..., H=7=ตรา, I=8=stdWeight, J=9=Min, K=10=Max)
    if (IDX.code        < 0) IDX.code        = 1;
    if (IDX.name        < 0) IDX.name        = 2;
    if (IDX.peType      < 0) IDX.peType      = 3;
    if (IDX.size        < 0) IDX.size        = 4;
    if (IDX.length      < 0) IDX.length      = 5;
    if (IDX.pn          < 0) IDX.pn          = 6;
    if (IDX.brand       < 0) IDX.brand       = 7;
    if (IDX.colorStripe < 0) IDX.colorStripe = 8;

    var result = {};
    for (var i = 1; i < data.length; i++) {
      var row  = data[i];
      var code = String(row[IDX.code] || '').trim();
      if (!code) continue;

      var toNum = function(v) {
        var n = Number(v);
        return isNaN(n) ? null : n;
      };

      result[code] = {
        name:        String(row[IDX.name]        || '').trim(),
        peType:      String(row[IDX.peType]      || '').trim(),
        size:        toNum(row[IDX.size]),
        length:      toNum(row[IDX.length]),
        pn:          toNum(row[IDX.pn]),
        brand:       String(row[IDX.brand]       || '').trim(),
        colorStripe: String(row[IDX.colorStripe] || '').trim(),
        stdWeight:   toNum(row[IDX.stdWeight]),
        minWeight:   toNum(row[IDX.minWeight]),
        maxWeight:   toNum(row[IDX.maxWeight]),
      };
    }
    return result;
  } catch (err) {
    return { _error: 'getProductDetails failed: ' + err.message };
  }
}
