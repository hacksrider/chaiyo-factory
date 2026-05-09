// ─── Machine Log GAS Script ───────────────────────────────────────────────────
// Spreadsheet: https://docs.google.com/spreadsheets/d/12gFaN4Lwv8TIVnd9xeaJv9MNNWsvkrQDQ3fYP-ofP_Y/edit?usp=sharing

// Sheet columns (row 1 = header):
//  A: ID          B: เครื่อง     C: วันที่       D: สถานะ      E: เวลา
//  F: สาเหตุหยุด  G: Team        H: ผู้ลงข้อมูล  I: รหัสชิ้นงาน
//  J: รายละเอียด  K: การแก้ไข
// ─────────────────────────────────────────────────────────────────────────────

var SHEET_NAME = 'data'; // ชื่อ Sheet ใน Spreadsheet นี้

function doGet(e) {
  try {
    var action = e.parameter.action || '';
    if (action === 'getLog') {
      return getLog(e);
    }
    return response({ error: 'Unknown action: ' + action });
  } catch (err) {
    return response({ error: err.toString() });
  }
}

function doPost(e) {
  try {
    var params = JSON.parse(e.postData.contents);
    var action = params.action || '';

    if (action === 'appendLog') {
      return appendLog(params);
    }
    return response({ success: false, error: 'Unknown action: ' + action });
  } catch (err) {
    return response({ success: false, error: err.toString() });
  }
}

// ─── getLog ───────────────────────────────────────────────────────────────────
function getLog(e) {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) return response({ error: 'Sheet not found: ' + SHEET_NAME });

  var data    = sheet.getDataRange().getValues();
  var headers = data[0];
  var rows    = [];
  for (var i = 1; i < data.length; i++) {
    if (!data[i][0]) continue; // skip empty rows
    var obj = {};
    for (var j = 0; j < headers.length; j++) {
      obj[headers[j]] = data[i][j];
    }
    rows.push(obj);
  }
  return response({ logs: rows });
}

// ─── appendLog ────────────────────────────────────────────────────────────────
// params: { machine, date, status, time, cause, team, reporter, productCode, detail, fix }
function appendLog(params) {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) return response({ success: false, error: 'Sheet not found: ' + SHEET_NAME });

  // Generate next ID: MT00001, MT00002, ...
  var lastRow  = sheet.getLastRow();
  var nextId   = 'MT' + String(lastRow).padStart(5, '0');

  // If there are data rows, look at last ID to get next
  if (lastRow >= 2) {
    var lastId   = sheet.getRange(lastRow, 1).getValue();
    var lastNum  = parseInt(String(lastId).replace(/\D/g, ''), 10) || (lastRow - 1);
    nextId = 'MT' + String(lastNum + 1).padStart(5, '0');
  }

  sheet.appendRow([
    nextId,                         // A: ID
    String(params.machine  || ''), // B: เครื่อง
    String(params.date     || ''), // C: วันที่ (MM/DD/YYYY)
    String(params.status   || ''), // D: สถานะ
    String(params.time     || ''), // E: เวลา (H:MM:SS AM/PM)
    String(params.cause    || ''), // F: สาเหตุหยุด
    String(params.team     || ''), // G: Team
    String(params.reporter || ''), // H: ผู้ลงข้อมูล
    String(params.productCode || ''), // I: รหัสชิ้นงาน
    String(params.detail   || ''), // J: รายละเอียด
    String(params.fix      || ''), // K: การแก้ไข
  ]);

  return response({ success: true, id: nextId });
}

// ─── Helper ───────────────────────────────────────────────────────────────────
function response(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
