/**
 * スプレッドシートの読み書きを補助するサービス。
 */
var SheetService = (function() {
  var _ss = null;
  
  function getSs() {
    if (!_ss) {
      _ss = SpreadsheetApp.getActiveSpreadsheet();
    }
    return _ss;
  }

  var headersCache = {};

  function getSheet(name) {
    var sheet = getSs().getSheetByName(name);
    if (!sheet) throw new Error('Sheet not found: ' + name);
    return sheet;
  }

  function getMasterSheet() {
    var config = getConfig();
    return getSheet(config.MASTER_SHEET_NAME);
  }

  function getDashboardSheet() {
    var config = getConfig();
    return getSheet(config.DASHBOARD_DATA_SHEET_NAME);
  }

  /**
   * ダッシュボードに現場行（親）または工区行（子）を追加/既存検索する。
   * @param {string} siteName - 現場名
   * @param {string} zoneName - 工区名（省略時は親行として扱う）
   * @return {Object} { row: number, siteName: string, zoneName: string }
   */
  function ensureTimelineRow(siteName, zoneName) {
    var config = getConfig();
    var sheet = getDashboardSheet();
    bootstrapDashboardHeaders(sheet);
    var lastRow = sheet.getLastRow();
    if (lastRow < 1) {
      sheet.appendRow(config.DASHBOARD_HEADERS);
      lastRow = 1;
    }
    
    var cleanSiteName = SiteNameUtils.normalizeSiteName(siteName);
    var targetZone = (zoneName || '').toString().trim();
    
    // ヘッダーから列インデックスを取得
    var headers = getHeaders(config.DASHBOARD_DATA_SHEET_NAME);
    var siteColIndex = headers.indexOf('現場名');
    var zoneColIndex = headers.indexOf('工区名');
    
    if (siteColIndex === -1) throw new Error('Header "現場名" not found');
    // 工区名は必須ではないかもしれないが、このシステムでは前提
    if (zoneColIndex === -1) throw new Error('Header "工区名" not found');

    // 1. 既存の行を検索
    var range = sheet.getRange(1, 1, lastRow, headers.length);
    var values = range.getValues();
    
    for (var i = 1; i < values.length; i++) {
      var rowSite = SiteNameUtils.normalizeSiteName(values[i][siteColIndex] || '');
      var rowZone = (values[i][zoneColIndex] || '').toString().trim();
      if (rowSite === cleanSiteName && rowZone === targetZone) {
        return { row: i + 1, siteName: cleanSiteName, zoneName: targetZone };
      }
    }
    
    // 2. 新規行を追加
    if (targetZone === '') {
      // 親行（現場）の場合は末尾に追加
      var newRow = new Array(headers.length).fill('');
      newRow[siteColIndex] = cleanSiteName;
      newRow[zoneColIndex] = ''; // 明示的に空
      
      sheet.appendRow(newRow);
      return { row: sheet.getLastRow(), siteName: cleanSiteName, zoneName: '' };
    } else {
      // 子行（工区）の場合：親行を探してその直後に挿入
      var parentRow = -1;
      var lastChildRow = -1;
      
      for (var i = 1; i < values.length; i++) {
        var rowSite = SiteNameUtils.normalizeSiteName(values[i][siteColIndex] || '');
        var rowZone = (values[i][zoneColIndex] || '').toString().trim();
        
        if (rowSite === cleanSiteName) {
          if (rowZone === '') {
            parentRow = i + 1;
          }
          lastChildRow = i + 1;
        }
      }
      
      if (parentRow === -1) {
        // 親行がまだない場合は作成
        var parentInfo = ensureTimelineRow(cleanSiteName, '');
        parentRow = parentInfo.row;
        lastChildRow = parentRow;
      }
      
      // 親行または最後の子行の直後に挿入
      var insertAt = lastChildRow + 1;
      var newRow = new Array(headers.length).fill('');
      newRow[siteColIndex] = cleanSiteName;
      newRow[zoneColIndex] = targetZone;

      if (insertAt > sheet.getMaxRows()) {
        sheet.appendRow(newRow);
      } else {
        sheet.insertRowBefore(insertAt);
        sheet.getRange(insertAt, 1, 1, headers.length).setValues([newRow]);
      }
      
      // グループ化を適用
      try {
        sheet.getRange(insertAt, 1).shiftRowGroupDepth(1);
      } catch (e) {
        Logger.log('[SheetService] Failed to group row in data sheet: ' + e.toString());
      }
      
      return { row: insertAt, siteName: cleanSiteName, zoneName: targetZone };
    }
  }

  function findRowBySiteName(sheet, siteName, zoneName) {
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return -1;
    
    var config = getConfig();
    var headers = getHeaders(config.DASHBOARD_DATA_SHEET_NAME);
    var siteColIndex = headers.indexOf('現場名');
    var zoneColIndex = headers.indexOf('工区名');
    
    if (siteColIndex === -1 || zoneColIndex === -1) return -1;

    var cleanSiteName = SiteNameUtils.normalizeSiteName(siteName);
    var targetZone = (zoneName || '').toString().trim();
    
    var range = sheet.getRange(1, 1, lastRow, headers.length);
    var values = range.getValues();
    
    for (var i = 1; i < values.length; i++) {
      var rowSite = SiteNameUtils.normalizeSiteName(values[i][siteColIndex] || '');
      var rowZone = (values[i][zoneColIndex] || '').toString().trim();
      if (rowSite === cleanSiteName && rowZone === targetZone) {
        return i + 1;
      }
    }
    return -1;
  }

  function updateCell(sheetName, row, col, value) {
    var sheet = getSheet(sheetName);
    sheet.getRange(row, col).setValue(value);
  }

  function appendToSheet(sheetName, values) {
    var sheet = getSheet(sheetName);
    sheet.appendRow(values);
  }

  /**
   * 見出し名を指定して、該当列に値をセットする。
   * values: { '列名': 値 }
   */
  function updateRowByHeaders(sheetName, row, values) {
    var sheet = getSheet(sheetName);
    var headers = getHeaders(sheetName);
    Object.keys(values).forEach(function(key) {
      var colIndex = headers.indexOf(key);
      if (colIndex === -1) return;
      sheet.getRange(row, colIndex + 1).setValue(values[key]);
    });
  }

  function updateDashboard(siteName, values, zoneName) {
    var info = ensureTimelineRow(siteName, zoneName);
    
    // メタデータの自動付与
    values['最終更新日時'] = new Date();
    values['最終更新者'] = Session.getActiveUser().getEmail() || 'System';
    
    // 全報告日ログの更新
    updateReportLog(siteName, zoneName, values, info.row);
    
    var config = getConfig();
    updateRowByHeaders(config.DASHBOARD_DATA_SHEET_NAME, info.row, values);
    return info;
  }

  /**
   * 全報告日ログを更新する
   */
  function updateReportLog(siteName, zoneName, updates, row) {
    var config = getConfig();
    var logHeader = '全報告日ログ';
    var headers = getHeaders(config.DASHBOARD_DATA_SHEET_NAME);
    var colIndex = headers.indexOf(logHeader);
    if (colIndex === -1) return;

    // 現在のログを取得
    var sheet = getDashboardSheet();
    var currentLogStr = sheet.getRange(row, colIndex + 1).getValue();
    var log = {};
    try {
      if (currentLogStr) log = JSON.parse(currentLogStr);
    } catch (e) {
      Logger.log('[SheetService] Failed to parse log JSON: ' + e);
    }

    // 更新内容からフェーズを特定（最終報告日が含まれている場合）
    var phaseDateHeaders = {
      1: '現場調査最終報告日',
      2: '仮設計画打合わせ最終報告日',
      3: '送り出し教育最終報告日',
      4: '解体前教育最終報告日',
      5: '足場工区点検最終報告日',
      6: '現場巡回最終報告日',
      7: '安全衛生協議会最終報告日'
    };

    var dateStr = Utilities.formatDate(new Date(), 'JST', 'yyyy-MM-dd');
    var updated = false;

    Object.keys(phaseDateHeaders).forEach(function(phase) {
      var header = phaseDateHeaders[phase];
      if (updates[header]) {
        if (!log[phase]) log[phase] = [];
        // 重複チェック（同じ日の報告は1つにまとめる）
        if (log[phase].indexOf(dateStr) === -1) {
          log[phase].push(dateStr);
          updated = true;
        }
      }
    });

    if (updated) {
      updates[logHeader] = JSON.stringify(log);
    }
  }
  
  /**
   * 親行（現場全体）のサマリーを子行（工区）のデータから自動計算して更新する。
   * @param {string} siteName - 現場名
   */
  function updateParentSummary(siteName) {
    var config = getConfig();
    var sheet = getDashboardSheet();
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return;
    
    var headers = getHeaders(config.DASHBOARD_DATA_SHEET_NAME);
    var siteNameCol = headers.indexOf('現場名') + 1;
    var zoneNameCol = headers.indexOf('工区名') + 1;
    var updates = {};
    var assemblyStartCol = headers.indexOf('組立開始予定日') + 1;
    var assemblyEndCol = headers.indexOf('組立終了予定日') + 1;
    var dismantleStartCol = headers.indexOf('解体開始予定日') + 1;
    var dismantleEndCol = headers.indexOf('解体終了予定日') + 1;
    var actualAssemblyStartCol = headers.indexOf('組立開始実績日') + 1;
    var actualAssemblyEndCol = headers.indexOf('組立終了実績日') + 1;
    var actualDismantleStartCol = headers.indexOf('解体開始実績日') + 1;
    var actualDismantleEndCol = headers.indexOf('解体終了実績日') + 1;
    var reportLogCol = headers.indexOf('全報告日ログ') + 1;
    
    // 子行（工区）のデータを収集
    var range = sheet.getRange(2, 1, lastRow - 1, headers.length);
    var values = range.getValues();
    
    var earliestAssemblyStart = null;
    var latestAssemblyEnd = null;
    var earliestDismantleStart = null;
    var latestDismantleEnd = null;
    var parentRow = -1;
    
    for (var i = 0; i < values.length; i++) {
      var rowSiteName = values[i][siteNameCol - 1];
      var rowZoneName = values[i][zoneNameCol - 1];
      
      if (SiteNameUtils.normalizeSiteName(rowSiteName) === SiteNameUtils.normalizeSiteName(siteName)) {
        if (rowZoneName === '' || rowZoneName === null) {
          // 親行を見つけた
          parentRow = i + 2;
        } else {
          // 子行のデータを集計
          var assemblyStart = values[i][assemblyStartCol - 1];
          var assemblyEnd = values[i][assemblyEndCol - 1];
          var dismantleStart = values[i][dismantleStartCol - 1];
          var dismantleEnd = values[i][dismantleEndCol - 1];
          
          if (assemblyStart && (!earliestAssemblyStart || assemblyStart < earliestAssemblyStart)) {
            earliestAssemblyStart = assemblyStart;
          }
          if (assemblyEnd && (!latestAssemblyEnd || assemblyEnd > latestAssemblyEnd)) {
            latestAssemblyEnd = assemblyEnd;
          }
          if (dismantleStart && (!earliestDismantleStart || dismantleStart < earliestDismantleStart)) {
            earliestDismantleStart = dismantleStart;
          }
          if (dismantleEnd && (!latestDismantleEnd || dismantleEnd > latestDismantleEnd)) {
            latestDismantleEnd = dismantleEnd;
          }

          // 実績データの集計
          var actualAssemblyStart = values[i][actualAssemblyStartCol - 1];
          var actualAssemblyEnd = values[i][actualAssemblyEndCol - 1];
          var actualDismantleStart = values[i][actualDismantleStartCol - 1];
          var actualDismantleEnd = values[i][actualDismantleEndCol - 1];

          if (actualAssemblyStart && (!updates['組立開始実績日'] || actualAssemblyStart < updates['組立開始実績日'])) {
            updates['組立開始実績日'] = actualAssemblyStart;
          }
          if (actualAssemblyEnd && (!updates['組立終了実績日'] || actualAssemblyEnd > updates['組立終了実績日'])) {
            updates['組立終了実績日'] = actualAssemblyEnd;
          }
          if (actualDismantleStart && (!updates['解体開始実績日'] || actualDismantleStart < updates['解体開始実績日'])) {
            updates['解体開始実績日'] = actualDismantleStart;
          }
          if (actualDismantleEnd && (!updates['解体終了実績日'] || actualDismantleEnd > updates['解体終了実績日'])) {
            updates['解体終了実績日'] = actualDismantleEnd;
          }

          // ログの集計
          var childLogStr = values[i][reportLogCol - 1];
          if (childLogStr) {
            try {
              var childLog = JSON.parse(childLogStr);
              if (!updates['全報告日ログ']) updates['全報告日ログ'] = {};
              var parentLog = typeof updates['全報告日ログ'] === 'string' ? JSON.parse(updates['全報告日ログ']) : updates['全報告日ログ'];
              
              Object.keys(childLog).forEach(function(phase) {
                if (!parentLog[phase]) parentLog[phase] = [];
                childLog[phase].forEach(function(date) {
                  if (parentLog[phase].indexOf(date) === -1) {
                    parentLog[phase].push(date);
                  }
                });
              });
              updates['全報告日ログ'] = JSON.stringify(parentLog);
            } catch (e) {
              Logger.log('[SheetService] Failed to merge log JSON: ' + e);
            }
          }
        }
      }
    }
    
    // 親行が存在しない場合は作成
    if (parentRow === -1) {
      var info = ensureTimelineRow(siteName, '');
      parentRow = info.row;
    }
    
    // 予定データの集計結果をセット
    if (earliestAssemblyStart) updates['組立開始予定日'] = earliestAssemblyStart;
    if (latestAssemblyEnd) updates['組立終了予定日'] = latestAssemblyEnd;
    if (earliestDismantleStart) {
      updates['解体開始予定日'] = earliestDismantleStart;
      updates['解体前教育予定日'] = FormUtils.addDays(earliestDismantleStart, -7);
    }
    if (latestDismantleEnd) updates['解体終了予定日'] = latestDismantleEnd;
    
    if (Object.keys(updates).length > 0) {
      updateRowByHeaders(config.DASHBOARD_DATA_SHEET_NAME, parentRow, updates);
    }
  }

  function getHeaders(sheetName) {
    if (headersCache[sheetName]) {
      return headersCache[sheetName];
    }
    var sheet = getSheet(sheetName);
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn() || 1).getValues()[0];
    headersCache[sheetName] = headers;
    return headers;
  }

  function getDashboardValue(siteName, headerName, zoneName) {
    var config = getConfig();
    var sheet = getDashboardSheet();
    var row = findRowBySiteName(sheet, siteName, zoneName);
    if (row === -1) return '';
    var headers = getHeaders(config.DASHBOARD_DATA_SHEET_NAME);
    var colIndex = headers.indexOf(headerName);
    if (colIndex === -1) return '';
    return sheet.getRange(row, colIndex + 1).getValue();
  }

  function getDashboardData() {
    var config = getConfig();
    var sheet = getDashboardSheet();
    bootstrapDashboardHeaders(sheet);
    var lastRow = sheet.getLastRow();
    var headers = getHeaders(config.DASHBOARD_DATA_SHEET_NAME);
    if (lastRow < 2) {
      return { headers: headers, rows: [] };
    }
    var values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
    var rows = values.map(function(row) {
      var obj = {};
      headers.forEach(function(header, index) {
        var cleanHeader = (header || '').toString().trim();
        obj[cleanHeader] = row[index];
      });
      return obj;
    });
    return { headers: headers, rows: rows };
  }

  function bootstrapDashboard() {
    var sheet = getDashboardSheet();
    bootstrapDashboardHeaders(sheet);
    return sheet;
  }

  function bootstrapDashboardHeaders(sheet) {
    var config = getConfig();
    if (!config.DASHBOARD_HEADERS || config.DASHBOARD_HEADERS.length === 0) return;
    
    // データズレの自動修正: 2行目のB列がURLの場合、新列が未挿入と判断して挿入
    var lastRow = sheet.getLastRow();
    if (lastRow >= 2) {
      var valB2 = sheet.getRange(2, 2).getValue();
      // B列がURLなら、それは本来「現場フォルダURL」列（F列）にあるべきデータ
      if (typeof valB2 === 'string' && valB2.indexOf('http') === 0) {
        Logger.log('Fixing dashboard columns: Inserting 4 columns after A');
        sheet.insertColumnsAfter(1, 4);
      }
    }

    var currentHeaders = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), config.DASHBOARD_HEADERS.length)).getValues()[0];
    var needsUpdate = false;
    config.DASHBOARD_HEADERS.forEach(function(header, index) {
      if (currentHeaders[index] !== header) {
        sheet.getRange(1, index + 1).setValue(header);
        needsUpdate = true;
      }
    });
    if (needsUpdate) {
      headersCache[config.DASHBOARD_DATA_SHEET_NAME] = null;
    }
  }

  function setupDashboardFormatting() {
    var sheet = getDashboardSheet();
    var lastRow = sheet.getMaxRows();
    var lastCol = sheet.getLastColumn();
    
    // 1. 基本デザイン（フォント・配置）
    sheet.getRange(1, 1, lastRow, lastCol)
      .setFontFamily('Meiryo')
      .setVerticalAlignment('middle');
    
    // 2. ヘッダーデザイン（濃紺・白文字）
    sheet.getRange(1, 1, 1, lastCol)
      .setBackground('#1a237e')
      .setFontColor('#ffffff')
      .setFontWeight('bold')
      .setHorizontalAlignment('center');
    
    // 3. 縞模様（ゼブラ）の適用
    sheet.getRange(2, 1, lastRow - 1, lastCol).setBackground(null); // 一旦リセット
    for (var r = 2; r <= lastRow; r += 2) {
      sheet.getRange(r, 1, 1, lastCol).setBackground('#f8f9fa');
    }
    
    // 既存の条件付き書式ルールをクリア
    sheet.clearConditionalFormatRules();
    var rules = [];

    // ヘッダー行を取得して列インデックスを特定
    var config = getConfig();
    var headers = getHeaders(config.DASHBOARD_DATA_SHEET_NAME);
    
    // ヘッダー名と列インデックスのマッピング
    var colMap = {};
    headers.forEach(function(h, i) { colMap[h] = i + 1; });

    // 1. 報告完了（緑）: 日付が入っている場合
    // 対象: 現場調査最終報告日, 送り出し教育最終報告日, 解体前教育最終報告日, 足場工区点検最終報告日, 現場巡回最終報告日, 安全衛生協議会最終報告日
    var reportDateHeaders = [
      '現場調査最終報告日', 
      '送り出し教育最終報告日', 
      '解体前教育最終報告日', 
      '足場工区点検最終報告日', 
      '現場巡回最終報告日', 
      '安全衛生協議会最終報告日'
    ];
    
    reportDateHeaders.forEach(function(header) {
      if (colMap[header]) {
        var range = sheet.getRange(2, colMap[header], lastRow - 1, 1);
        var rule = SpreadsheetApp.newConditionalFormatRule()
          .whenCellNotEmpty()
          .setBackground('#d9ead3') // 薄い緑
          .setRanges([range])
          .build();
        rules.push(rule);
      }
    });

    // 2. 期限切れ（赤）: 予定日を過ぎて報告がない場合
    // 対象: 送出教育予定日 (報告: 送り出し教育最終報告日)
    if (colMap['送出教育予定日'] && colMap['送り出し教育最終報告日']) {
      var range = sheet.getRange(2, colMap['送出教育予定日'], lastRow - 1, 1);
      // 数式: =AND(予定日 < TODAY(), 報告日 = "")
      // 列文字に変換（簡易的）
      var colLetterPlan = columnToLetter(colMap['送出教育予定日']);
      var colLetterReport = columnToLetter(colMap['送り出し教育最終報告日']);
      var formula = '=AND($' + colLetterPlan + '2 < TODAY(), $' + colLetterReport + '2 = "")';
      
      var rule = SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied(formula)
        .setBackground('#f4cccc') // 薄い赤
        .setRanges([range])
        .build();
      rules.push(rule);
    }

    // 対象: 解体前教育予定日 (報告: 解体前教育最終報告日)
    if (colMap['解体前教育予定日'] && colMap['解体前教育最終報告日']) {
      var range = sheet.getRange(2, colMap['解体前教育予定日'], lastRow - 1, 1);
      var colLetterPlan = columnToLetter(colMap['解体前教育予定日']);
      var colLetterReport = columnToLetter(colMap['解体前教育最終報告日']);
      var formula = '=AND($' + colLetterPlan + '2 < TODAY(), $' + colLetterReport + '2 = "")';
      
      var rule = SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied(formula)
        .setBackground('#f4cccc') // 薄い赤
        .setRanges([range])
        .build();
      rules.push(rule);
    }

    // 3. 判定NG（赤）
    // 対象: 足場工区点検結果, 現場巡回結果
    var resultHeaders = ['足場工区点検結果', '現場巡回結果'];
    resultHeaders.forEach(function(header) {
      if (colMap[header]) {
        var range = sheet.getRange(2, colMap[header], lastRow - 1, 1);
        // "否" または "是正あり" を含む場合
        var rule = SpreadsheetApp.newConditionalFormatRule()
          .whenTextContains('否')
          .setBackground('#f4cccc') // 薄い赤
          .setRanges([range])
          .build();
        rules.push(rule);
        
        var rule2 = SpreadsheetApp.newConditionalFormatRule()
          .whenTextContains('是正あり')
          .setBackground('#f4cccc') // 薄い赤
          .setRanges([range])
          .build();
        rules.push(rule2);
      }
    });

    // 4. 判定OK（青）
    resultHeaders.forEach(function(header) {
      if (colMap[header]) {
        var range = sheet.getRange(2, colMap[header], lastRow - 1, 1);
        // "良" または "是正なし" を含む場合
        var rule = SpreadsheetApp.newConditionalFormatRule()
          .whenTextContains('良')
          .setBackground('#c9daf8') // 薄い青
          .setRanges([range])
          .build();
        rules.push(rule);
        
        var rule2 = SpreadsheetApp.newConditionalFormatRule()
          .whenTextContains('是正なし')
          .setBackground('#c9daf8') // 薄い青
          .setRanges([range])
          .build();
        rules.push(rule2);
      }
    });

    sheet.setConditionalFormatRules(rules);
  }

  function columnToLetter(column) {
    var temp, letter = '';
    while (column > 0) {
      temp = (column - 1) % 26;
      letter = String.fromCharCode(temp + 65) + letter;
      column = (column - temp - 1) / 26;
    }
    return letter;
  }

  /**
   * 既存の行グループをクリアする。
   */
  function clearRowGroups(sheet) {
    var maxRows = sheet.getMaxRows();
    if (maxRows < 2) return;
    for (var i = 0; i < 8; i++) {
      try {
        sheet.getRange(2, 1, maxRows - 1, 1).shiftRowGroupDepth(-1);
      } catch (e) {
        break;
      }
    }
  }

  /**
   * 既存のダッシュボードデータを現場名・工区名でソートし、階層構造で再配置する
   */
  function reorganizeExistingData() {
    var sheet = getDashboardSheet();
    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    if (lastRow < 2) return;

    var config = getConfig();
    var headers = getHeaders(config.DASHBOARD_DATA_SHEET_NAME);
    var data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

    // 1. データをオブジェクトの配列に変換
    var rows = data.map(function(row) {
      var obj = {};
      headers.forEach(function(h, i) {
        obj[h] = row[i];
      });
      return obj;
    });

    // 2. ソート（現場名昇順、工区名が空のものを優先）
    rows.sort(function(a, b) {
      var siteA = (a['現場名'] || '').toString().trim();
      var siteB = (b['現場名'] || '').toString().trim();
      var zoneA = (a['工区名'] || '').toString().trim();
      var zoneB = (b['工区名'] || '').toString().trim();

      if (siteA < siteB) return -1;
      if (siteA > siteB) return 1;
      
      // 同じ現場内の場合、工区名が空（親行）を一番上に
      if (zoneA === '' && zoneB !== '') return -1;
      if (zoneA !== '' && zoneB === '') return 1;
      
      if (zoneA < zoneB) return -1;
      if (zoneA > zoneB) return 1;
      return 0;
    });

    // 3. シートをクリアして再書き込み
    clearRowGroups(sheet); // 修正: sheet.clearRowGroups() ではなく内部関数を呼び出す
    sheet.getRange(2, 1, lastRow - 1, lastCol).clearContent();
    
    var sortedValues = rows.map(function(row) {
      return headers.map(function(h) {
        return row[h];
      });
    });

    sheet.getRange(2, 1, sortedValues.length, lastCol).setValues(sortedValues);

    // 4. グループ化を再適用
    for (var i = 0; i < rows.length; i++) {
      var zone = (rows[i]['工区名'] || '').toString().trim();
      if (zone !== '') {
        try {
          sheet.getRange(i + 2, 1).shiftRowGroupDepth(1);
        } catch (e) {
          // すでにグループ化されている場合などはスキップ
        }
      }
    }
  }

  /**
   * 承認ステータスを更新する
   * @param {string} siteName - 現場名
   * @param {string} status - 新しいステータス（CONFIG.APPROVAL_STATUS の値）
   * @param {string} [approver] - 承認者名
   * @param {string} [comment] - 差し戻しコメント
   */
  function updateApprovalStatus(siteName, status, approver, comment) {
    var config = getConfig();
    var updates = {
      '承認ステータス': status,
      '最終更新日時': new Date()
    };

    if (approver) {
      updates['承認者'] = approver;
      updates['最終承認日時'] = new Date();
    }

    if (comment) {
      updates['差し戻しコメント'] = comment;
    }

    // 承認済みの場合、差し戻しコメントをクリア
    if (status === config.APPROVAL_STATUS.APPROVED) {
      updates['差し戻しコメント'] = '';
    }

    var sheet = getDashboardSheet();
    var row = findRowBySiteName(sheet, siteName, '');
    if (row === -1) {
      throw new Error('現場が見つかりません: ' + siteName);
    }

    updateRowByHeaders(config.DASHBOARD_DATA_SHEET_NAME, row, updates);

    // 承認履歴に記録
    appendApprovalHistory(siteName, approver || 'System', status, comment || '');
  }

  /**
   * 承認履歴を追加する
   */
  function appendApprovalHistory(siteName, operator, action, comment) {
    var config = getConfig();
    var sheetName = config.APPROVAL_HISTORY_SHEET_NAME;

    // 承認履歴シートがなければ作成
    var ss = getSs();
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      sheet.appendRow(config.APPROVAL_HISTORY_HEADERS);
    }

    sheet.appendRow([
      new Date(),
      siteName,
      operator,
      action,
      comment
    ]);
  }

  /**
   * 承認履歴を取得する
   * @param {string} siteName - 現場名
   * @return {Array} 履歴の配列
   */
  function getApprovalHistory(siteName) {
    var config = getConfig();
    var ss = getSs();
    var sheet = ss.getSheetByName(config.APPROVAL_HISTORY_SHEET_NAME);
    if (!sheet) return [];

    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];

    var data = sheet.getRange(2, 1, lastRow - 1, config.APPROVAL_HISTORY_HEADERS.length).getValues();
    var history = [];

    var target = SiteNameUtils.normalizeSiteName(siteName);
    for (var i = 0; i < data.length; i++) {
      if (SiteNameUtils.normalizeSiteName(data[i][1]) === target) {
        history.push({
          timestamp: data[i][0],
          siteName: data[i][1],
          operator: data[i][2],
          action: data[i][3],
          comment: data[i][4]
        });
      }
    }

    return history;
  }

  return {
    getSheet: getSheet,
    getMasterSheet: getMasterSheet,
    getDashboardSheet: getDashboardSheet,
    ensureTimelineRow: ensureTimelineRow,
    findRowBySiteName: findRowBySiteName,
    updateCell: updateCell,
    appendToSheet: appendToSheet,
    updateRowByHeaders: updateRowByHeaders,
    updateDashboard: updateDashboard,
    updateParentSummary: updateParentSummary,
    getHeaders: getHeaders,
    getDashboardValue: getDashboardValue,
    getDashboardData: getDashboardData,
    bootstrapDashboard: bootstrapDashboard,
    setupDashboardFormatting: setupDashboardFormatting,
    reorganizeExistingData: reorganizeExistingData,
    updateApprovalStatus: updateApprovalStatus,
    appendApprovalHistory: appendApprovalHistory,
    getApprovalHistory: getApprovalHistory
  };
})();
