/**
 * 「午後報告」ログから、スプレッドシートのタイムゾーンで当日分だけを
 * 「本日の午後報告」シートへ再生成する。
 */
const DailyAfternoonReportService = (() => {
  const REPORT_TYPE = '午後報告';
  const OUTPUT_SHEET_NAME = '本日の午後報告';
  const TIMESTAMP_HEADERS = ['送信日時', 'Timestamp'];

  const findTimestampColumn = headers => {
    for (let i = 0; i < TIMESTAMP_HEADERS.length; i += 1) {
      const index = headers.findIndex(header => String(header || '').trim() === TIMESTAMP_HEADERS[i]);
      if (index >= 0) return index;
    }
    return -1;
  };

  const isValidDate = value => value instanceof Date && !isNaN(value.getTime());

  const getOrCreateOutputSheet = spreadsheet =>
    spreadsheet.getSheetByName(OUTPUT_SHEET_NAME) || spreadsheet.insertSheet(OUTPUT_SHEET_NAME);

  const clearOutputSheet = sheet => {
    const filter = sheet.getFilter();
    if (filter) filter.remove();
    sheet.clear();
  };

  const matchColumnCount = (sheet, columnCount) => {
    const current = sheet.getMaxColumns();
    if (current < columnCount) {
      sheet.insertColumnsAfter(current, columnCount - current);
    } else if (current > columnCount) {
      sheet.deleteColumns(columnCount + 1, current - columnCount);
    }
  };

  const copyColumnWidths = (sourceSheet, outputSheet, columnCount) => {
    for (let column = 1; column <= columnCount; column += 1) {
      outputSheet.setColumnWidth(column, sourceSheet.getColumnWidth(column));
    }
  };

  const refreshForSourceSheet = sourceSheet => {
    if (!sourceSheet) throw new Error('午後報告ログシートが取得できません。');

    const spreadsheet = sourceSheet.getParent();
    const timeZone = spreadsheet.getSpreadsheetTimeZone();
    if (sourceSheet.getName() === OUTPUT_SHEET_NAME) {
      throw new Error('午後報告ログと出力先シート名が同じため更新を中止しました。');
    }
    const outputSheet = getOrCreateOutputSheet(spreadsheet);
    const columnCount = sourceSheet.getLastColumn();

    clearOutputSheet(outputSheet);
    if (columnCount < 1) {
      return { outputSheetName: OUTPUT_SHEET_NAME, count: 0, timeZone };
    }
    matchColumnCount(outputSheet, columnCount);

    const headers = sourceSheet.getRange(1, 1, 1, columnCount).getValues()[0];
    const timestampColumn = findTimestampColumn(headers);
    if (timestampColumn < 0) {
      throw new Error('午後報告ログに送信日時列（送信日時 / Timestamp）が見つかりません。');
    }

    // 見出しは値と書式を元ログからコピーし、列追加時もそのまま追従させる。
    sourceSheet.getRange(1, 1, 1, columnCount).copyTo(outputSheet.getRange(1, 1, 1, columnCount));
    copyColumnWidths(sourceSheet, outputSheet, columnCount);
    outputSheet.setFrozenRows(1);

    const lastRow = sourceSheet.getLastRow();
    const todayKey = Utilities.formatDate(new Date(), timeZone, 'yyyy-MM-dd');
    const todayRows = [];
    if (lastRow >= 2) {
      const values = sourceSheet.getRange(2, 1, lastRow - 1, columnCount).getValues();
      values.forEach(row => {
        const submittedAt = row[timestampColumn];
        // 送信日時は Date 型のみを対象とし、空欄・不正値・文字列は安全に除外する。
        if (!isValidDate(submittedAt)) return;
        if (Utilities.formatDate(submittedAt, timeZone, 'yyyy-MM-dd') !== todayKey) return;
        todayRows.push(row);
      });
    }

    todayRows.sort((a, b) => b[timestampColumn].getTime() - a[timestampColumn].getTime());
    if (todayRows.length > 0) {
      outputSheet.getRange(2, 1, todayRows.length, columnCount).setValues(todayRows);
    }

    outputSheet.getRange(1, 1, todayRows.length + 1, columnCount).createFilter();
    return { outputSheetName: OUTPUT_SHEET_NAME, count: todayRows.length, timeZone };
  };

  const refresh = () =>
    refreshForSourceSheet(ReportService.getLogSheetForReportType(REPORT_TYPE));

  return { refresh, refreshForSourceSheet };
})();

/** 手動実行用: 「本日の午後報告」を現在の当日分で再生成する。 */
function refreshTodaysAfternoonReports() {
  return DailyAfternoonReportService.refresh();
}
