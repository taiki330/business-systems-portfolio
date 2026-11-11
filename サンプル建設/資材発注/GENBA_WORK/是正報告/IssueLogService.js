/**
 * 指摘ログサービス - チェック1件=1行の集計用ログ
 */
const IssueLogService = (() => {
  const SHEET_NAME = APP_CONFIG.sheetNames.issueLogs;
  const HEADERS = APP_CONFIG.issueLogHeaders;

  const toRowValues = logObj =>
    HEADERS.map(header => (logObj[header] !== undefined ? logObj[header] : ''));

  /**
   * シート1行目をヘッダー定義に合わせて末尾拡張する
   */
  const ensureLogHeaders = () => {
    const sheet = SheetRepository.ensureSheet(SHEET_NAME, HEADERS);
    const lastCol = sheet.getLastColumn();
    if (lastCol >= HEADERS.length) return;
    const missing = HEADERS.slice(lastCol);
    if (missing.length) {
      sheet.getRange(1, lastCol + 1, 1, missing.length).setValues([missing]);
    }
  };

  /**
   * @param {string} caseId
   * @param {number} order
   * @return {string}
   */
  const generateLogId = (caseId, order) =>
    `${caseId}-LOG-${String(order).padStart(3, '0')}`;

  /**
   * 指摘ログを複数行追加する
   * @param {string} caseId
   * @param {Object[]} entries
   * @param {Object} caseMeta
   * @returns {{ success: boolean, error?: string }}
   */
  const addLogs = (caseId, entries, caseMeta) => {
    const lock = LockService.getScriptLock();
    try {
      lock.waitLock(10000);
      ensureLogHeaders();

      const now = Utilities_.nowIso();
      const reportedAt = now;
      const meta = caseMeta || {};

      (entries || []).forEach((entry, index) => {
        const order = index + 1;
        const logObj = {
          ログID: generateLogId(caseId, order),
          案件ID: caseId,
          明細ID: entry.detailId || '',
          報告日時: reportedAt,
          現場名: meta.siteName || '',
          会社名: meta.companyName || '',
          施工班: meta.constructionTeam || '',
          巡回者: meta.inspector || '',
          区分: entry.kind || '',
          指摘項目ID: entry.issueItemId || '',
          指摘項目: entry.issueLabel || '',
          自由記述: entry.freeText || '',
          報告区分: meta.reportCategory || '',
          作成日時: now
        };
        SheetRepository.appendRow(SHEET_NAME, toRowValues(logObj), HEADERS);
      });

      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    } finally {
      lock.releaseLock();
    }
  };

  /**
   * 案件IDに紐づく指摘ログ一覧を取得する
   * @param {string} caseId
   * @returns {Object[]}
   */
  const getLogsByCaseId = (caseId) => {
    const want = String(caseId == null ? '' : caseId).trim();
    return SheetRepository.findRows(
      SHEET_NAME,
      row => String(row['案件ID'] == null ? '' : row['案件ID']).trim() === want
    );
  };

  /**
   * 明細IDに紐づく指摘ログを1件取得する
   * @param {string} detailId
   * @returns {Object|null}
   */
  const getLogByDetailId = (detailId) => {
    const want = String(detailId == null ? '' : detailId).trim();
    const rows = SheetRepository.findRows(
      SHEET_NAME,
      row => String(row['明細ID'] == null ? '' : row['明細ID']).trim() === want
    );
    return rows.length ? rows[0] : null;
  };

  /**
   * 指摘ログ1行を更新する
   * @param {string} logId
   * @param {Object} fields
   * @returns {{ success: boolean, error?: string }}
   */
  const updateLogRow = (logId, fields) => {
    const updated = SheetRepository.updateRow(SHEET_NAME, 'ログID', logId, fields);
    if (!updated) {
      return { success: false, error: 'ログID "' + String(logId) + '" が見つかりません。' };
    }
    return { success: true };
  };

  /**
   * 指摘ログ1行を追加する
   * @param {Object} logObj
   * @returns {{ success: boolean, error?: string }}
   */
  const insertLogRow = (logObj) => {
    ensureLogHeaders();
    SheetRepository.appendRow(SHEET_NAME, toRowValues(logObj), HEADERS);
    return { success: true };
  };

  /**
   * 明細IDに紐づく指摘ログを削除する
   * @param {string} detailId
   * @returns {{ success: boolean, error?: string }}
   */
  const deleteLogByDetailId = (detailId) => {
    const log = getLogByDetailId(detailId);
    if (!log) {
      return { success: true };
    }
    const deleted = SheetRepository.deleteRowById(SHEET_NAME, 'ログID', log['ログID']);
    if (!deleted) {
      return { success: false, error: '指摘ログの削除に失敗しました。' };
    }
    return { success: true };
  };

  return {
    addLogs,
    ensureLogHeaders,
    getLogsByCaseId,
    getLogByDetailId,
    updateLogRow,
    insertLogRow,
    deleteLogByDetailId,
    generateLogId
  };
})();
