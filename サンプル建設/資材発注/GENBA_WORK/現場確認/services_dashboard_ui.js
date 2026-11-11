/**
 * 高度なダッシュボードUIを構築・更新するサービス。
 * データシート（裏方）からデータを読み込み、表示用シート（表側）を描画する。
 */
var DashboardUIService = (function() {
  var config = getConfig();
  var DEFAULT_DISPLAY_DAYS = 730; // 表示する日数（2年分）
  var DAY_IN_MS = 1000 * 60 * 60 * 24;
  var COLORS = {
    assemblyPlan: '#4285f4',
    dismantlePlan: '#34a853',
    sendOutMilestone: '#f9a825',
    preEducationMilestone: '#f57c00'
  };
  
  function getSpreadsheet() {
    return SpreadsheetApp.getActiveSpreadsheet();
  }

  /**
   * 稼働現場リストから工期データを取得してマップで返す
   * @returns {Object} { '現場名': { assemblyStart, assemblyEnd, dismantleStart, dismantleEnd } }
   */
  function getScheduleMapFromMaster() {
    var ss = getSpreadsheet();
    var masterSheet = ss.getSheetByName(config.MASTER_SHEET_NAME);
    if (!masterSheet) return {};

    var lastRow = masterSheet.getLastRow();
    if (lastRow < 2) return {};

    // A列:現場名, E列:組始, F列:組終, G列:解始, H列:解終
    var data = masterSheet.getRange(2, 1, lastRow - 1, 8).getValues();
    var map = {};

    data.forEach(function(row) {
      var siteName = SiteNameUtils.normalizeSiteName(row[0] || '');
      if (!siteName) return;

      map[siteName] = {
        assemblyStart: row[4] || null,  // E列
        assemblyEnd: row[5] || null,    // F列
        dismantleStart: row[6] || null, // G列
        dismantleEnd: row[7] || null    // H列
      };
    });

    return map;
  }

  /**
   * UIシートを初期化・再構築する。
   * 手動実行用。
   */
  function setupAdvancedDashboard() {
    var ss = getSpreadsheet();
    var uiSheet = ss.getSheetByName(config.DASHBOARD_UI_SHEET_NAME);
    
    // シートがなければ作成
    if (!uiSheet) {
      uiSheet = ss.insertSheet(config.DASHBOARD_UI_SHEET_NAME);
      // 1番目に移動
      ss.setActiveSheet(uiSheet);
      ss.moveActiveSheet(1);
    }
    
    // シートをクリア
    uiSheet.clear();
    // 基本レイアウト設定
    setupLayout(uiSheet, DEFAULT_DISPLAY_DAYS);
    
    // データシートからデータを読み込んで表示
    refreshDashboardData(uiSheet);
  }
  
  /**
   * 基本レイアウト（ヘッダー、列幅、固定枠など）を設定
   */
  function setupLayout(sheet, displayDays) {
    displayDays = displayDays || DEFAULT_DISPLAY_DAYS;
    // 必要な列数を確保 (A,B + 日付列)
    var totalCols = 2 + displayDays;
    var currentCols = sheet.getMaxColumns();
    if (currentCols < totalCols) {
      sheet.insertColumnsAfter(currentCols, totalCols - currentCols);
    }

    // 列幅の設定
    // A: 現場名 (200px)
    // B: 進捗状況 (300px)
    // C以降: 日付 (30px)
    sheet.setColumnWidth(1, 200); // 現場名
    sheet.setColumnWidth(2, 300); // 進捗状況
    
    // 日付カラムの幅を一括設定するのは重いので、50列ずつ設定
    // ※GASの制限回避のため
    // for (var i = 3; i <= totalCols; i++) {
    //   sheet.setColumnWidth(i, 30);
    // }
    // 簡易的に全列デフォルト幅にしてから、A,Bだけ広げるアプローチも可だが、
    // ここでは重要な最初の60日分だけ明示的に設定し、残りはデフォルトでも良いかも。
    // 一旦ループで設定（タイムアウト注意）
    if (totalCols > 2) {
      try {
        sheet.setColumnWidths(3, totalCols - 2, 30);
      } catch (e) {
        console.warn('列幅の一括設定に失敗しました: ' + e);
      }
    }
    
    // ヘッダー行の作成
    // 1行目: タイトル・凡例
    sheet.getRange('A1').setValue('現場情報 / 手動進捗入力');
    sheet.getRange('B1').setValue('報告状況');
    
    // ヘッダーのスタイル
    var headerRange = sheet.getRange(1, 1, 1, totalCols);
    headerRange.setBackground('#f3f3f3');
    headerRange.setFontWeight('bold');
    headerRange.setHorizontalAlignment('center');
    headerRange.setVerticalAlignment('middle');
    
    // 枠固定
    sheet.setFrozenRows(1);
    sheet.setFrozenColumns(2);
  }
  
  /**
   * 日付ヘッダーを更新する
   * @param {Sheet} sheet 
   * @param {Date} startDate 
   */
  function updateDateHeaders(sheet, startDate, displayDays) {
    displayDays = displayDays || DEFAULT_DISPLAY_DAYS;
    var headers = [];
    var date = new Date(startDate);
    
    for (var i = 0; i < displayDays; i++) {
      headers.push(formatDateShort(date)); // M/d
      date.setDate(date.getDate() + 1);
    }
    
    // C1から書き込み
    // 配列サイズが大きいので分割書き込みを検討すべきだが、365なら一括でいける可能性が高い
    sheet.getRange(1, 3, 1, headers.length).setValues([headers]);
  }

  /**
   * データシートからデータを読み込み、UIシートに反映する
   */
  function refreshDashboardData(uiSheet) {
    if (!uiSheet) {
      var ss = getSpreadsheet();
      uiSheet = ss.getSheetByName(config.DASHBOARD_UI_SHEET_NAME);
      if (!uiSheet) return; // シートがない場合は何もしない
    }

    // データシートから全データ取得
    var data = SheetService.getDashboardData();
    var rows = data.rows;

    // 進捗データを一括取得
    var progressMap = ProgressService.getAllProgressData();

    // 稼働現場リストから工期データを取得
    var scheduleMap = getScheduleMapFromMaster();
    
    // 現場ごとにグループ化（親行と子行を分ける）
    var siteGroups = {}; // { siteName: { parent: row, children: [rows] } }
    rows.forEach(function(row) {
      var siteName = SiteNameUtils.normalizeSiteName(row['現場名'] || '');
      if (siteName === '') return; // 現場名がない行は無視
      
      var zoneName = (row['工区名'] || '').toString().trim();
      
      if (!siteGroups[siteName]) {
        siteGroups[siteName] = { parent: null, children: {} }; // childrenを連想配列に変更して重複排除
      }
      
      if (zoneName === '') {
        // 親行のデータをマージ
        if (!siteGroups[siteName].parent) {
          siteGroups[siteName].parent = row;
        } else {
          // 既存の親行に新しいデータをマージ（空でない値で上書き）
          Object.keys(row).forEach(function(key) {
            if (row[key] !== '' && row[key] !== null && row[key] !== undefined) {
              siteGroups[siteName].parent[key] = row[key];
            }
          });
        }
      } else {
        // 子行のデータをマージ
        if (!siteGroups[siteName].children[zoneName]) {
          siteGroups[siteName].children[zoneName] = row;
        } else {
          Object.keys(row).forEach(function(key) {
            if (row[key] !== '' && row[key] !== null && row[key] !== undefined) {
              siteGroups[siteName].children[zoneName][key] = row[key];
            }
          });
        }
      }
    });
    
    var timelineRange = determineTimelineRange(rows);
    var startDate = timelineRange.startDate;
    var displayDays = timelineRange.displayDays;
    
    // レイアウトとヘッダーを最新の期間に合わせる
    setupLayout(uiSheet, displayDays);
    updateDateHeaders(uiSheet, startDate, displayDays);
    
    // 既存のグループをクリア
    clearRowGroups(uiSheet);

    // UIシートのデータエリアをクリア（ヘッダー以外）
    var lastRow = uiSheet.getLastRow();
    if (lastRow > 1) {
      uiSheet.getRange(2, 1, lastRow - 1, uiSheet.getLastColumn()).clearContent();
      uiSheet.getRange(2, 1, lastRow - 1, uiSheet.getLastColumn()).clearFormat();
      uiSheet.getRange(2, 1, lastRow - 1, uiSheet.getLastColumn()).setBackground(null);
    }
    
    if (Object.keys(siteGroups).length === 0) return;
    
    var startRow = 2;
    var totalCols = 2 + displayDays;
    var siteNames = Object.keys(siteGroups);
    
    siteNames.forEach(function(siteName, siteIndex) {
      var group = siteGroups[siteName];
      var parentRow = group.parent;
      var children = group.children;
      
      // 親行がない場合はダミーを作成
      if (!parentRow) {
        parentRow = { '現場名': siteName };
      }
      
      var currentRow = startRow;
      
      // 親行を描画（2行使用）- 稼働現場リストから工期を取得
      drawParentRow(uiSheet, currentRow, parentRow, startDate, displayDays, totalCols, scheduleMap);
      currentRow += 2;
      
      // 子行（工区）を描画
      var childStartRow = currentRow;
      var zoneNames = Object.keys(group.children);
      zoneNames.forEach(function(zoneName) {
        var child = group.children[zoneName];
        drawChildRow(uiSheet, currentRow, child, parentRow, startDate, displayDays, totalCols, progressMap);
        currentRow += 2; // 1工区につき2行使用
      });
      
      // 子行がある場合、グループ化を適用
      var childCount = Object.keys(group.children).length;
      if (childCount > 0) {
        var groupEndRow = currentRow - 1;
        try {
          uiSheet.getRange(childStartRow, 1, groupEndRow - childStartRow + 1, 1).shiftRowGroupDepth(1);
        } catch (e) {
          Logger.log('[DashboardUI] Row grouping failed: %s', e.toString());
        }
      }
      
      startRow = currentRow;
    });
  }
  
  /**
   * 親行（現場全体）を描画する。
   * @param {Object} scheduleMap 稼働現場リストから取得した工期マップ（任意）
   */
  function drawParentRow(sheet, row, parentData, timelineStartDate, displayDays, totalCols, scheduleMap) {
    // 工期データは稼働現場リストから優先取得（③データベースを挟まない）
    var siteName = SiteNameUtils.normalizeSiteName(parentData['現場名'] || '');
    var schedule = (scheduleMap && scheduleMap[siteName]) || {};

    // FormUtils.parseDateで日付を正規化（文字列・Dateオブジェクト両対応）
    var assemblyStart = FormUtils.parseDate(schedule.assemblyStart) || FormUtils.parseDate(parentData['組立開始予定日']) || FormUtils.parseDate(parentData['着工予定日']);
    var assemblyEnd = FormUtils.parseDate(schedule.assemblyEnd) || FormUtils.parseDate(parentData['組立終了予定日']);
    var dismantleStart = FormUtils.parseDate(schedule.dismantleStart) || FormUtils.parseDate(parentData['解体開始予定日']);
    var dismantleEnd = FormUtils.parseDate(schedule.dismantleEnd) || FormUtils.parseDate(parentData['解体終了予定日']);
    
    // 1. 現場名 (A列) — 表示も正規化後で統一（マスタ・工期マップと整合）
    var siteNameCell = sheet.getRange(row, 1);
    var siteNameText = siteName || (parentData['現場名'] || '');
    var siteFolderUrl = parentData['現場フォルダURL'];
    
    if (siteFolderUrl) {
      siteNameCell.setFormula('=HYPERLINK("' + siteFolderUrl + '", "' + siteNameText + '")');
    } else {
      siteNameCell.setValue(siteNameText);
    }
    
    siteNameCell.setFontWeight('bold');
    siteNameCell.setFontSize(14);
    siteNameCell.setBackground('#e8f0fe'); // 親行は薄い青
    
    // 下段: 工期情報
    var infoCell = sheet.getRange(row + 1, 1);
    var planText = '組立: ' + formatDate(assemblyStart) + ' ~ ' + formatDate(assemblyEnd) + '\n' +
                   '解体: ' + formatDate(dismantleStart) + ' ~ ' + formatDate(dismantleEnd);
    infoCell.setValue(planText);
    infoCell.setFontSize(8);
    infoCell.setWrap(true);
    infoCell.setBackground('#e8f0fe');
    
    // 2. 進捗状況 (B列)
    var statusCell = sheet.getRange(row, 2, 2, 1);
    statusCell.merge();
    statusCell.setHorizontalAlignment('center');
    statusCell.setVerticalAlignment('middle');
    statusCell.setBackground('#e8f0fe');
    
    var icons = getStatusIcons(parentData);
    statusCell.setValue(icons);
    statusCell.setFontSize(16);
    
    // 3. ガントチャート (C列以降) - 親行は薄い色で表示
    // 上段（row）に予定（組立・解体）をまとめて表示
    if (assemblyStart) {
      var effectiveEnd = assemblyEnd || assemblyStart;
      drawBar(sheet, row, assemblyStart, effectiveEnd, '#a4c2f4', timelineStartDate, displayDays); // 薄い青
    }
    
    if (dismantleStart) {
      var effectiveEnd = dismantleEnd || dismantleStart;
      // 解体も上段（row）に描画
      drawBar(sheet, row, dismantleStart, effectiveEnd, '#93c47d', timelineStartDate, displayDays); // 薄い緑
    }

    // --- 下段（row + 1）に実績を描画 ---
    // 1. 実績バー（手動入力分）
    var actualAssemblyStart = parentData['組立開始実績日'];
    var actualAssemblyEnd = parentData['組立終了実績日'];
    if (actualAssemblyStart) {
      drawBar(sheet, row + 1, actualAssemblyStart, actualAssemblyEnd || actualAssemblyStart, config.ACTUAL_BAR_COLORS.assembly, timelineStartDate, displayDays);
    }

    var actualDismantleStart = parentData['解体開始実績日'];
    var actualDismantleEnd = parentData['解体終了実績日'];
    if (actualDismantleStart) {
      drawBar(sheet, row + 1, actualDismantleStart, actualDismantleEnd || actualDismantleStart, config.ACTUAL_BAR_COLORS.dismantle, timelineStartDate, displayDays);
    }

    // 2. 報告日マーカー（自動：各フェーズの報告日）
    drawActualMarkers(sheet, row + 1, parentData, timelineStartDate, displayDays);
    
    // 枠線
    sheet.getRange(row, 1, 2, totalCols).setBorder(true, true, true, true, true, true, '#666666', SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
    
    // 送出教育ライン
    drawMilestoneLine(sheet, row, parentData['送出教育予定日'], COLORS.sendOutMilestone, timelineStartDate, displayDays, true);
    
    // 解体前教育
    if (parentData['解体前教育予定日']) {
      drawBar(sheet, row, parentData['解体前教育予定日'], parentData['解体前教育予定日'], COLORS.preEducationMilestone, timelineStartDate, displayDays);
    }
  }
  
  /**
   * 子行（工区）を描画する。
   */
  function drawChildRow(sheet, row, childData, parentData, timelineStartDate, displayDays, totalCols, progressMap) {
    var assemblyStart = childData['組立開始予定日'];
    var assemblyEnd = childData['組立終了予定日'];
    var dismantleStart = childData['解体開始予定日'];
    var dismantleEnd = childData['解体終了予定日'];
    
    // 1. 工区名 (A列)
    var zoneNameCell = sheet.getRange(row, 1);
    var zoneName = childData['工区名'] || '(工区名不明)';

    var displayText = '  ▸ ' + zoneName;

    zoneNameCell.setValue(displayText);
    zoneNameCell.setFontSize(11);

    // 下段: 工期情報
    var infoCell = sheet.getRange(row + 1, 1);
    var planText = '組立: ' + formatDate(assemblyStart) + ' ~ ' + formatDate(assemblyEnd) + '\n' +
                   '解体: ' + formatDate(dismantleStart) + ' ~ ' + formatDate(dismantleEnd);
    infoCell.setValue(planText);
    infoCell.setFontSize(8);
    infoCell.setWrap(true);

    // 2. 進捗状況 (B列)
    var statusCell = sheet.getRange(row, 2, 2, 1);
    statusCell.merge();
    statusCell.setHorizontalAlignment('center');
    statusCell.setVerticalAlignment('middle');
    statusCell.setFontSize(9);
    
    // 3. ガントチャート (C列以降) - 子行は濃い色で表示
    if (assemblyStart) {
      var effectiveEnd = assemblyEnd || assemblyStart;
      drawBar(sheet, row, assemblyStart, effectiveEnd, COLORS.assemblyPlan, timelineStartDate, displayDays);
    }
    
    if (dismantleStart) {
      var effectiveEnd = dismantleEnd || dismantleStart;
      // 解体も上段（row）に描画
      drawBar(sheet, row, dismantleStart, effectiveEnd, COLORS.dismantlePlan, timelineStartDate, displayDays);
    }

    // --- 下段（row + 1）に実績を描画 ---
    // 1. 進捗グラデーション（背景色）
    var siteName = SiteNameUtils.normalizeSiteName(parentData['現場名'] || '');
    var zoneName = childData['工区名'];
    drawProgressGradients(sheet, row + 1, siteName, zoneName, progressMap, timelineStartDate, displayDays);

    // 2. 実績バー（手動入力分 - 期間表示）
    var actualAssemblyStart = childData['組立開始実績日'];
    var actualAssemblyEnd = childData['組立終了実績日'];
    if (actualAssemblyStart) {
      drawBar(sheet, row + 1, actualAssemblyStart, actualAssemblyEnd || actualAssemblyStart, config.ACTUAL_BAR_COLORS.assembly, timelineStartDate, displayDays);
    }

    var actualDismantleStart = childData['解体開始実績日'];
    var actualDismantleEnd = childData['解体終了実績日'];
    if (actualDismantleStart) {
      drawBar(sheet, row + 1, actualDismantleStart, actualDismantleEnd || actualDismantleStart, config.ACTUAL_BAR_COLORS.dismantle, timelineStartDate, displayDays);
    }

    // 3. 報告日マーカー（自動：各フェーズの報告日）
    drawActualMarkers(sheet, row + 1, childData, timelineStartDate, displayDays);
    
    // 枠線
    sheet.getRange(row, 1, 2, totalCols).setBorder(true, true, true, true, true, true, '#e0e0e0', SpreadsheetApp.BorderStyle.SOLID);
    
    // 送出教育ライン（親から継承）
    drawMilestoneLine(sheet, row, parentData['送出教育予定日'], COLORS.sendOutMilestone, timelineStartDate, displayDays, true);
    
    // 解体前教育（親から継承）
    if (parentData['解体前教育予定日']) {
      drawBar(sheet, row, parentData['解体前教育予定日'], parentData['解体前教育予定日'], COLORS.preEducationMilestone, timelineStartDate, displayDays);
    }
  }
  
  /**
   * 既存の行グループをクリアする。
   */
  function clearRowGroups(sheet) {
    var maxRows = sheet.getMaxRows();
    if (maxRows < 2) return;
    
    // 確実に全レベル解除するために、ループ内で個別にtry-catch
    for (var i = 0; i < 8; i++) {
      try {
        sheet.getRange(2, 1, maxRows - 1, 1).shiftRowGroupDepth(-1);
      } catch (e) {
        // これ以上解除できない場合はループを抜ける
        break;
      }
    }
  }
  
  /**
   * 進捗アイコン文字列を生成
   */
  function getStatusIcons(row) {
    var s1 = row['現場調査最終報告日'] ? '✅' : '①';
    var s2 = row['仮設計画打合わせ最終報告日'] ? '✅' : '②';
    var s3 = row['送り出し教育最終報告日'] ? '✅' : '③';
    var s4 = row['解体前教育最終報告日'] ? '✅' : '④';
    var s5 = row['足場工区点検最終報告日'] ? '✅' : '⑤';
    var s6 = row['現場巡回最終報告日'] ? '✅' : '⑥';
    var s7 = row['安全衛生協議会最終報告日'] ? '✅' : '⑦';
    
    return s1 + ' ' + s2 + ' ' + s3 + ' ' + s4 + ' ' + s5 + ' ' + s6 + ' ' + s7;
  }
  
  /**
   * ガントチャートのバーを描画（背景色設定）
   */
  function drawBar(sheet, row, startDateStr, endDateStr, color, timelineStartDate, displayDays) {
    if (!startDateStr || !endDateStr) return;

    // FormUtils.parseDateで安全に日付を解析（文字列・Dateオブジェクト両対応）
    var start = FormUtils.parseDate(startDateStr);
    var end = FormUtils.parseDate(endDateStr);
    if (!start || !end) return; // 無効な日付はスキップ

    start.setHours(0,0,0,0);
    end.setHours(0,0,0,0);
    
    var timelineStart = new Date(timelineStartDate);
    timelineStart.setHours(0,0,0,0);
    
    // タイムラインの開始日と終了日
    var timelineEnd = new Date(timelineStart);
    timelineEnd.setDate(timelineEnd.getDate() + (displayDays || DEFAULT_DISPLAY_DAYS) - 1);
    
    // 期間が重なっているかチェック
    if (end < timelineStart || start > timelineEnd) return;
    
    // 描画範囲を計算（タイムライン内でのインデックス 0〜DISPLAY_DAYS-1）
    // Math.max(start, timelineStart) から Math.min(end, timelineEnd) まで
    var drawStart = start < timelineStart ? timelineStart : start;
    var drawEnd = end > timelineEnd ? timelineEnd : end;
    
    // 日数差を計算して列インデックスに変換
    var diffStart = Math.floor((drawStart - timelineStart) / DAY_IN_MS);
    var diffEnd = Math.floor((drawEnd - timelineStart) / DAY_IN_MS);
    
    // 列オフセットは3 (C列)
    // 範囲指定: row行, 3 + diffStart列, 1行, (diffEnd - diffStart + 1)列
    var colStart = 3 + diffStart;
    var numCols = diffEnd - diffStart + 1;
    
    if (numCols > 0) {
      sheet.getRange(row, colStart, 1, numCols).setBackground(color);
    }
  }
  
  function drawMilestoneLine(sheet, topRow, dateValue, color, timelineStartDate, displayDays, fill) {
    var milestone = FormUtils.parseDate(dateValue);
    if (!milestone) return;
    milestone.setHours(0, 0, 0, 0);
    
    var timelineStart = new Date(timelineStartDate);
    timelineStart.setHours(0, 0, 0, 0);
    var timelineEnd = new Date(timelineStart);
    timelineEnd.setDate(timelineEnd.getDate() + (displayDays || DEFAULT_DISPLAY_DAYS) - 1);
    if (milestone < timelineStart || milestone > timelineEnd) return;
    
    var diff = Math.floor((milestone - timelineStart) / DAY_IN_MS);
    var col = 3 + diff;
    var range = sheet.getRange(topRow, col, 1, 1); // 1行のみに変更
    
    if (fill) {
      range.setBackground(color); // 1行分のみ設定
      range.setBorder(false, false, false, false, false, false);
    } else {
      // 縦線として見えるよう左右のボーダーを着色（上下はリセットし、背景は触らない）
      range.setBorder(null, true, null, true, null, null, color, SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
    }
  }

  /**
   * 各フェーズの報告日を実績行（下段）にマーカーとして描画する
   * 同日に複数ある場合はリッチテキストで併記する
   */
  function drawActualMarkers(sheet, row, data, timelineStartDate, displayDays) {
    var timelineStart = new Date(timelineStartDate);
    timelineStart.setHours(0, 0, 0, 0);
    var timelineEnd = new Date(timelineStart);
    timelineEnd.setDate(timelineEnd.getDate() + (displayDays || DEFAULT_DISPLAY_DAYS) - 1);

    // 列ごとのマーカーリストを収集
    // key: colIndex, value: Array of { text: string, color: string }
    var markersMap = {};

    var phaseDateHeaders = {
      1: '現場調査最終報告日',
      2: '仮設計画打合わせ最終報告日',
      3: '送り出し教育最終報告日',
      4: '解体前教育最終報告日',
      5: '足場工区点検最終報告日',
      6: '現場巡回最終報告日',
      7: '安全衛生協議会最終報告日'
    };

    var icons = {
      1: '①', 2: '②', 3: '③', 4: '④', 5: '⑤', 6: '⑥', 7: '⑦'
    };

    // ヘルパー: マーカーをマップに追加
    function addMarker(dateValue, phase) {
      var date = FormUtils.parseDate(dateValue);
      if (!date) return;
      date.setHours(0, 0, 0, 0);
      
      if (date < timelineStart || date > timelineEnd) return;
      
      var diff = Math.floor((date - timelineStart) / DAY_IN_MS);
      var col = 3 + diff;
      
      if (!markersMap[col]) {
        markersMap[col] = [];
      }
      
      // 重複チェック（同じフェーズのアイコンは1つにする場合）
      // 今回は「すべて」表示する方針だが、全く同じアイコンが並ぶのを避けるならここでチェック
      // 要望は「①②」なので、フェーズが違えば追加。同じフェーズでも複数回報告があれば追加してよいか？
      // 「同じ日に2個報告が来た場合」とのことなので、単純に追加する。
      markersMap[col].push({
        text: icons[phase] || '●',
        color: config.PHASE_COLORS[phase] || '#000000'
      });
    }

    // 1. 全報告日ログ（複数回送信対応）
    var logStr = data['全報告日ログ'];
    var loggedDates = {};
    if (logStr) {
      try {
        loggedDates = JSON.parse(logStr);
      } catch (e) {
        Logger.log('[DashboardUI] Failed to parse log JSON: ' + e);
      }
    }

    Object.keys(loggedDates).forEach(function(phase) {
      var dates = loggedDates[phase];
      if (Array.isArray(dates)) {
        dates.forEach(function(dateStr) {
          addMarker(dateStr, phase);
        });
      }
    });

    // 2. ログにないフェーズ（後方互換）
    Object.keys(phaseDateHeaders).forEach(function(phase) {
      if (!loggedDates[phase] || loggedDates[phase].length === 0) {
        var header = phaseDateHeaders[phase];
        var dateValue = data[header];
        if (dateValue) {
          addMarker(dateValue, phase);
        }
      }
    });

    // 描画処理
    Object.keys(markersMap).forEach(function(col) {
      var markers = markersMap[col];
      // フェーズ順（番号順）にソート
      markers.sort(function(a, b) {
        return a.text.localeCompare(b.text);
      });

      var cell = sheet.getRange(row, parseInt(col));
      
      if (markers.length === 1) {
        // 1つだけなら通常の値セット
        cell.setValue(markers[0].text);
        cell.setFontColor(markers[0].color);
        cell.setFontWeight('bold');
        cell.setHorizontalAlignment('center');
      } else {
        // 複数ある場合はリッチテキスト
        var richTextBuilder = SpreadsheetApp.newRichTextValue();
        var allText = markers.map(function(m) { return m.text; }).join('');
        richTextBuilder.setText(allText);
        
        var currentIndex = 0;
        markers.forEach(function(m) {
          var len = m.text.length;
          var style = SpreadsheetApp.newTextStyle()
            .setForegroundColor(m.color)
            .setBold(true)
            .build();
          richTextBuilder.setTextStyle(currentIndex, currentIndex + len, style);
          currentIndex += len;
        });
        
        cell.setRichTextValue(richTextBuilder.build());
        cell.setHorizontalAlignment('center');
      }
    });
  }

  /**
   * 進捗報告データに基づき、実績行にグラデーションを描画する
   */
  function drawProgressGradients(sheet, row, siteName, zoneName, progressMap, timelineStartDate, displayDays) {
    if (!progressMap || !progressMap[siteName] || !progressMap[siteName][zoneName]) return;
    
    var zoneProgress = progressMap[siteName][zoneName];
    var timelineStart = new Date(timelineStartDate);
    timelineStart.setHours(0, 0, 0, 0);
    var timelineEnd = new Date(timelineStart);
    timelineEnd.setDate(timelineEnd.getDate() + (displayDays || DEFAULT_DISPLAY_DAYS) - 1);

    Object.keys(zoneProgress).forEach(function(dateKey) {
      var date = new Date(dateKey);
      if (date < timelineStart || date > timelineEnd) return;

      var diff = Math.floor((date - timelineStart) / DAY_IN_MS);
      var col = 3 + diff;
      var progress = zoneProgress[dateKey];
      
      var color = null;
      // 解体進捗を優先（通常は重ならないが）
      if (progress.dismantle) {
        var idx = Math.min(Math.floor(progress.dismantle / 10) - 1, 9);
        if (idx >= 0) color = config.PROGRESS_GRADIENTS.dismantle[idx];
      } else if (progress.assembly) {
        var idx = Math.min(Math.floor(progress.assembly / 10) - 1, 9);
        if (idx >= 0) color = config.PROGRESS_GRADIENTS.assembly[idx];
      }

      if (color) {
        sheet.getRange(row, col).setBackground(color);
      }
    });
  }
  
  function formatDate(date) {
    if (!date) return '-';
    var d = new Date(date);
    if (isNaN(d.getTime())) return '-'; // 不正な日付はハイフン
    return (d.getMonth() + 1) + '/' + d.getDate();
  }

  function formatDateShort(date) {
    return (date.getMonth() + 1) + '/' + date.getDate();
  }
  
  function determineTimelineRange(rows) {
    // 2026/01/01 固定スタート
    var startDate = new Date(2026, 0, 1);
    startDate.setHours(0, 0, 0, 0);
    
    // 2年分 (730日) 固定
    var displayDays = 730;
    
    return {
      startDate: startDate,
      displayDays: displayDays
    };
  }

  /**
   * 特定の現場（または工区）の行だけを再描画する（高速化用）
   */
  function refreshSiteRow(siteName, zoneName) {
    var config = getConfig();
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(config.DASHBOARD_UI_SHEET_NAME);
    if (!sheet) return;

    var normSite = SiteNameUtils.normalizeSiteName(siteName);

    // 1. タイムライン情報の取得（全体基準）
    var data = SheetService.getDashboardData();
    var timelineRange = determineTimelineRange(data.rows);
    var startDate = timelineRange.startDate;
    var displayDays = timelineRange.displayDays;
    var totalCols = 2 + displayDays;

    // 進捗データを取得
    var progressMap = ProgressService.getAllProgressData();

    // 稼働現場リストから工期データを取得
    var scheduleMap = getScheduleMapFromMaster();

    // 2. 対象行の検索
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return;
    var range = sheet.getRange(2, 1, lastRow - 1, 1);
    var values = range.getValues();
    
    var targetRowIndex = -1;
    
    for (var i = 0; i < values.length; i++) {
      var cellValue = values[i][0].toString();
      if (zoneName) {
        // 工区を探す
        if (cellValue.indexOf('▸ ' + zoneName) !== -1) {
           targetRowIndex = i + 2;
           break;
        }
      } else {
        // 現場（親）を探す（HYPERLINK セルはラベル部分を抽出して正規化比較）
        var plain = cellValue;
        var linkMatch = cellValue.match(/HYPERLINK\s*\(\s*"[^"]*"\s*,\s*"([^"]+)"/i);
        if (linkMatch) plain = linkMatch[1];
        if (SiteNameUtils.normalizeSiteName(plain) === normSite && cellValue.indexOf('▸') === -1) {
          targetRowIndex = i + 2;
          break;
        }
      }
    }
    
    if (targetRowIndex === -1) {
      console.warn('Site/Zone row not found: ' + siteName + (zoneName ? ' - ' + zoneName : ''));
      return;
    }

    // 3. データの準備（マージ処理）
    var siteRows = data.rows.filter(function(r) {
      return SiteNameUtils.normalizeSiteName(r['現場名']) === normSite;
    });
    var group = { parent: null, children: {} };
    
    siteRows.forEach(function(row) {
      var zName = (row['工区名'] || '').toString().trim();
      if (zName === '') {
        if (!group.parent) {
          group.parent = row;
        } else {
          Object.keys(row).forEach(function(key) {
            if (row[key] !== '' && row[key] !== null && row[key] !== undefined) {
              group.parent[key] = row[key];
            }
          });
        }
      } else {
        if (!group.children[zName]) {
          group.children[zName] = row;
        } else {
          Object.keys(row).forEach(function(key) {
            if (row[key] !== '' && row[key] !== null && row[key] !== undefined) {
              group.children[zName][key] = row[key];
            }
          });
        }
      }
    });

    // 4. クリアと再描画
    // ガントチャートエリア（C列以降）をクリア
    if (totalCols > 2) {
      sheet.getRange(targetRowIndex, 3, 2, totalCols - 2)
           .clearContent()
           .setBackground(null)
           .setBorder(false, false, false, false, false, false); // ボーダーも一旦消す
    }

    if (zoneName) {
      // 子行の再描画
      var childData = group.children[zoneName];
      var parentData = group.parent || { '現場名': siteName };
      if (childData) {
        drawChildRow(sheet, targetRowIndex, childData, parentData, startDate, displayDays, totalCols, progressMap);
      }
    } else {
      // 親行の再描画 - 稼働現場リストから工期を取得
      var parentData = group.parent || { '現場名': siteName };
      drawParentRow(sheet, targetRowIndex, parentData, startDate, displayDays, totalCols, scheduleMap);
    }
    
    SpreadsheetApp.flush();
  }
  
  return {
    setupAdvancedDashboard: setupAdvancedDashboard,
    refreshDashboardData: refreshDashboardData,
    refreshSiteRow: refreshSiteRow
  };
})();

function refreshDashboardUI() {
  DashboardUIService.refreshDashboardData();
}
