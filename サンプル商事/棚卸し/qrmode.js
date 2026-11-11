/** 医院ごとの標準カメラQR運用モード。 */
var CLINIC_QR_MODE_SHEET = '医院QRモード設定';
var CLINIC_QR_MODE_HEADERS = ['医院ID', 'QRモード', '更新日時'];
var CLINIC_QR_MODE_NORMAL = '通常使用';
var CLINIC_QR_MODE_STOCK = '棚卸し入力';

/** 設定がまだ無い場合は、現行運用を維持してPVだけ棚卸し入力、他院は通常使用。 */
function defaultClinicQrMode_(clinic) {
  return clinic === 'PV' ? CLINIC_QR_MODE_STOCK : CLINIC_QR_MODE_NORMAL;
}

/** @return {{clinic:string, mode:string}} */
function getClinicQrMode(clinic) {
  if (CLINICS.indexOf(clinic) < 0) throw new Error('不明な医院: ' + clinic);
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CLINIC_QR_MODE_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return { clinic: clinic, mode: defaultClinicQrMode_(clinic) };
  assertSheetHeaders_(sheet, CLINIC_QR_MODE_HEADERS);
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, CLINIC_QR_MODE_HEADERS.length).getValues();
  for (var i = 0; i < values.length; i++) {
    if (toStr(values[i][0]) !== clinic) continue;
    var mode = toStr(values[i][1]);
    if (mode === CLINIC_QR_MODE_NORMAL || mode === CLINIC_QR_MODE_STOCK) {
      return { clinic: clinic, mode: mode };
    }
  }
  return { clinic: clinic, mode: defaultClinicQrMode_(clinic) };
}

/** 医院1つだけのQRモードを変更する。 */
function setClinicQrMode(clinic, mode) {
  if (CLINICS.indexOf(clinic) < 0) throw new Error('不明な医院: ' + clinic);
  if (mode !== CLINIC_QR_MODE_NORMAL && mode !== CLINIC_QR_MODE_STOCK) {
    throw new Error('不正なQRモードです: ' + mode);
  }
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = getOrCreateSheet(CLINIC_QR_MODE_SHEET, CLINIC_QR_MODE_HEADERS);
    assertSheetHeaders_(sheet, CLINIC_QR_MODE_HEADERS);
    var lastRow = sheet.getLastRow();
    var rowNo = 0;
    if (lastRow >= 2) {
      var clinics = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
      for (var i = 0; i < clinics.length; i++) {
        if (toStr(clinics[i][0]) === clinic) { rowNo = i + 2; break; }
      }
    }
    var row = [clinic, mode, new Date()];
    if (rowNo) sheet.getRange(rowNo, 1, 1, row.length).setValues([row]);
    else sheet.appendRow(row);
    SpreadsheetApp.flush();
    return { clinic: clinic, mode: mode };
  } finally {
    lock.releaseLock();
  }
}
