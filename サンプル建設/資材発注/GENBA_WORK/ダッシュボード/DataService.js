/**
 * データ読み取りサービス
 * 案件行（CASE_DATA_SHEET_NAME）/ 稼働現場リスト / 進捗報告 からデータを読み込み、
 * 1つのJSONペイロードに組み立てる。
 */
var DataService = (function() {
  var DAY_IN_MS = 1000 * 60 * 60 * 24;

  /** 現場名の照合用正規化（大本DB normalizeSiteName と同一ロジック） */
  function normalizeSiteNameKey(s) {
    if (s === null || s === undefined) return '';
    var str = String(s);
    // Unicode正規化（濁点・半濁点の合成/分解の揺れ＝NFC/NFDを統一。同名が別キーになる重複の主因）
    if (str.normalize) str = str.normalize('NFC');
    // ゼロ幅スペース等の不可視文字を除去（U+200B〜200D, U+2060, U+FEFF/BOM）
    str = str.replace(/[\u200B\u200C\u200D\u2060\uFEFF]/g, '');
    str = str.replace(/\u337F/g, '(株)');
    str = str.replace(/\uFF08\u682A\uFF09/g, '(株)');
    str = str.replace(/\uFF08\u682A\)/g, '(株)');
    str = str.replace(/\(\u682A\uFF09/g, '(株)');
    str = str.replace(/[０-９Ａ-Ｚａ-ｚ]/g, function(ch) {
      return String.fromCharCode(ch.charCodeAt(0) - 0xfee0);
    });
    str = str.replace(/\u3000/g, ' ');
    str = str.trim();
    str = str.replace(/\s+/g, ' ');
    return str;
  }

  /** 稼働現場リストの工期マップから現場名で解決（表記ゆれに強い） */
  function resolveScheduleFromMap(scheduleMap, displaySiteName, groupKey) {
    var candidates = [
      displaySiteName,
      normalizeSiteNameKey(displaySiteName),
      groupKey,
      normalizeSiteNameKey(groupKey)
    ];
    for (var i = 0; i < candidates.length; i++) {
      var k = candidates[i];
      if (k && scheduleMap[k]) return scheduleMap[k];
    }
    var targetNorm = normalizeSiteNameKey(displaySiteName || groupKey);
    if (!targetNorm) return {};
    var mapKeys = Object.keys(scheduleMap);
    for (var j = 0; j < mapKeys.length; j++) {
      if (normalizeSiteNameKey(mapKeys[j]) === targetNorm) {
        return scheduleMap[mapKeys[j]];
      }
    }
    return {};
  }

  /** スプレッドシートを取得 */
  function getSpreadsheet() {
    return SpreadsheetApp.openById(CONFIG.SOURCE_SPREADSHEET_ID);
  }

  // =============================================
  //  祝日取得 (Google Calendar)
  // =============================================
  function getHolidays(startYear, endYear) {
    var holidays = [];
    var calId = 'ja.japanese#sample@example.com';
    try {
      var cal = CalendarApp.getCalendarById(calId);
      if (cal) {
        var startDate = new Date(startYear, 0, 1);
        var endDate = new Date(endYear, 11, 31);
        var events = cal.getEvents(startDate, endDate);
        events.forEach(function(e) {
          var d = e.getAllDayStartDate() || e.getStartTime();
          var iso = formatDateISO(d);
          if (iso) holidays.push(iso);
        });
      }
    } catch(e) {
      Logger.log('祝日取得エラー: ' + e.toString());
    }
    return holidays;
  }

  // =============================================
  //  日付パース（FormUtils.parseDate 移植）
  // =============================================
  function parseDate(value) {
    if (!value) return null;
    if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
      return value;
    }
    if (typeof value === 'number') {
      if (value > 25569 && value < 100000) {
        var excelEpoch = new Date(1899, 11, 30);
        return new Date(excelEpoch.getTime() + value * DAY_IN_MS);
      }
      var fromTimestamp = new Date(value);
      if (!isNaN(fromTimestamp.getTime())) return fromTimestamp;
    }
    var date = new Date(value);
    if (isNaN(date.getTime())) return null;
    return date;
  }

  /** M/d 形式にフォーマット */
  function formatDateShort(date) {
    var d = parseDate(date);
    if (!d) return '';
    return (d.getMonth() + 1) + '/' + d.getDate();
  }

  /** yyyy-MM-dd_HH-mm-ss (曜日) 形式にフォーマット */
  var DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];
  function formatDateTimeFull(date) {
    var d = parseDate(date);
    if (!d) return null;
    var yyyy = d.getFullYear();
    var mm = ('0' + (d.getMonth() + 1)).slice(-2);
    var dd = ('0' + d.getDate()).slice(-2);
    var hh = ('0' + d.getHours()).slice(-2);
    var mi = ('0' + d.getMinutes()).slice(-2);
    var ss = ('0' + d.getSeconds()).slice(-2);
    var dow = DAY_NAMES[d.getDay()];
    return yyyy + '-' + mm + '-' + dd + '_' + hh + '-' + mi + '-' + ss + ' (' + dow + ')';
  }

  /** yyyy-MM-dd 形式にフォーマット */
  function formatDateISO(date) {
    var d = parseDate(date);
    if (!d) return null;
    var yyyy = d.getFullYear();
    var mm = ('0' + (d.getMonth() + 1)).slice(-2);
    var dd = ('0' + d.getDate()).slice(-2);
    return yyyy + '-' + mm + '-' + dd;
  }

  /** yyyy/MM/dd 表示用 */
  function formatDateDisplay(date) {
    var iso = formatDateISO(date);
    if (!iso) return null;
    return iso.replace(/-/g, '/');
  }

  /** 予定日・実施日から hover 用状態を判定（AlertService danger と同日基準） */
  function computePhaseScheduleStatus(plannedIso, implementedIso, today) {
    if (implementedIso) return '実施済';
    if (plannedIso) {
      var planned = parseDate(plannedIso);
      if (planned) {
        planned.setHours(0, 0, 0, 0);
        if (today.getTime() >= planned.getTime()) return '期限超過';
      }
    }
    return '未実施';
  }

  /** 複数候補から最初の有効日付（ISO）を返す */
  function pickDateISO() {
    for (var i = 0; i < arguments.length; i++) {
      var iso = formatDateISO(arguments[i]);
      if (iso) return iso;
    }
    return null;
  }

  /** 稼働現場リストの工期マップ用：空で上書きしないマージ */
  function mergeScheduleEntry(prev, next) {
    if (!prev) return next;
    return {
      assemblyStart:  next.assemblyStart  || prev.assemblyStart  || null,
      assemblyEnd:    next.assemblyEnd    || prev.assemblyEnd    || null,
      dismantleStart: next.dismantleStart || prev.dismantleStart || null,
      dismantleEnd:   next.dismantleEnd   || prev.dismantleEnd   || null
    };
  }

  // =============================================
  //  案件行読み取り（データベースシート）
  // =============================================
  function readDatabaseSheet() {
    var ss = getSpreadsheet();
    var sheet = ss.getSheetByName(CONFIG.CASE_DATA_SHEET_NAME);
    if (!sheet) return [];

    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    if (lastRow < 2 || lastCol < 1) return [];

    var headerRow = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var headers = headerRow.map(function(h) {
      return (h || '').toString().trim();
    });
    var values = sheet.getRange(2, 1, lastRow, lastCol).getValues();

    return values.map(function(row) {
      var obj = {};
      headers.forEach(function(header, i) {
        if (!header) return;
        obj[header] = i < row.length ? row[i] : '';
      });
      return obj;
    });
  }

  // =============================================
  //  稼働現場リストから工期マップ取得
  // =============================================
  function getScheduleMap() {
    var ss = getSpreadsheet();
    var sheet = ss.getSheetByName(CONFIG.MASTER_SHEET_NAME);
    if (!sheet) return {};

    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return {};

    // A列:現場名, E列:組始, F列:組終, G列:解始, H列:解終
    var data = sheet.getRange(2, 1, lastRow, 8).getValues();
    var map = {};

    data.forEach(function(row) {
      var raw = (row[0] || '').toString().trim();
      if (!raw) return;
      var sched = {
        assemblyStart:  formatDateISO(row[4]),
        assemblyEnd:    formatDateISO(row[5]),
        dismantleStart: formatDateISO(row[6]),
        dismantleEnd:   formatDateISO(row[7])
      };
      var nk = normalizeSiteNameKey(raw);
      map[raw] = mergeScheduleEntry(map[raw], sched);
      if (nk) {
        map[nk] = mergeScheduleEntry(map[nk], sched);
      }
    });

    return map;
  }

  // =============================================
  //  進捗報告シートから全進捗データ取得
  // =============================================
  function getAllProgressData() {
    var progressMap = {};
    var lastReportDates = {};
    var buildingProgress = {};

    // 棟なし判定用の値
    var NO_BUILDING_VALUES = ['該当なし', '（現場名に含む）'];

    // --- 職人進捗アプリ（Log_終業前報告）から読み取り ---
    try {
      var extSs = SpreadsheetApp.openById(CONFIG.PROGRESS_SOURCE_SPREADSHEET_ID);
      var extSheet = extSs.getSheetByName(CONFIG.PROGRESS_SOURCE_SHEET_NAME);
      if (extSheet) {
        var lastRow = extSheet.getLastRow();
        var lastCol = extSheet.getLastColumn();
        if (lastRow >= 2 && lastCol >= 1) {
          // ヘッダー名で列位置を解決（列の挿入・移動に強くする）
          var allValues = extSheet.getRange(1, 1, lastRow, lastCol).getValues();
          var headerRow = allValues[0];
          var colOf = function(names) {
            for (var n = 0; n < names.length; n++) {
              for (var c = 0; c < headerRow.length; c++) {
                if ((headerRow[c] || '').toString().trim() === names[n]) return c;
              }
            }
            return -1;
          };
          var IDX = {
            date:       colOf(['送信日時']),
            site:       colOf(['工事現場名', '現場名']),
            building:   colOf(['棟名']),
            reportType: colOf(['報告種別']),
            assembly:   colOf(['組立進捗率']),
            dismantle:  colOf(['解体進捗率']),
            zoneJson:   colOf(['進捗状況(各工区)', '進捗状況（各工区）'])
          };
          // ヘッダーが見つからない場合は旧固定レイアウトにフォールバック
          if (IDX.date < 0) IDX.date = 0;
          if (IDX.site < 0) IDX.site = 4;
          if (IDX.building < 0) IDX.building = 5;
          if (IDX.reportType < 0) IDX.reportType = 9;
          if (IDX.zoneJson < 0) IDX.zoneJson = 14;

          var data = allValues.slice(1);
          data.forEach(function(row) {
            var reportType = (row[IDX.reportType] || '').toString().trim();  // 報告種別
            if (reportType !== '終業前報告') return;

            var siteName = normalizeSiteNameKey(row[IDX.site]);    // 工事現場名
            if (!siteName) return;

            var dateKey = formatDateISO(row[IDX.date]);                // 送信日時
            if (!dateKey) return;

            var buildingName = (row[IDX.building] || '').toString().trim(); // 棟名
            var hasBuilding = buildingName && NO_BUILDING_VALUES.indexOf(buildingName) === -1;

            // 最終報告日を更新
            if (!lastReportDates[siteName] || dateKey > lastReportDates[siteName]) {
              lastReportDates[siteName] = dateKey;
            }

            // 組立進捗率 / 解体進捗率（ヘッダー名で解決した列から取得）
            var assemblyStr  = IDX.assembly  >= 0 ? (row[IDX.assembly]  || '').toString().replace('%', '').trim() : '';
            var dismantleStr = IDX.dismantle >= 0 ? (row[IDX.dismantle] || '').toString().replace('%', '').trim() : '';
            var assembly  = assemblyStr  ? parseFloat(assemblyStr)  : 0;
            var dismantle = dismantleStr ? parseFloat(dismantleStr) : 0;

            // 現場全体の進捗を zoneName='' で保存（既存ロジック）
            if (assembly > 0 || dismantle > 0) {
              if (!progressMap[siteName]) progressMap[siteName] = {};
              if (!progressMap[siteName]['']) progressMap[siteName][''] = {};
              if (!progressMap[siteName][''][dateKey]) progressMap[siteName][''][dateKey] = {};
              if (assembly  > 0) progressMap[siteName][''][dateKey].assembly  = assembly;
              if (dismantle > 0) progressMap[siteName][''][dateKey].dismantle = dismantle;
            }

            // --- 棟別進捗データの構築 ---
            if (!buildingProgress[siteName]) {
              buildingProgress[siteName] = { buildings: [] };
            }
            var siteProgress = buildingProgress[siteName];

            if (hasBuilding) {
              // 棟ありの場合: 棟別に全体進捗を保存
              if (siteProgress.buildings.indexOf(buildingName) === -1) {
                siteProgress.buildings.push(buildingName);
              }
              if (!siteProgress[buildingName]) {
                siteProgress[buildingName] = { progress: {}, zones: [] };
              }
              if (assembly > 0 || dismantle > 0) {
                if (!siteProgress[buildingName].progress[dateKey]) {
                  siteProgress[buildingName].progress[dateKey] = {};
                }
                if (assembly  > 0) siteProgress[buildingName].progress[dateKey].assembly  = assembly;
                if (dismantle > 0) siteProgress[buildingName].progress[dateKey].dismantle = dismantle;
              }
            }

            // 各工区の進捗（進捗状況(各工区)）— JSON配列
            var zoneStr = (row[IDX.zoneJson] || '').toString().trim();
            if (zoneStr) {
              try {
                var zones = JSON.parse(zoneStr);
                if (Array.isArray(zones)) {
                  zones.forEach(function(zp) {
                    var zName = normalizeSiteNameKey(zp['工区']);
                    var zPctStr = (zp['進捗'] || '').toString().replace('%', '').trim();
                    var zPct = zPctStr ? parseFloat(zPctStr) : 0;
                    var workType = (zp['作業種別'] || '').toString().trim();
                    // 作業種別で振り分け（デフォルトは組立）
                    var progressKey = (workType === '解体') ? 'dismantle' : 'assembly';
                    if (zName && zPct > 0) {
                      // 既存の progressMap への保存
                      if (!progressMap[siteName]) progressMap[siteName] = {};
                      if (!progressMap[siteName][zName]) progressMap[siteName][zName] = {};
                      if (!progressMap[siteName][zName][dateKey]) progressMap[siteName][zName][dateKey] = {};
                      progressMap[siteName][zName][dateKey][progressKey] = zPct;

                      // 棟別進捗への工区データ保存
                      if (hasBuilding) {
                        var bData = siteProgress[buildingName];
                        if (bData.zones.indexOf(zName) === -1) {
                          bData.zones.push(zName);
                        }
                        if (!bData[zName]) bData[zName] = {};
                        if (!bData[zName][dateKey]) bData[zName][dateKey] = {};
                        bData[zName][dateKey][progressKey] = zPct;
                      } else {
                        // 棟なし: 現場直下に工区を配置
                        if (!siteProgress.zones) siteProgress.zones = [];
                        if (siteProgress.zones.indexOf(zName) === -1) {
                          siteProgress.zones.push(zName);
                        }
                        if (!siteProgress[zName]) siteProgress[zName] = {};
                        if (!siteProgress[zName][dateKey]) siteProgress[zName][dateKey] = {};
                        siteProgress[zName][dateKey][progressKey] = zPct;
                      }
                    }
                  });
                }
              } catch(e) { /* JSON parse error — skip */ }
            }
          });
        }
      }
    } catch(e) {
      Logger.log('外部進捗データ読み取りエラー: ' + e.toString());
      Logger.log('スタック: ' + e.stack);
    }

    // --- ダッシュボード内部の進捗報告シート（フォールバック） ---
    try {
      var ss = getSpreadsheet();
      var sheet = ss.getSheetByName(CONFIG.PROGRESS_SHEET_NAME);
      if (sheet) {
        var lr = sheet.getLastRow();
        if (lr >= 2) {
          var rows = sheet.getRange(2, 1, lr, 7).getValues();
          rows.forEach(function(row) {
            var siteName   = normalizeSiteNameKey(row[1]);
            var zoneName   = normalizeSiteNameKey(row[2]);
            var reportDate = row[3];
            var reportType = (row[4] || '').toString().trim();
            var completion = row[5];
            if (!siteName) return;
            var dateKey = formatDateISO(reportDate);
            if (!dateKey) return;

            if (!lastReportDates[siteName] || dateKey > lastReportDates[siteName]) {
              lastReportDates[siteName] = dateKey;
            }

            if (!progressMap[siteName]) progressMap[siteName] = {};
            if (!progressMap[siteName][zoneName]) progressMap[siteName][zoneName] = {};
            if (!progressMap[siteName][zoneName][dateKey]) progressMap[siteName][zoneName][dateKey] = {};
            if (reportType === '組立中') {
              progressMap[siteName][zoneName][dateKey].assembly = completion;
            } else if (reportType === '解体中') {
              progressMap[siteName][zoneName][dateKey].dismantle = completion;
            }
          });
        }
      }
    } catch(e) { /* fallback failure — ignore */ }

    return { map: progressMap, lastDates: lastReportDates, buildingProgress: buildingProgress };
  }

  // =============================================
  //  進捗詳細データ取得（詳細ページ用）
  // =============================================
  var SAFETY_LABELS = ['①親綱','②資材置き場','③荷揚げ場所','④避難場所','⑤足場の外観','⑥梁枠','⑦既存物養生','⑧特殊材','⑨詰所'];

  function toPercent(val) {
    if (!val) return 0;
    var n = parseFloat(val.toString().replace('%','').trim());
    if (isNaN(n)) return 0;
    if (n > 0 && n <= 1) n = n * 100;
    return Math.round(n);
  }

  function getProgressDetails(siteName) {
    var reports = [];
    try {
      var extSs = SpreadsheetApp.openById(CONFIG.PROGRESS_SOURCE_SPREADSHEET_ID);
      var extSheet = extSs.getSheetByName(CONFIG.PROGRESS_SOURCE_SHEET_NAME);
      if (!extSheet) return reports;

      var lastRow = extSheet.getLastRow();
      var lastCol = extSheet.getLastColumn();
      if (lastRow < 2 || lastCol < 1) return reports;

      // ヘッダー名で列位置を解決（列の挿入・移動に強くする）
      var allValues = extSheet.getRange(1, 1, lastRow, lastCol).getValues();
      var headerRow = allValues[0];
      var colOf = function(names) {
        for (var n = 0; n < names.length; n++) {
          for (var c = 0; c < headerRow.length; c++) {
            if ((headerRow[c] || '').toString().trim() === names[n]) return c;
          }
        }
        return -1;
      };
      var I = {
        date:        colOf(['送信日時']),
        site:        colOf(['工事現場名', '現場名']),
        reportType:  colOf(['報告種別']),
        reporter:    colOf(['報告者名']),
        workType:    colOf(['作業種別']),
        assembly:    colOf(['組立進捗率']),
        dismantle:   colOf(['解体進捗率']),
        todayWork:   colOf(['本日の作業進捗', '翌日作業内容']),
        issue:       colOf(['問題事項(午後)', '問題事項（午後）']),
        issueDetail: colOf(['問題の詳細']),
        images:      colOf(['ImagesJSON'])
      };
      if (I.date < 0) I.date = 0;
      if (I.site < 0) I.site = 4;
      if (I.reportType < 0) I.reportType = 9;

      var get = function(row, idx) { return idx >= 0 ? (row[idx] || '').toString().trim() : ''; };

      var data = allValues.slice(1);
      data.forEach(function(row) {
        var rowSite = normalizeSiteNameKey(row[I.site]); // 工事現場名
        if (rowSite !== normalizeSiteNameKey(siteName)) return;

        var reportType = get(row, I.reportType); // 報告種別
        if (reportType !== '終業前報告') return;

        var dateVal = formatDateISO(row[I.date]);
        if (!dateVal) return;

        // 安全チェック（ラベル名で列を解決）
        var safety = SAFETY_LABELS.map(function(label) {
          var ci = colOf([label]);
          return { label: label, value: ci >= 0 ? (row[ci] || '').toString() : '' };
        });

        // 写真JSON（ImagesJSON列を優先、無ければ `[{` で始まるセルを探索）
        var images = [];
        var imgJson = '';
        if (I.images >= 0) {
          var v = (row[I.images] || '').toString().trim();
          if (v.indexOf('[') === 0) imgJson = v;
        }
        if (!imgJson) {
          for (var ci2 = 0; ci2 < row.length; ci2++) {
            var vv = (row[ci2] || '').toString().trim();
            if (vv.indexOf('[{') === 0) { imgJson = vv; break; }
          }
        }
        if (imgJson) {
          try { images = JSON.parse(imgJson); } catch(e) {
            Logger.log('画像JSONパースエラー: ' + e.toString());
          }
        }

        reports.push({
          date: dateVal,
          reporter: get(row, I.reporter),
          workType: get(row, I.workType),
          assemblyPct: I.assembly >= 0 ? toPercent(row[I.assembly]) : 0,
          dismantlePct: I.dismantle >= 0 ? toPercent(row[I.dismantle]) : 0,
          todayWork: get(row, I.todayWork),
          issue: get(row, I.issue),
          issueDetail: get(row, I.issueDetail),
          images: images,
          safetyChecks: safety
        });
      });

      // 新しい順にソート
      reports.sort(function(a, b) { return b.date.localeCompare(a.date); });

    } catch(e) {
      Logger.log('getProgressDetails エラー: ' + e.toString());
    }
    return reports;
  }

  // =============================================
  //  ホワイトリスト用シートから表示対象の現場名を取得
  // =============================================
  function getVisibleSiteNames() {
    var ss = getSpreadsheet();
    var sheet = ss.getSheetByName(CONFIG.SITE_WHITELIST_SHEET_NAME);
    if (!sheet) return null; // シートが無い場合はフィルタなし（全件表示）

    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return {};

    // A列の現場名を取得（1行目はヘッダーなのでスキップ）
    var values = sheet.getRange(2, 1, lastRow, 1).getValues();
    var visibleSites = {};
    values.forEach(function(row) {
      var raw = (row[0] || '').toString().trim();
      if (!raw) return;
      visibleSites[raw] = true;
      var nk = normalizeSiteNameKey(raw);
      if (nk && nk !== raw) {
        visibleSites[nk] = true;
      }
    });
    return visibleSites;
  }

  // =============================================
  //  グルーピング・マージ処理
  // =============================================
  function groupSiteData(rows, scheduleMap) {
    var siteGroups = {};

    rows.forEach(function(row) {
      var groupKey = normalizeSiteNameKey(row['現場名']);
      if (!groupKey) return;

      var zoneKey = normalizeSiteNameKey(row['工区名']);

      if (!siteGroups[groupKey]) {
        siteGroups[groupKey] = { parent: null, children: {} };
      }

      if (zoneKey === '') {
        // 親行のデータをマージ
        if (!siteGroups[groupKey].parent) {
          siteGroups[groupKey].parent = row;
        } else {
          Object.keys(row).forEach(function(key) {
            if (row[key] !== '' && row[key] !== null && row[key] !== undefined) {
              siteGroups[groupKey].parent[key] = row[key];
            }
          });
        }
      } else {
        // 子行のデータをマージ
        if (!siteGroups[groupKey].children[zoneKey]) {
          siteGroups[groupKey].children[zoneKey] = row;
        } else {
          Object.keys(row).forEach(function(key) {
            if (row[key] !== '' && row[key] !== null && row[key] !== undefined) {
              siteGroups[groupKey].children[zoneKey][key] = row[key];
            }
          });
        }
      }
    });

    // 工期データをマージ + 日付をISO文字列に変換
    var sites = [];
    Object.keys(siteGroups).forEach(function(groupKey) {
      var group = siteGroups[groupKey];
      var parentData = group.parent || { '現場名': groupKey };
      var displaySiteName = (parentData['現場名'] || '').toString().trim() || groupKey;
      var schedule = resolveScheduleFromMap(scheduleMap, displaySiteName, groupKey);

      // 親の工期（稼働現場リスト優先 → 案件シートの予定日フォールバック）
      var assemblyStart  = pickDateISO(schedule.assemblyStart, parentData['組立開始予定日'], parentData['着工予定日']);
      var assemblyEnd    = pickDateISO(schedule.assemblyEnd, parentData['組立終了予定日']);
      var dismantleStart = pickDateISO(schedule.dismantleStart, parentData['解体開始予定日']);
      var dismantleEnd   = pickDateISO(schedule.dismantleEnd, parentData['解体終了予定日']);

      // ステータスアイコン
      var statusIcons = getStatusIcons(parentData);

      // 報告日ログ
      var reportLog = {};
      var logStr = parentData['全報告日ログ'];
      if (logStr) {
        try { reportLog = JSON.parse(logStr); } catch(e) { /* ignore */ }
      }
      // フォールバック: ログに無いフェーズは最終報告日ヘッダーから
      Object.keys(CONFIG.PHASE_DATE_HEADERS).forEach(function(phase) {
        if (!reportLog[phase] || reportLog[phase].length === 0) {
          var dateVal = parentData[CONFIG.PHASE_DATE_HEADERS[phase]];
          if (dateVal) {
            reportLog[phase] = [formatDateISO(dateVal)];
          }
        } else {
          // 既存のログ内の日付もISO化（文字列等で保存されている場合は配列に変換）
          var logEntries = Array.isArray(reportLog[phase]) ? reportLog[phase] : [reportLog[phase]];
          reportLog[phase] = logEntries.map(function(d) { return formatDateISO(d) || d; });
        }
      });

      var site = {
        name: displaySiteName,
        folderUrl: parentData['現場フォルダURL'] || '',
        statusIcons: statusIcons,
        phaseDetails: getPhaseDetails(parentData),
        schedule: {
          assemblyStart:  assemblyStart,
          assemblyEnd:    assemblyEnd,
          dismantleStart: dismantleStart,
          dismantleEnd:   dismantleEnd
        },
        actual: {
          assemblyStart:  formatDateISO(parentData['組立開始実績日']),
          assemblyEnd:    formatDateISO(parentData['組立終了実績日']),
          dismantleStart: formatDateISO(parentData['解体開始実績日']),
          dismantleEnd:   formatDateISO(parentData['解体終了実績日'])
        },
        milestones: {
          sendOut:       formatDateISO(parentData['送出教育予定日']),
          preEducation:  formatDateISO(parentData['解体前教育予定日'])
        },
        reportLog: reportLog,
        dateInfo: '組立: ' + (formatDateShort(assemblyStart) || '未定') + ' ~ ' + (formatDateShort(assemblyEnd) || '未定') + '\n' +
                  '解体: ' + (formatDateShort(dismantleStart) || '未定') + ' ~ ' + (formatDateShort(dismantleEnd) || '未定'),
        children: []
      };

      // 子行（工区）
      Object.keys(group.children).forEach(function(zoneKey) {
        var child = group.children[zoneKey];
        var childDisplayName = (child['工区名'] || '').toString().trim() || zoneKey;

        var childReportLog = {};
        var childLogStr = child['全報告日ログ'];
        if (childLogStr) {
          try { childReportLog = JSON.parse(childLogStr); } catch(e) { /* ignore */ }
        }
        Object.keys(CONFIG.PHASE_DATE_HEADERS).forEach(function(phase) {
          if (!childReportLog[phase] || childReportLog[phase].length === 0) {
            var dateVal = child[CONFIG.PHASE_DATE_HEADERS[phase]];
            if (dateVal) {
              childReportLog[phase] = [formatDateISO(dateVal)];
            }
          } else {
            var childLogEntries = Array.isArray(childReportLog[phase]) ? childReportLog[phase] : [childReportLog[phase]];
            childReportLog[phase] = childLogEntries.map(function(d) { return formatDateISO(d) || d; });
          }
        });

        site.children.push({
          name: childDisplayName,
          statusIcons: getStatusIcons(child),
          phaseDetails: getPhaseDetails(child),
          schedule: {
            assemblyStart:  formatDateISO(child['組立開始予定日']),
            assemblyEnd:    formatDateISO(child['組立終了予定日']),
            dismantleStart: formatDateISO(child['解体開始予定日']),
            dismantleEnd:   formatDateISO(child['解体終了予定日'])
          },
          actual: {
            assemblyStart:  formatDateISO(child['組立開始実績日']),
            assemblyEnd:    formatDateISO(child['組立終了実績日']),
            dismantleStart: formatDateISO(child['解体開始実績日']),
            dismantleEnd:   formatDateISO(child['解体終了実績日'])
          },
          reportLog: childReportLog,
          dateInfo: '組立: ' + (formatDateShort(child['組立開始予定日']) || '未定') + ' ~ ' + (formatDateShort(child['組立終了予定日']) || '未定') + '\n' +
                    '解体: ' + (formatDateShort(child['解体開始予定日']) || '未定') + ' ~ ' + (formatDateShort(child['解体終了予定日']) || '未定')
        });
      });

      sites.push(site);
    });

    return sites;
  }

  // =============================================
  //  ステータスアイコン生成
  // =============================================
  function getStatusIcons(row) {
    var icons = [];
    var slotCount = CONFIG.PHASE_SLOT_COUNT || 9;
    for (var phase = 1; phase <= slotCount; phase++) {
      var header = CONFIG.PHASE_DATE_HEADERS[phase];
      var defaultIcon = CONFIG.PHASE_ICONS[phase] || String(phase);
      var hasDate = header && row[header] !== '' && row[header] !== null && row[header] !== undefined;
      icons.push(hasDate ? '\u2705' : defaultIcon);
    }
    return icons.join(' ');
  }

  // =============================================
  //  フェーズ詳細情報（ポップアップ用）
  // =============================================
  function getPhaseDetails(row) {
    var details = {};
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var plannedHeaders = CONFIG.PHASE_PLANNED_DATE_HEADERS || {};

    Object.keys(CONFIG.PHASE_DATE_HEADERS).forEach(function(phase) {
      var dateVal = row[CONFIG.PHASE_DATE_HEADERS[phase]];
      var implementedIso = formatDateISO(dateVal);
      var plannedHeader = plannedHeaders[phase] || null;
      var plannedIso = plannedHeader ? formatDateISO(row[plannedHeader]) : null;

      var extras = [];
      var extraFields = CONFIG.PHASE_EXTRA_FIELDS[phase] || [];
      extraFields.forEach(function(field) {
        if (plannedHeader && field.header === plannedHeader) return;
        var val = row[field.header];
        if (val !== '' && val !== null && val !== undefined) {
          extras.push({
            label: field.label,
            value: field.isDate ? (formatDateISO(val) || val.toString()) : val.toString()
          });
        }
      });

      var detail = {
        name: CONFIG.PHASES[phase] || '',
        date: implementedIso,
        extras: extras
      };

      if (plannedHeader) {
        detail.plannedDate = plannedIso;
        detail.implementedDate = implementedIso;
        detail.plannedDateDisplay = plannedIso ? formatDateDisplay(plannedIso) : null;
        detail.implementedDateDisplay = implementedIso ? formatDateDisplay(implementedIso) : null;
        detail.status = computePhaseScheduleStatus(plannedIso, implementedIso, today);
      }

      details[phase] = detail;
    });
    return details;
  }

  // =============================================
  //  メインペイロード組み立て
  // =============================================
  function buildDashboardPayload() {
    var rows = readDatabaseSheet();
    var scheduleMap = getScheduleMap();
    var progressResult = getAllProgressData();
    var progressData = progressResult.map;
    var lastReportDates = progressResult.lastDates;
    var useWhitelist = CONFIG.USE_GANTT_SHEET_SITE_FILTER === true;
    var visibleSites = useWhitelist ? getVisibleSiteNames() : null;

    var sites = groupSiteData(rows, scheduleMap);

    // 最終報告日（終業前報告）を付与（進捗キーは正規化済みのため両方参照）
    sites.forEach(function(s) {
      var nk = normalizeSiteNameKey(s.name);
      var lr = lastReportDates[s.name] || lastReportDates[nk];
      if (lr) {
        s.lastReportDate = lr;
      }
    });

    // 祝日取得 (開始年〜開始年+2年)
    var holidays = getHolidays(CONFIG.TIMELINE_START_YEAR, CONFIG.TIMELINE_START_YEAR + 2);

    // オプション: SITE_WHITELIST_SHEET_NAME のA列の現場名のみ表示
    if (useWhitelist && visibleSites) {
      sites = sites.filter(function(site) {
        var nk = normalizeSiteNameKey(site.name);
        return visibleSites[site.name] === true || visibleSites[nk] === true;
      });
    }

    // 進捗マップのキーを画面表示名（DBの現場名）にも複製（職人ログとDBで表記が微妙に違う場合）
    var progressMerged = {};
    Object.keys(progressData).forEach(function(k) {
      progressMerged[k] = progressData[k];
    });
    sites.forEach(function(s) {
      var nk = normalizeSiteNameKey(s.name);
      if (nk && nk !== s.name && progressData[nk] && !progressMerged[s.name]) {
        progressMerged[s.name] = progressData[nk];
      }
      if (s.name && nk && s.name !== nk && progressData[s.name] && !progressMerged[nk]) {
        progressMerged[nk] = progressData[s.name];
      }
    });

    var buildingMerged = progressResult.buildingProgress || {};
    var bp = {};
    Object.keys(buildingMerged).forEach(function(k) {
      bp[k] = buildingMerged[k];
    });
    sites.forEach(function(s) {
      var nk = normalizeSiteNameKey(s.name);
      if (nk && nk !== s.name && buildingMerged[nk] && !bp[s.name]) {
        bp[s.name] = buildingMerged[nk];
      }
      if (s.name && nk && s.name !== nk && buildingMerged[s.name] && !bp[nk]) {
        bp[nk] = buildingMerged[s.name];
      }
    });

    return {
      sites: sites,
      progressData: progressMerged,
      buildingProgress: bp,
      timeline: {
        startDate: CONFIG.TIMELINE_START_YEAR + '-' +
                   ('0' + (CONFIG.TIMELINE_START_MONTH + 1)).slice(-2) + '-' +
                   ('0' + CONFIG.TIMELINE_START_DAY).slice(-2),
        days: CONFIG.TIMELINE_DAYS
      },
      config: {
        readOnlyMode: CONFIG.READ_ONLY_MODE === true,
        phaseColors: CONFIG.PHASE_COLORS,
        barColors: CONFIG.BAR_COLORS,
        actualBarColors: CONFIG.ACTUAL_BAR_COLORS,
        progressGradients: CONFIG.PROGRESS_GRADIENTS,
        phaseIcons: CONFIG.PHASE_ICONS,
        phases: CONFIG.PHASES,
        phaseSlotCount: CONFIG.PHASE_SLOT_COUNT || 9,
        alertPhaseSendOut: CONFIG.ALERT_PHASE_SEND_OUT || 4,
        alertPhasePreEducation: CONFIG.ALERT_PHASE_PRE_EDUCATION || 5,
        HOLIDAYS: (holidays && holidays.length > 0) ? holidays : (CONFIG.HOLIDAYS || []),
        correctionWebAppUrl: getCorrectionWebAppStatsUrl()
      }
    };
  }

  // =============================================
  //  工期更新
  // =============================================
  function updateSchedule(payload) {
    var updates = payload.updates || {};
    updateDatabaseRow(payload.siteName, payload.zoneName, updates);
    return true;
  }

  // =============================================
  //  案件シート行更新（汎用）
  // =============================================
  function updateDatabaseRow(siteName, zoneName, updates) {
    var ss = getSpreadsheet();
    var sheet = ss.getSheetByName(CONFIG.CASE_DATA_SHEET_NAME);
    if (!sheet) return;

    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return;

    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var siteCol = headers.indexOf('現場名');
    var zoneCol = headers.indexOf('工区名');
    if (siteCol === -1) return;

    var data = sheet.getRange(2, 1, lastRow, headers.length).getValues();

    for (var i = 0; i < data.length; i++) {
      var rowSite = normalizeSiteNameKey(data[i][siteCol]);
      var rowZone = zoneCol >= 0 ? normalizeSiteNameKey(data[i][zoneCol]) : '';

      if (rowSite === normalizeSiteNameKey(siteName) && rowZone === normalizeSiteNameKey(zoneName || '')) {
        Object.keys(updates).forEach(function(key) {
          var colIdx = headers.indexOf(key);
          if (colIdx >= 0) {
            sheet.getRange(i + 2, colIdx + 1).setValue(updates[key]);
          }
        });
        break;
      }
    }
  }

  // =============================================
  //  フェーズ別フォーム回答データ取得（モーダル表示用）
  // =============================================
  function getPhaseReportData(siteName, phaseNum) {
    var sheetName = CONFIG.PHASE_SHEET_NAMES[phaseNum];
    if (!sheetName) return { phaseName: '', headers: [], records: [] };

    var ss = getSpreadsheet();
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) return { phaseName: sheetName, headers: [], records: [] };

    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    if (lastRow < 2 || lastCol < 1) return { phaseName: sheetName, headers: [], records: [] };

    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function(h) {
      return (h || '').toString().trim();
    });

    // 現場名マッチング用の列候補を収集
    // 「現場」を含む列 ＋ C列(idx2)・D列(idx3) を候補に追加
    var siteColSet = {};
    headers.forEach(function(h, idx) {
      if (h.indexOf('現場') >= 0) siteColSet[idx] = true;
    });
    // C列・D列も必ず候補に含める（フォーム回答シートの「既存現場から入力」「新規現場を入力」対応）
    if (headers.length > 2) siteColSet[2] = true;
    if (headers.length > 3) siteColSet[3] = true;
    var siteCols = Object.keys(siteColSet).map(function(k) { return parseInt(k, 10); });
    if (siteCols.length === 0) return { phaseName: sheetName, headers: [], records: [] };

    // 写真・アップロード系カラムを除外するインデックスセット
    var skipKeywords = CONFIG.PHASE_SKIP_KEYWORDS || [];
    var skipCols = {};
    headers.forEach(function(h, idx) {
      skipKeywords.forEach(function(kw) {
        if (h.indexOf(kw) >= 0) skipCols[idx] = true;
      });
    });

    // 表示対象のヘッダーリスト
    var displayHeaders = [];
    var displayColIndices = [];
    headers.forEach(function(h, idx) {
      if (h && !skipCols[idx]) {
        displayHeaders.push(h);
        displayColIndices.push(idx);
      }
    });

    // データ行を読み取り、サイト名でフィルタ
    var data = sheet.getRange(2, 1, lastRow, lastCol).getValues();
    var records = [];

    data.forEach(function(row) {
      // いずれかの「現場」列が現場名と一致すればヒット
      var target = normalizeSiteNameKey(siteName);
      var matched = siteCols.some(function(colIdx) {
        var val = normalizeSiteNameKey(row[colIdx]);
        return val === target;
      });
      if (!matched) return;

      var record = {};
      displayColIndices.forEach(function(colIdx, i) {
        var val = row[colIdx];
        if (Object.prototype.toString.call(val) === '[object Date]' && !isNaN(val.getTime())) {
          // タイムスタンプ列は日時+曜日、それ以外の日付はISO形式
          var isTimestamp = displayHeaders[i].indexOf('タイムスタンプ') >= 0;
          record[displayHeaders[i]] = isTimestamp ? formatDateTimeFull(val) : formatDateISO(val);
        } else {
          record[displayHeaders[i]] = (val !== null && val !== undefined) ? val.toString() : '';
        }
      });
      records.push(record);
    });

    // タイムスタンプ列があれば新しい順にソート
    var tsHeader = displayHeaders[0];
    if (tsHeader && tsHeader.indexOf('タイムスタンプ') >= 0) {
      records.sort(function(a, b) {
        return (b[tsHeader] || '').localeCompare(a[tsHeader] || '');
      });
    }

    return {
      phaseName: sheetName,
      headers: displayHeaders,
      records: records
    };
  }

  // =============================================
  //  工程表ファイルID取得（Google Drive検索）
  // =============================================
  function getScheduleFileId(siteName) {
    try {
      var rootFolder = DriveApp.getFolderById(CONFIG.DRIVE_ROOT_FOLDER_ID);
      var siteFolders = rootFolder.getFoldersByName(siteName);
      if (!siteFolders.hasNext()) return null;

      var siteFolder = siteFolders.next();
      var scheduleFolders = siteFolder.getFoldersByName(CONFIG.SCHEDULE_SUBFOLDER_NAME);
      if (!scheduleFolders.hasNext()) return null;

      var scheduleFolder = scheduleFolders.next();
      var pdfFiles = scheduleFolder.getFilesByType(MimeType.PDF);
      if (!pdfFiles.hasNext()) return null;

      return pdfFiles.next().getId();
    } catch (e) {
      Logger.log('getScheduleFileId エラー (' + siteName + '): ' + e.toString());
      return null;
    }
  }

  /**
   * 【診断専用】指定現場が工期解決のどこで詰まっているか全段階を追跡する。
   * ロジックは buildDashboardPayload と同じ内部関数を使う（再現性を保証）。
   */
  function debugScheduleTrace(siteName) {
    var L = [];
    var targetNorm = normalizeSiteNameKey(siteName);
    L.push('入力現場名: "' + siteName + '"');
    L.push('入力 正規化後: "' + targetNorm + '"');
    L.push('');

    // ---- 1. データベースシート側 ----
    L.push('--- [1] データベースシート（現場行の供給元） ---');
    var rows = readDatabaseSheet();
    L.push('データベース総行数: ' + rows.length);
    var dbHits = rows.filter(function(r) {
      return normalizeSiteNameKey(r['現場名']) === targetNorm;
    });
    if (dbHits.length === 0) {
      L.push('★ データベースに一致行なし → この現場はダッシュボードに表示されません');
      var sample = rows.slice(0, 8).map(function(r){ return '"' + r['現場名'] + '"→"' + normalizeSiteNameKey(r['現場名']) + '"'; });
      L.push('  参考（先頭8件の 生→正規化）:');
      sample.forEach(function(s){ L.push('    ' + s); });
    } else {
      dbHits.forEach(function(r) {
        L.push('DB現場名: "' + r['現場名'] + '" 工区名: "' + r['工区名'] + '"');
        L.push('  正規化後: "' + normalizeSiteNameKey(r['現場名']) + '"');
        L.push('  DB組立開始予定日: ' + JSON.stringify(r['組立開始予定日']));
        L.push('  DB組立終了予定日: ' + JSON.stringify(r['組立終了予定日']));
        L.push('  DB解体開始予定日: ' + JSON.stringify(r['解体開始予定日']));
        L.push('  DB解体終了予定日: ' + JSON.stringify(r['解体終了予定日']));
      });
    }
    L.push('');

    // ---- 2. 稼働現場リスト → scheduleMap ----
    L.push('--- [2] 稼働現場リスト → scheduleMap ---');
    var scheduleMap = getScheduleMap();
    var mapKeys = Object.keys(scheduleMap);
    L.push('scheduleMap キー総数: ' + mapKeys.length);
    L.push('完全一致キー "' + targetNorm + '" は存在するか: ' + (scheduleMap[targetNorm] ? 'あり' : 'なし'));
    var normHits = mapKeys.filter(function(k){ return normalizeSiteNameKey(k) === targetNorm; });
    L.push('正規化一致するキー: ' + (normHits.length ? normHits.map(function(k){return '"'+k+'"';}).join(', ') : 'なし'));
    if (scheduleMap[targetNorm]) {
      L.push('scheduleMap["' + targetNorm + '"] = ' + JSON.stringify(scheduleMap[targetNorm]));
    }
    L.push('');

    // ---- 3. resolveScheduleFromMap の結果 ----
    L.push('--- [3] resolveScheduleFromMap 解決結果 ---');
    var displayName = dbHits.length ? (dbHits[0]['現場名'] || '').toString().trim() : siteName;
    var resolved = resolveScheduleFromMap(scheduleMap, displayName, targetNorm);
    L.push('解決に使った表示名: "' + displayName + '"');
    L.push('解決された schedule: ' + JSON.stringify(resolved));
    L.push('');

    // ---- 4. 最終 dateInfo ----
    L.push('--- [4] 最終的な工期表示（dateInfo） ---');
    var parentData = dbHits.length ? dbHits[0] : {};
    var aS = pickDateISO(resolved.assemblyStart, parentData['組立開始予定日'], parentData['着工予定日']);
    var aE = pickDateISO(resolved.assemblyEnd, parentData['組立終了予定日']);
    var dS = pickDateISO(resolved.dismantleStart, parentData['解体開始予定日']);
    var dE = pickDateISO(resolved.dismantleEnd, parentData['解体終了予定日']);
    var dateInfo = '組立: ' + (formatDateShort(aS) || '未定') + ' ~ ' + (formatDateShort(aE) || '未定') + '  /  ' +
                   '解体: ' + (formatDateShort(dS) || '未定') + ' ~ ' + (formatDateShort(dE) || '未定');
    L.push('組立開始(最終): ' + (aS || '(空)'));
    L.push('組立終了(最終): ' + (aE || '(空)'));
    L.push('解体開始(最終): ' + (dS || '(空)'));
    L.push('解体終了(最終): ' + (dE || '(空)'));
    L.push('dateInfo: ' + dateInfo);

    var out = L.join('\n');
    Logger.log(out);
    return out;
  }

  /**
   * 【診断専用】buildDashboardPayload() を実際に実行し、最終 payload の中に
   * 指定現場の dateInfo / schedule が入っているかを確認する。
   * これが入っていれば「サーバーは正しい→フロント/HTML/キャッシュ問題」が確定する。
   */
  function debugPayloadForSite(siteName) {
    var L = [];
    var targetNorm = normalizeSiteNameKey(siteName);
    var payload = buildDashboardPayload();
    L.push('payload.sites 件数: ' + payload.sites.length);
    var hit = null;
    for (var i = 0; i < payload.sites.length; i++) {
      if (normalizeSiteNameKey(payload.sites[i].name) === targetNorm) { hit = payload.sites[i]; break; }
    }
    if (!hit) {
      L.push('★ payload.sites に「' + siteName + '」が存在しない（表示対象外）');
      var names = payload.sites.slice(0, 10).map(function(s){ return '"' + s.name + '"'; });
      L.push('  先頭10件: ' + names.join(', '));
    } else {
      L.push('payload内 name: "' + hit.name + '"');
      L.push('payload内 dateInfo: ' + JSON.stringify(hit.dateInfo));
      L.push('payload内 schedule: ' + JSON.stringify(hit.schedule));
      L.push('payload内 children件数: ' + (hit.children ? hit.children.length : 0));
      L.push('（このdateInfoに日付があれば、サーバーは正しい＝原因はフロント/HTML/キャッシュ）');
    }
    var out = L.join('\n');
    Logger.log(out);
    return out;
  }

  // =============================================
  //  公開API
  // =============================================
  return {
    buildDashboardPayload: buildDashboardPayload,
    updateSchedule: updateSchedule,
    getProgressDetails: getProgressDetails,
    getPhaseReportData: getPhaseReportData,
    getScheduleFileId: getScheduleFileId,
    parseDate: parseDate,
    formatDateISO: formatDateISO,
    debugScheduleTrace: debugScheduleTrace,
    debugPayloadForSite: debugPayloadForSite,
    normalizeSiteNameKey: normalizeSiteNameKey
  };
})();

// =============================================
//  デバッグ関数（GASエディタから実行）
// =============================================
function debug_buildingProgress() {
  // AB/AC列を含む生データ確認
  console.log('=== ヘッダー + AB/AC列 確認 ===');
  try {
    var extSs = SpreadsheetApp.openById(CONFIG.PROGRESS_SOURCE_SPREADSHEET_ID);
    var extSheet = extSs.getSheetByName(CONFIG.PROGRESS_SOURCE_SHEET_NAME);
    var lastRow = extSheet.getLastRow();
    var lastCol = extSheet.getLastColumn();
    console.log('最終列: ' + lastCol);
    var headers = extSheet.getRange(1, 1, 1, Math.min(lastCol, 35)).getValues()[0];
    console.log('ヘッダー(全体): ');
    headers.forEach(function(h, i) {
      if (h) console.log('  idx' + i + ': ' + h);
    });
    var data = extSheet.getRange(2, 1, Math.min(lastRow, 10), Math.min(lastCol, 35)).getValues();
    data.forEach(function(row, i) {
      var reportType = (row[9] || '').toString().trim();
      if (reportType !== '終業前報告') return;
      var siteName = (row[4] || '').toString().trim();  // E: 工事現場名
      // idx27=AB, idx28=AC, idx29=AD
      var vals = [];
      for (var c = 25; c < Math.min(row.length, 35); c++) {
        vals.push('idx' + c + '=' + row[c]);
      }
      console.log('行' + (i+2) + ': ' + siteName + ' | ' + vals.join(' | '));
    });
  } catch(e) { console.log('エラー: ' + e.toString()); }
}
