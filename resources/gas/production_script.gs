// ─── Helper ───────────────────────────────────────────────────────────────────
function response(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─── Column layout (0-based) ──────────────────────────────────────────────────
// ทุกแถวในชีตเครื่องจักรใช้โครงสร้างนี้ร่วมกัน — ต่างกันที่ค่า RowType (col H)
//
//  A        B           C              D              E           F     G             H
//  วันที่    เลขใบขอ    รหัสสินค้า    ชื่อสินค้า    เป้า/กะ    กะ    รหัสพนักงาน    RowType
//
//  RowType = "Started"   → แถวหัวออเดอร์
//  RowType = "ของดี"     → แถวรายการกดตาชั่ง (ของดี)
//  RowType = "ของเสีย"   → แถวรายการกดตาชั่ง (ของเสีย)
//  RowType = "Completed" → แถวสรุปจบออเดอร์
//  RowType = ""          → แถวคั่นว่างระหว่างออเดอร์

// ─── GET: getSettings / getHistory ───────────────────────────────────────────
function doGet(e) {
  try {
    var action = e.parameter.action;
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    // ── getSettings ──────────────────────────────────────────────────────────
    if (action === 'getSettings') {
      var settingsSheet = ss.getSheetByName('Settings');
      if (!settingsSheet) return response({ error: 'Settings sheet not found' });
      var data = settingsSheet.getDataRange().getValues();
      var headers = data[0];
      var machines = [];
      for (var i = 1; i < data.length; i++) {
        if (!data[i][0]) continue;
        var obj = {};
        for (var j = 0; j < headers.length; j++) obj[headers[j]] = data[i][j];
        machines.push(obj);
      }
      return response({ machines: machines });
    }

    // ── getHistory ───────────────────────────────────────────────────────────
    if (action === 'getHistory') {
      var requestSheet = e.parameter.sheetName;
      var history = [];
      if (requestSheet) {
        var s = ss.getSheetByName(requestSheet);
        if (s) history = getOrderSummaries_(s, requestSheet);
      } else {
        var settingsS = ss.getSheetByName('Settings');
        if (settingsS) {
          var sData = settingsS.getDataRange().getValues();
          var sHeaders = sData[0];
          var snIdx = sHeaders.indexOf('SheetName');
          var idIdx = sHeaders.indexOf('MachineID');
          for (var r = 1; r < sData.length; r++) {
            if (!sData[r][0]) continue;
            var sName = snIdx >= 0 ? sData[r][snIdx] : sData[r][idIdx];
            var ms = ss.getSheetByName(sName);
            if (ms) history = history.concat(getOrderSummaries_(ms, sName));
          }
        }
      }
      return response({ history: history });
    }

    // ── getOrderDetail ────────────────────────────────────────────────────────
    //  Params: sheetName, orderId
    //  Returns: { detail: { orderId, machine, startedAt, finishedAt, firstGood, events } }
    if (action === 'getOrderDetail') {
      var sheetName = e.parameter.sheetName;
      var orderId   = e.parameter.orderId;
      if (!sheetName || !orderId) {
        return response({ error: 'Missing sheetName or orderId' });
      }
      var ds = ss.getSheetByName(sheetName);
      if (!ds) {
        return response({ error: 'Sheet not found: ' + sheetName });
      }
      var startedAt = e.parameter.startedAt;
      var detail = getOrderDetail_(ds, sheetName, orderId, startedAt);
      return response({ detail: detail });
    }

    return response({ error: 'Unknown action: ' + action });
  } catch (err) {
    return response({ error: err.toString() });
  }
}

// ─── Helper: ดึงเฉพาะแถว "Started" + "Completed" เป็นคู่สรุปออเดอร์ ─────────
function getOrderSummaries_(sheet, machineName) {
  var data = sheet.getDataRange().getValues();
  var rows = [];
  // Track "open" runs per orderId so repeated orderId can be separated by run
  // openRuns[orderId] = [ rowIndexInRows, rowIndexInRows, ... ] (stack)
  var openRuns = {};
  for (var i = 0; i < data.length; i++) {
    var rowType = String(data[i][7] || '').trim();
    if (rowType === 'Started') {
      var orderId = String(data[i][1] || '');
      var startedRow = {
        machine:     machineName,
        timestamp:   data[i][0] ? new Date(data[i][0]).toISOString() : '',
        orderId:     orderId,
        productCode: data[i][2],
        productName: data[i][3],
        targetQty:   data[i][4],
        shift:       data[i][5],
        employeeId:  data[i][6],
        status:      'In-progress'
      };
      rows.push(startedRow);

      if (!openRuns[orderId]) openRuns[orderId] = [];
      openRuns[orderId].push(rows.length - 1);
    }
    if (rowType === 'Completed') {
      var compOrderId = String(data[i][1] || '');
      var stack = openRuns[compOrderId] || [];
      // Close the most recent "Started" that is still open
      if (stack.length > 0) {
        var idx = stack.pop();
        rows[idx].status     = 'Completed';
        rows[idx].summary    = data[i][3]; // "ของดี X รายการ / XX.XX kg"
        rows[idx].ngSummary  = data[i][4]; // "ของเสียรวม XX.XX kg"
        rows[idx].finishedAt = data[i][0] ? new Date(data[i][0]).toISOString() : '';
        // Cleanup empty stacks
        if (stack.length === 0) delete openRuns[compOrderId];
        else openRuns[compOrderId] = stack;
      }
    }
  }
  return rows;
}

// ─── Helper: อ่าน events ของ order เดียว (ระหว่าง Started → Completed) ────────
function getOrderDetail_(sheet, machineName, orderId) {
  var data = sheet.getDataRange().getValues();

  var startIdx = -1;
  var startedAt = '';
  var productCode = '';
  var productName = '';
  // Optional startedAt hint (ISO string from client) to disambiguate repeated orderId runs
  var startedAtHint = '';
  try { startedAtHint = (typeof arguments !== 'undefined' && arguments.length >= 4) ? String(arguments[3] || '') : ''; } catch(e) {}
  var hintMs = 0;
  if (startedAtHint) {
    try { hintMs = new Date(startedAtHint).getTime(); } catch(e2) { hintMs = 0; }
  }

  for (var i = 0; i < data.length; i++) {
    var rowType = String(data[i][7] || '').trim();
    if (rowType === 'Started' && String(data[i][1] || '') === String(orderId)) {
      var rowIso = data[i][0] ? new Date(data[i][0]).toISOString() : '';
      var rowMs = data[i][0] ? new Date(data[i][0]).getTime() : 0;
      // If a hint exists, pick the Started row that matches it (±2 minutes to tolerate formatting)
      if (hintMs && rowMs && Math.abs(rowMs - hintMs) > 120000) {
        continue;
      }
      startIdx = i;
      startedAt = rowIso;
      productCode = data[i][2] ? String(data[i][2]) : '';
      productName = data[i][3] ? String(data[i][3]) : '';
      break;
    }
  }

  if (startIdx < 0) {
    return {
      orderId: String(orderId),
      machine: machineName,
      startedAt: '',
      finishedAt: '',
      firstGood: null,
      events: [],
      error: 'Order not found'
    };
  }

  var events = [];
  var finishedAt = '';
  var firstGood = null;

  for (var r = startIdx + 1; r < data.length; r++) {
    var rt = String(data[r][7] || '').trim();

    // Stop when we reach the Completed summary for this order
    if (rt === 'Completed' && String(data[r][1] || '') === String(orderId)) {
      finishedAt = data[r][0] ? new Date(data[r][0]).toISOString() : '';
      break;
    }

    // Weight event rows: H == "ของดี" or "ของเสีย"
    if (rt === 'ของดี' || rt === 'ของเสีย') {
      var pressedAt = data[r][0] ? new Date(data[r][0]).toISOString() : '';
      var seq = Number(data[r][1] || 0);
      var weight = Number(data[r][2] || 0);
      var type = (rt === 'ของดี') ? 'good' : 'ng';

      var ev = {
        type: type,
        pressedAt: pressedAt,
        seq: seq,
        weight: weight
      };
      events.push(ev);

      if (!firstGood && type === 'good') {
        firstGood = ev;
      }
    }
  }

  return {
    orderId: String(orderId),
    machine: machineName,
    startedAt: startedAt,
    finishedAt: finishedAt,
    productCode: productCode,
    productName: productName,
    firstGood: firstGood,
    events: events
  };
}

// ─── POST: createOrder / logWeightEvent / closeOrder / appendMachineLog ──────
function doPost(e) {
  try {
    var params = JSON.parse(e.postData.contents);
    var action    = params.action;

    // ── appendMachineLog — writes to Machine Log spreadsheet (different file) ──
    // ไม่ต้องการ sheetName เพราะเปิด Spreadsheet แยกต่างหากด้วย openById
    if (action === 'appendMachineLog') {
      return appendMachineLog_(params);
    }

    var sheetName = params.sheetName;
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(sheetName);

    if (!sheet) {
      return response({ success: false, error: 'Sheet not found: ' + sheetName });
    }

    // ── createOrder ──────────────────────────────────────────────────────────
    //  เขียน 1 แถวหัว: วันที่ | เลขใบขอ | รหัสสินค้า | ชื่อสินค้า | เป้า/กะ | กะ | รหัสพนักงาน | Started
    if (action === 'createOrder') {
      if (sheet.getLastRow() > 0) {
        sheet.appendRow(['', '', '', '', '', '', '', '']); // คั่นว่างระหว่างออเดอร์
      }
      sheet.appendRow([
        new Date(),
        String(params.orderId     || ''),
        String(params.productCode || ''),
        String(params.productName || ''),
        Number(params.targetQty   || 0),
        String(params.shift       || ''),
        String(params.employeeId  || ''),
        'Started'
      ]);
      return response({ success: true, result: 'Order Started' });
    }

    // ── logWeightEvent ───────────────────────────────────────────────────────
    //  A: เวลากดปุ่ม (Date) | B: ลำดับ (Number) | C: น้ำหนัก | D: ของดี/ของเสีย | E-G: '' | H: RowType
    if (action === 'logWeightEvent') {
      var typeLabel = params.type === 'good' ? 'ของดี' : 'ของเสีย';
      var pressedAt;
      try { pressedAt = new Date(params.pressedAt); } catch(x) { pressedAt = new Date(); }
      // ตรวจสอบว่าแปลงวันที่สำเร็จ (ไม่ใช่ Invalid Date)
      if (isNaN(pressedAt.getTime())) { pressedAt = new Date(); }
      // ลำดับใน Sheet: sheetOrdinal / lineOrdinal / seq (ของดี=1..n, ของเสียแยก 1..m จาก Laravel)
      var ord = Number(params.sheetOrdinal != null ? params.sheetOrdinal :
        (params.lineOrdinal != null ? params.lineOrdinal : (params.seq || 0)));
      if (isNaN(ord)) ord = Number(params.seq || 0);
      sheet.appendRow([
        pressedAt,                    // A: วันที่ (เวลากดปุ่ม) ← ใส่ Date object ตรงๆ
        ord,                           // B: ลำดับ (ภายใน type เดียวกัน เช่นของดี 1,2,3 | ของเสีย 1,2 …)
        Number(params.weight || 0),   // C: น้ำหนัก
        typeLabel,                    // D: ของดี / ของเสีย
        '', '', '',
        typeLabel                     // H: RowType
      ]);
      return response({ success: true, result: 'Weight Logged' });
    }

    // ── closeOrder ───────────────────────────────────────────────────────────
    //  A: วันที่ | B: เลขใบขอ | C: "[ สรุป ]"
    //  D: ของดี X รายการ / XX.XX kg  | E: ของเสียรวม XX.XX kg | F: '' | G: '' | H: Completed
    if (action === 'closeOrder') {
      var goodCount        = Number(params.goodCount       || 0);
      var totalGoodWeight  = Number(params.totalGoodWeight || 0);
      var totalNgWeight    = Number(params.totalNgWeight   || 0);

      sheet.appendRow([
        new Date(),
        String(params.orderId || ''),
        '[ สรุป ]',
        'ของดี ' + goodCount + ' รายการ / ' + totalGoodWeight.toFixed(2) + ' kg',
        'ของเสียรวม ' + totalNgWeight.toFixed(2) + ' kg',
        '', '',
        'Completed'
      ]);
      return response({ success: true, result: 'Production Closed' });
    }

    return response({ success: false, error: 'Unknown action: ' + action });

  } catch (err) {
    return response({ success: false, error: err.toString() });
  }
}

// ─── appendMachineLog_ ───────────────────────────────────────────────────────
// เขียนข้อมูลสถานะเครื่องจักรลง Machine Log Spreadsheet
// Columns: ID | เครื่อง | วันที่ | สถานะ | เวลา | สาเหตุหยุด | Team | ผู้ลงข้อมูล | รหัสชิ้นงาน | รายละเอียด | การแก้ไข
function appendMachineLog_(params) {
  try {
    var MACHINE_LOG_ID = '1ZQ1okH84l1uwY6SnvwxZ3zzlfV4Ed_Gzq9UvilYtcXM';
    var logSS    = SpreadsheetApp.openById(MACHINE_LOG_ID);
    var logSheet = logSS.getSheets()[0]; // แผ่นแรก (Sheet1 หรือ ชื่อใดก็ตาม)

    // Auto-generate next ID based on last row
    var lastRow = logSheet.getLastRow();
    var nextNum = 1;
    if (lastRow >= 2) {
      var lastId = String(logSheet.getRange(lastRow, 1).getValue() || '');
      var parsed = parseInt(lastId.replace(/\D/g, ''), 10);
      nextNum = isNaN(parsed) ? (lastRow) : (parsed + 1);
    }
    var nextId = 'MT' + String(nextNum).padStart(5, '0');

    logSheet.appendRow([
      nextId,                           // A: ID (MT00001, MT00002, ...)
      String(params.machine     || ''), // B: เครื่อง
      String(params.date        || ''), // C: วันที่  (MM/DD/YYYY)
      String(params.status      || ''), // D: สถานะ
      String(params.time        || ''), // E: เวลา   (H:MM:SS AM/PM)
      String(params.cause       || ''), // F: สาเหตุหยุด
      String(params.team        || ''), // G: Team
      String(params.reporter    || ''), // H: ผู้ลงข้อมูล
      String(params.productCode || ''), // I: รหัสชิ้นงาน
      String(params.detail      || ''), // J: รายละเอียด
      String(params.fix         || ''), // K: การแก้ไข
    ]);

    return response({ success: true, id: nextId });
  } catch (err) {
    return response({ success: false, error: 'appendMachineLog_ error: ' + err.toString() });
  }
}
