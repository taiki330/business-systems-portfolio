/**
 * 承認処理サービス
 * 職人進捗管理スプレッドシートの各ログシートに対して、報告（行）単位の承認フローを提供する
 */
var ApprovalService = (function() {

  // --- ヘッダー除外セット（質問列抽出時に使う） ---
  var BASE_HEADER_SET = null;
  var TAIL_HEADER_SET = null;
  var APPROVAL_HEADER_SET = null;

  /**
   * 除外ヘッダーセットを遅延初期化する
   * CONFIG が読み込まれた後に1回だけ構築する
   */
  function initHeaderSets() {
    if (BASE_HEADER_SET !== null) return;

    BASE_HEADER_SET = {};
    for (var i = 0; i < CONFIG.BASE_HEADERS.length; i++) {
      BASE_HEADER_SET[CONFIG.BASE_HEADERS[i]] = true;
    }

    TAIL_HEADER_SET = {};
    for (var j = 0; j < CONFIG.TAIL_HEADERS.length; j++) {
      TAIL_HEADER_SET[CONFIG.TAIL_HEADERS[j]] = true;
    }

    APPROVAL_HEADER_SET = {};
    var approvalKeys = Object.keys(CONFIG.APPROVAL_COLUMNS);
    for (var k = 0; k < approvalKeys.length; k++) {
      APPROVAL_HEADER_SET[CONFIG.APPROVAL_COLUMNS[approvalKeys[k]]] = true;
    }
  }

  // =================================================================
  // シート取得
  // =================================================================

  /**
   * 報告種別に対応するログシートをGIDで特定して返す
   * @param {string} reportType - 報告種別（例: '始業前報告'）
   * @return {Sheet} 対象シート
   */
  function getLogSheet(reportType) {
    var gid = CONFIG.LOG_SHEETS[reportType];
    if (gid === undefined || gid === null) {
      throw new Error('未定義の報告種別です: ' + reportType);
    }

    var ss = SpreadsheetApp.openById(CONFIG.SOURCE_SPREADSHEET_ID);
    var sheets = ss.getSheets();

    for (var i = 0; i < sheets.length; i++) {
      if (sheets[i].getSheetId() === gid) {
        return sheets[i];
      }
    }

    throw new Error('シートが見つかりません（GID: ' + gid + ', 報告種別: ' + reportType + '）');
  }

  // =================================================================
  // 承認列の自動付与
  // =================================================================

  /**
   * シートのヘッダーに承認列5つが存在するか確認し、なければ末尾に追加する
   * @param {Sheet} sheet - 対象シート
   * @param {string[]} headers - 現在のヘッダー配列
   * @return {string[]} 更新後のヘッダー配列
   */
  function ensureApprovalColumns(sheet, headers) {
    var approvalHeaders = [
      CONFIG.APPROVAL_COLUMNS.STATUS,
      CONFIG.APPROVAL_COLUMNS.APPROVER,
      CONFIG.APPROVAL_COLUMNS.APPROVED_AT,
      CONFIG.APPROVAL_COLUMNS.REJECT_COMMENT,
      CONFIG.APPROVAL_COLUMNS.REJECTED_IMAGES
    ];

    var missingHeaders = [];
    for (var i = 0; i < approvalHeaders.length; i++) {
      if (headers.indexOf(approvalHeaders[i]) === -1) {
        missingHeaders.push(approvalHeaders[i]);
      }
    }

    if (missingHeaders.length === 0) {
      return headers;
    }

    // 末尾に不足分を追加
    var startCol = headers.length + 1;
    for (var j = 0; j < missingHeaders.length; j++) {
      sheet.getRange(1, startCol + j).setValue(missingHeaders[j]);
    }

    // 更新後のヘッダーを返す
    return headers.concat(missingHeaders);
  }

  // =================================================================
  // ヘルパー: ヘッダー → 列インデックスマップ
  // =================================================================

  /**
   * ヘッダー配列から { ヘッダー名: 0-indexed } のマップを作る
   * @param {string[]} headers
   * @return {Object}
   */
  function buildColumnIndex(headers) {
    var colIndex = {};
    for (var i = 0; i < headers.length; i++) {
      colIndex[headers[i].toString().trim()] = i;
    }
    return colIndex;
  }

  // =================================================================
  // ヘルパー: 複合キーによる行番号特定
  // =================================================================

  /**
   * 複合キー（送信日時 + 報告者ID + 現場ID）からシート上の行番号を特定する
   * @param {Sheet} sheet - 対象シート
   * @param {Object} colIndex - ヘッダー名 → 0-indexed のマップ
   * @param {Object} reportKey - { submittedAt, reporterId, siteId }
   * @return {number} シート上の行番号（1-indexed）
   */
  function findRowByKey(sheet, colIndex, reportKey) {
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      throw new Error('該当する報告が見つかりません');
    }

    var submittedAtColIdx = colIndex['送信日時'];
    var reporterIdColIdx = colIndex['報告者ID'];
    var siteIdColIdx = colIndex['現場ID'];

    var currentLastCol = sheet.getLastColumn();
    var data = sheet.getRange(2, 1, lastRow - 1, currentLastCol).getValues();

    var targetSubmittedAt = (reportKey.submittedAt || '').toString();

    for (var i = 0; i < data.length; i++) {
      var rowSubmittedAt = formatDateValue(data[i][submittedAtColIdx]);
      var rowReporterId = (data[i][reporterIdColIdx] || '').toString().trim();
      var rowSiteId = (data[i][siteIdColIdx] || '').toString().trim();

      if (rowSubmittedAt === targetSubmittedAt &&
          rowReporterId === reportKey.reporterId &&
          rowSiteId === reportKey.siteId) {
        return i + 2;
      }
    }

    throw new Error('該当する報告が見つかりません（送信日時: ' + reportKey.submittedAt +
      ', 報告者ID: ' + reportKey.reporterId + ', 現場ID: ' + reportKey.siteId + '）');
  }

  // =================================================================
  // ヘルパー: 日付値を文字列に変換
  // =================================================================

  /**
   * Dateオブジェクトまたは文字列をISO文字列に正規化する
   * @param {*} value - 日付値
   * @return {string} ISO文字列、または空文字
   */
  function formatDateValue(value) {
    if (value instanceof Date) {
      return value.toISOString();
    }
    return (value || '').toString();
  }

  // =================================================================
  // ヘルパー: 画像名 → 対応する質問列インデックスの取得
  // =================================================================

  /**
   * 画像配列から対応する質問列の0-indexedインデックスを返す（重複なし）
   * 画像名「①KY用紙記入報告_1.jpg」→ ヘッダー「①KY用紙記入報告」に対応
   * @param {Array} images - [{id, name}, ...] 画像配列
   * @param {Object} colIndex - ヘッダー名 → 0-indexed のマップ
   * @return {number[]} 対応する列の0-indexedインデックス配列
   */
  function getQuestionColumnsFromImages(images, colIndex) {
    var seen = {};
    var result = [];
    for (var i = 0; i < images.length; i++) {
      var imgName = (images[i].name || '').toString();
      // 末尾の _N.拡張子 を除去してヘッダー名を抽出
      var questionHeader = imgName.replace(/_\d+\.[^.]+$/, '');
      if (questionHeader && !seen[questionHeader] && colIndex[questionHeader] !== undefined) {
        seen[questionHeader] = true;
        result.push(colIndex[questionHeader]);
      }
    }
    return result;
  }

  // =================================================================
  // ヘルパー: 画像名から質問ヘッダーを抽出
  // =================================================================

  /**
   * 画像名から質問ヘッダー部分を抽出する
   * 例: "①KY用紙記入報告_1.jpg" → "①KY用紙記入報告"
   * @param {string} imageName
   * @return {string} 質問ヘッダー（抽出できなければ空文字）
   */
  function extractQuestionHeader(imageName) {
    // 拡張子を除去してから末尾の _N を除去
    var withoutExt = imageName.replace(/\.[^.]+$/, '');
    return withoutExt.replace(/_\d+$/, '');
  }

  // =================================================================
  // ヘルパー: 差し戻し写真再送シートの読み込みと照合
  // =================================================================

  /**
   * 差し戻し写真再送シートのデータを1回だけ読み込んで返す
   * processResubmissions から呼び出し、複数行の照合で使い回す
   * @return {Object|null} 再送シートデータ（null = シートなし or データなし）
   */
  function loadResubmissionData() {
    var ss = SpreadsheetApp.openById(CONFIG.SOURCE_SPREADSHEET_ID);
    var resubSheet = ss.getSheetByName(CONFIG.RESUBMISSION_SHEET_NAME);
    if (!resubSheet) return null;

    var lastRow = resubSheet.getLastRow();
    var lastCol = resubSheet.getLastColumn();
    if (lastRow < 2 || lastCol < 1) return null;

    // ヘッダーを読んで列位置を動的に特定
    var resubHeaders = resubSheet.getRange(1, 1, 1, lastCol).getValues()[0]
      .map(function(h) { return h.toString().trim(); });
    var resubColIndex = {};
    for (var hi = 0; hi < resubHeaders.length; hi++) {
      resubColIndex[resubHeaders[hi]] = hi;
    }

    var colTimestamp = resubColIndex['タイムスタンプ'];
    var colSite = resubColIndex['現場名'];
    var colBuilding = resubColIndex['棟名'];
    var colCategory = resubColIndex['再送区分'];
    var colReporter = resubColIndex['報告者名'];

    if (colSite === undefined || colReporter === undefined || colCategory === undefined) {
      return null;
    }

    // 再送写真列を特定
    var photoCols = [];
    for (var pi = 0; pi < resubHeaders.length; pi++) {
      if (resubHeaders[pi].indexOf('再送写真') === 0) {
        photoCols.push(pi);
      }
    }
    if (photoCols.length === 0) return null;

    return {
      data: resubSheet.getRange(2, 1, lastRow - 1, lastCol).getValues(),
      colTimestamp: colTimestamp,
      colSite: colSite,
      colBuilding: colBuilding,
      colCategory: colCategory,
      colReporter: colReporter,
      photoCols: photoCols
    };
  }

  /**
   * 再送シートデータと照合し、再送済みの画像を判定する
   * @param {string} reportType - 報告種別
   * @param {string} siteName - 現場名
   * @param {string} buildingName - 棟名
   * @param {string} reporterName - 報告者名
   * @param {Array} rejectedImages - 差し戻し画像配列 [{id, name}, ...]
   * @param {string|Date} rejectionTimestamp - 差し戻し日時
   * @param {Object|null} resubData - loadResubmissionData() の戻り値（nullなら内部で読み込む）
   * @return {Object} { resubmitted: [...], remaining: [...] }
   */
  function checkResubmissions(reportType, siteName, buildingName, reporterName, rejectedImages, rejectionTimestamp, resubData) {
    var noMatch = { resubmitted: [], remaining: rejectedImages.slice() };

    // データが渡されなければ自分で読み込む（getReportDetail からの呼び出し用）
    if (!resubData) {
      resubData = loadResubmissionData();
    }
    if (!resubData) return noMatch;

    var data = resubData.data;
    var colTimestamp = resubData.colTimestamp;
    var colSite = resubData.colSite;
    var colBuilding = resubData.colBuilding;
    var colCategory = resubData.colCategory;
    var colReporter = resubData.colReporter;
    var photoCols = resubData.photoCols;

    // 差し戻し日時をDate型に変換（無効なら時間フィルタをスキップ）
    var rejectionDate = null;
    if (rejectionTimestamp instanceof Date && !isNaN(rejectionTimestamp.getTime())) {
      rejectionDate = rejectionTimestamp;
    } else if (rejectionTimestamp) {
      var parsed = new Date(rejectionTimestamp);
      if (!isNaN(parsed.getTime())) {
        rejectionDate = parsed;
      }
    }

    var resubmittedHeaders = {};

    for (var i = 0; i < data.length; i++) {
      var row = data[i];

      // キー照合
      var rowSite = (row[colSite] || '').toString().trim();
      var rowReporter = (row[colReporter] || '').toString().trim();
      var rowCategory = (row[colCategory] || '').toString().trim();

      // 再送区分（reportType）は照合対象から外す
      // フォームで誤った種別を選択しても、後段の写真名マッチングで誤判定を防げるため
      if (rowSite !== siteName || rowReporter !== reporterName) {
        continue;
      }

      // 棟名照合：再送シートが「該当なし」または空の場合はスキップ
      if (colBuilding !== undefined) {
        var rowBuilding = (row[colBuilding] || '').toString().trim();
        if (rowBuilding !== '' && rowBuilding !== '該当なし' && rowBuilding !== buildingName) {
          continue;
        }
      }

      // タイムスタンプ照合（差し戻し日時が有効な場合のみ）
      if (rejectionDate !== null && colTimestamp !== undefined) {
        var rowTimestamp = row[colTimestamp];
        var rowDate = (rowTimestamp instanceof Date) ? rowTimestamp : new Date(rowTimestamp);
        if (!isNaN(rowDate.getTime()) && rowDate <= rejectionDate) {
          continue;
        }
      }

      // 再送写真列から質問ヘッダーを抽出
      for (var pc = 0; pc < photoCols.length; pc++) {
        var colIdx = photoCols[pc];

        var photoText = (data[i][colIdx] || '').toString().trim();
        if (!photoText) continue;

        // URL形式の場合はスキップ（HYPERLINKのURL部分が来た場合）
        if (photoText.indexOf('http') === 0) continue;

        // 「再送_」プレフィックスを除去
        var baseName = photoText.replace(/^再送_/, '');
        var resubHeader = extractQuestionHeader(baseName);
        if (resubHeader) {
          resubmittedHeaders[resubHeader] = true;
        }
      }
    }

    // 照合結果の振り分け
    var resubmitted = [];
    var remaining = [];
    for (var rj = 0; rj < rejectedImages.length; rj++) {
      var imgHeader = extractQuestionHeader((rejectedImages[rj].name || '').toString());
      if (imgHeader && resubmittedHeaders[imgHeader]) {
        resubmitted.push(rejectedImages[rj]);
      } else {
        remaining.push(rejectedImages[rj]);
      }
    }

    return { resubmitted: resubmitted, remaining: remaining };
  }

  // =================================================================
  // 報告一覧
  // =================================================================

  /**
   * 指定報告種別の報告一覧を取得する
   * @param {string} approverName - 承認者名
   * @param {string} reportType - 報告種別
   * @return {Array} 報告一覧
   */
  function getReportList(approverName, reportType) {
    var sheet = getLogSheet(reportType);
    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();

    if (lastRow < 2 || lastCol < 1) return [];

    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0]
      .map(function(h) { return h.toString().trim(); });

    // 承認列を保証
    headers = ensureApprovalColumns(sheet, headers);

    var colIndex = buildColumnIndex(headers);

    // データ取得（承認列追加後の列数に合わせて再取得）
    var currentLastCol = sheet.getLastColumn();
    var data = sheet.getRange(2, 1, lastRow - 1, currentLastCol).getValues();

    // ImagesJSON列の位置
    var imagesColIdx = colIndex['ImagesJSON'];
    // 承認ステータス列の位置
    var statusColIdx = colIndex[CONFIG.APPROVAL_COLUMNS.STATUS];

    var reports = [];

    for (var i = 0; i < data.length; i++) {
      var row = data[i];
      var siteName = (row[colIndex['工事現場名']] || '').toString().trim();

      // 画像枚数の算出
      var imageCount = 0;
      if (imagesColIdx !== undefined) {
        var imagesRaw = (row[imagesColIdx] || '').toString().trim();
        if (imagesRaw !== '') {
          try {
            var parsed = JSON.parse(imagesRaw);
            if (Array.isArray(parsed)) {
              imageCount = parsed.length;
            }
          } catch (e) {
            // パース失敗は0件扱い
          }
        }
      }

      // 承認ステータス（空 = 未確認）
      var status = CONFIG.APPROVAL_STATUS.UNCHECKED;
      if (statusColIdx !== undefined) {
        var rawStatus = (row[statusColIdx] || '').toString().trim();
        if (rawStatus !== '') {
          status = rawStatus;
        }
      }

      reports.push({
        reportKey: {
          submittedAt: formatDateValue(row[colIndex['送信日時']]),
          reporterId: (row[colIndex['報告者ID']] || '').toString().trim(),
          siteId: (row[colIndex['現場ID']] || '').toString().trim()
        },
        siteName: siteName,
        reporterName: (row[colIndex['報告者名']] || '').toString().trim(),
        submittedAt: formatDateValue(row[colIndex['送信日時']]),
        reportType: reportType,
        status: status,
        imageCount: imageCount
      });
    }

    // 日付降順ソート（新しい報告が上）
    reports.sort(function(a, b) {
      var dateA = a.submittedAt || '';
      var dateB = b.submittedAt || '';
      if (dateA > dateB) return -1;
      if (dateA < dateB) return 1;
      return 0;
    });

    return reports;
  }

  // =================================================================
  // 報告詳細
  // =================================================================

  /**
   * 指定報告種別・行番号またはreportKeyの報告詳細を取得する
   * @param {string} reportType - 報告種別
   * @param {number|Object} reportKeyOrRow - シート上の行番号（1-indexed）または reportKey オブジェクト
   * @return {Object} 報告詳細
   */
  function getReportDetail(reportType, reportKeyOrRow) {
    initHeaderSets();

    var sheet = getLogSheet(reportType);
    var lastCol = sheet.getLastColumn();

    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0]
      .map(function(h) { return h.toString().trim(); });

    // 承認列を保証
    headers = ensureApprovalColumns(sheet, headers);

    var colIndex = buildColumnIndex(headers);

    // reportKey オブジェクトの場合は行番号を検索、数値ならそのまま使用
    var rowIndex;
    if (typeof reportKeyOrRow === 'object' && reportKeyOrRow !== null) {
      rowIndex = findRowByKey(sheet, colIndex, reportKeyOrRow);
    } else {
      rowIndex = reportKeyOrRow;
    }

    // 対象行のデータを取得
    var currentLastCol = sheet.getLastColumn();
    var rowData = sheet.getRange(rowIndex, 1, 1, currentLastCol).getValues()[0];

    var siteName = (rowData[colIndex['工事現場名']] || '').toString().trim();
    var buildingName = (rowData[colIndex['棟名']] || '').toString().trim();
    var reporterName = (rowData[colIndex['報告者名']] || '').toString().trim();

    // 承認ステータス（空 = 未確認）
    var statusColIdx = colIndex[CONFIG.APPROVAL_COLUMNS.STATUS];
    var rawStatus = (statusColIdx !== undefined) ? (rowData[statusColIdx] || '').toString().trim() : '';
    var status = (rawStatus !== '') ? rawStatus : CONFIG.APPROVAL_STATUS.UNCHECKED;

    // 承認者
    var approverColIdx = colIndex[CONFIG.APPROVAL_COLUMNS.APPROVER];
    var approver = (approverColIdx !== undefined) ? (rowData[approverColIdx] || '').toString().trim() : '';

    // 承認日時
    var approvedAtColIdx = colIndex[CONFIG.APPROVAL_COLUMNS.APPROVED_AT];
    var approvedAt = (approvedAtColIdx !== undefined) ? formatDateValue(rowData[approvedAtColIdx]) : '';

    // 差し戻しコメント
    var rejectCommentColIdx = colIndex[CONFIG.APPROVAL_COLUMNS.REJECT_COMMENT];
    var rejectComment = (rejectCommentColIdx !== undefined) ? (rowData[rejectCommentColIdx] || '').toString().trim() : '';

    // 差し戻し画像
    var rejectedImagesColIdx = colIndex[CONFIG.APPROVAL_COLUMNS.REJECTED_IMAGES];
    var rejectedImages = [];
    if (rejectedImagesColIdx !== undefined) {
      var rejectedImagesRaw = (rowData[rejectedImagesColIdx] || '').toString().trim();
      if (rejectedImagesRaw !== '') {
        try {
          var parsedRejected = JSON.parse(rejectedImagesRaw);
          if (Array.isArray(parsedRejected)) {
            rejectedImages = parsedRejected;
          }
        } catch (e) {
          // パース失敗は空配列
        }
      }
    }

    // 質問と回答のペア（ベース列・末尾列・承認列以外）
    var answers = [];
    for (var h = 0; h < headers.length; h++) {
      var headerName = headers[h];
      if (headerName === '') continue;
      if (BASE_HEADER_SET[headerName]) continue;
      if (TAIL_HEADER_SET[headerName]) continue;
      if (APPROVAL_HEADER_SET[headerName]) continue;

      answers.push({
        label: headerName,
        value: (rowData[h] !== undefined && rowData[h] !== null) ? rowData[h].toString() : ''
      });
    }

    // 画像情報のパース
    var images = [];
    var imagesColIdx = colIndex['ImagesJSON'];
    if (imagesColIdx !== undefined) {
      var imagesRaw = (rowData[imagesColIdx] || '').toString().trim();
      if (imagesRaw !== '') {
        try {
          var parsedImages = JSON.parse(imagesRaw);
          if (Array.isArray(parsedImages)) {
            images = parsedImages;
          }
        } catch (e) {
          // パース失敗は空配列のまま
        }
      }
    }

    // 差し戻し画像の再送チェック（差し戻し写真再送シートを参照）
    if (status === CONFIG.APPROVAL_STATUS.REJECTED && rejectedImages.length > 0) {
      var resubResult = checkResubmissions(
        reportType, siteName, buildingName, reporterName,
        rejectedImages, rowData[colIndex[CONFIG.APPROVAL_COLUMNS.APPROVED_AT]]
      );

      if (resubResult.resubmitted.length > 0) {
        // 再送された画像の質問列背景色をリセット
        var colsToReset = getQuestionColumnsFromImages(resubResult.resubmitted, colIndex);
        for (var ri = 0; ri < colsToReset.length; ri++) {
          sheet.getRange(rowIndex, colsToReset[ri] + 1).setBackground(null);
        }

        var rejImgCol = colIndex[CONFIG.APPROVAL_COLUMNS.REJECTED_IMAGES] + 1;
        if (resubResult.remaining.length > 0) {
          // 一部再送：差し戻し画像列を更新
          sheet.getRange(rowIndex, rejImgCol).setValue(JSON.stringify(resubResult.remaining));
          rejectedImages = resubResult.remaining;
        } else {
          // 全部再送：ステータスを未確認にリセット
          sheet.getRange(rowIndex, rejImgCol).setValue('');
          sheet.getRange(rowIndex, colIndex[CONFIG.APPROVAL_COLUMNS.STATUS] + 1).setValue(CONFIG.APPROVAL_STATUS.UNCHECKED);
          sheet.getRange(rowIndex, colIndex[CONFIG.APPROVAL_COLUMNS.REJECT_COMMENT] + 1).setValue('');
          rejectedImages = [];
          status = CONFIG.APPROVAL_STATUS.UNCHECKED;
          rejectComment = '';
        }
      }
    }

    // DriveFolderId
    var driveFolderIdColIdx = colIndex['DriveFolderId'];
    var driveFolderId = (driveFolderIdColIdx !== undefined) ? (rowData[driveFolderIdColIdx] || '').toString().trim() : '';

    // 承認履歴
    var history = getApprovalHistory(reportType, siteName);

    return {
      reportKey: {
        submittedAt: formatDateValue(rowData[colIndex['送信日時']]),
        reporterId: (rowData[colIndex['報告者ID']] || '').toString().trim(),
        siteId: (rowData[colIndex['現場ID']] || '').toString().trim()
      },
      siteName: siteName,
      reporterName: reporterName,
      submittedAt: formatDateValue(rowData[colIndex['送信日時']]),
      reportType: reportType,
      status: status,
      approver: approver,
      approvedAt: approvedAt,
      rejectComment: rejectComment,
      rejectedImages: rejectedImages,
      answers: answers,
      images: images,
      driveFolderId: driveFolderId,
      history: history
    };
  }

  // =================================================================
  // 承認処理
  // =================================================================

  /**
   * 指定報告を承認する
   * @param {string} reportType - 報告種別
   * @param {Object} reportKey - 複合キー { submittedAt, reporterId, siteId }
   * @param {string} approverName - 承認者名
   * @return {Object} 結果
   */
  function approveReport(reportType, reportKey, approverName) {
    var sheet = getLogSheet(reportType);
    var lastCol = sheet.getLastColumn();

    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0]
      .map(function(h) { return h.toString().trim(); });

    // 承認列を保証
    headers = ensureApprovalColumns(sheet, headers);

    var colIndex = buildColumnIndex(headers);

    // 複合キーから行番号を特定
    var rowIndex = findRowByKey(sheet, colIndex, reportKey);

    // 対象行から現場名・報告者名・送信日時を取得（履歴記録用）
    var currentLastCol = sheet.getLastColumn();
    var rowData = sheet.getRange(rowIndex, 1, 1, currentLastCol).getValues()[0];
    var siteName = (rowData[colIndex['工事現場名']] || '').toString().trim();
    var reporterName = (rowData[colIndex['報告者名']] || '').toString().trim();
    var submittedAt = formatDateValue(rowData[colIndex['送信日時']]);

    // 承認列を更新（0-indexed → 1-indexedの列番号に変換）
    var statusCol = colIndex[CONFIG.APPROVAL_COLUMNS.STATUS] + 1;
    var approverCol = colIndex[CONFIG.APPROVAL_COLUMNS.APPROVER] + 1;
    var approvedAtCol = colIndex[CONFIG.APPROVAL_COLUMNS.APPROVED_AT] + 1;
    var rejectCommentCol = colIndex[CONFIG.APPROVAL_COLUMNS.REJECT_COMMENT] + 1;

    sheet.getRange(rowIndex, statusCol).setValue(CONFIG.APPROVAL_STATUS.APPROVED);
    sheet.getRange(rowIndex, approverCol).setValue(approverName);
    sheet.getRange(rowIndex, approvedAtCol).setValue(new Date());
    sheet.getRange(rowIndex, rejectCommentCol).setValue('');

    // 差し戻し画像の質問列セル背景色をリセット
    var rejectedImagesColApprove = colIndex[CONFIG.APPROVAL_COLUMNS.REJECTED_IMAGES];
    if (rejectedImagesColApprove !== undefined) {
      var prevRejectedRaw = (rowData[rejectedImagesColApprove] || '').toString().trim();
      if (prevRejectedRaw !== '') {
        try {
          var prevRejected = JSON.parse(prevRejectedRaw);
          if (Array.isArray(prevRejected)) {
            var colsToReset = getQuestionColumnsFromImages(prevRejected, colIndex);
            for (var ri = 0; ri < colsToReset.length; ri++) {
              sheet.getRange(rowIndex, colsToReset[ri] + 1).setBackground(null);
            }
          }
        } catch (e) {
          // パース失敗は無視
        }
      }
      // 差し戻し画像列をクリア
      sheet.getRange(rowIndex, rejectedImagesColApprove + 1).setValue('');
    }

    // 承認履歴に記録
    appendApprovalHistory(
      reportType, siteName, reporterName, submittedAt,
      approverName, CONFIG.APPROVAL_STATUS.APPROVED, ''
    );

    return { success: true, message: siteName + ' の報告を確認済にしました' };
  }

  // =================================================================
  // 差し戻し処理
  // =================================================================

  /**
   * 指定報告を差し戻す（画像単位）
   * @param {string} reportType - 報告種別
   * @param {Object} reportKey - 複合キー { submittedAt, reporterId, siteId }
   * @param {string} approverName - 承認者名
   * @param {Array} rejectedImages - 差し戻し画像配列 [{id, name}, ...]
   * @return {Object} 結果
   */
  function rejectReport(reportType, reportKey, approverName, rejectedImages) {
    // 画像配列の必須チェック
    if (!rejectedImages || !Array.isArray(rejectedImages) || rejectedImages.length === 0) {
      return { success: false, message: '差し戻す画像を1枚以上選択してください' };
    }

    var sheet = getLogSheet(reportType);
    var lastCol = sheet.getLastColumn();

    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0]
      .map(function(h) { return h.toString().trim(); });

    // 承認列を保証
    headers = ensureApprovalColumns(sheet, headers);

    var colIndex = buildColumnIndex(headers);

    // 複合キーから行番号を特定
    var rowIndex = findRowByKey(sheet, colIndex, reportKey);

    // 対象行から現場名・報告者名・送信日時を取得（履歴記録用）
    var currentLastCol = sheet.getLastColumn();
    var rowData = sheet.getRange(rowIndex, 1, 1, currentLastCol).getValues()[0];
    var siteName = (rowData[colIndex['工事現場名']] || '').toString().trim();
    var reporterName = (rowData[colIndex['報告者名']] || '').toString().trim();
    var submittedAt = formatDateValue(rowData[colIndex['送信日時']]);

    // 承認列を更新（0-indexed → 1-indexedの列番号に変換）
    var statusCol = colIndex[CONFIG.APPROVAL_COLUMNS.STATUS] + 1;
    var approverCol = colIndex[CONFIG.APPROVAL_COLUMNS.APPROVER] + 1;
    var approvedAtCol = colIndex[CONFIG.APPROVAL_COLUMNS.APPROVED_AT] + 1;
    var rejectCommentCol = colIndex[CONFIG.APPROVAL_COLUMNS.REJECT_COMMENT] + 1;
    var rejectedImagesCol = colIndex[CONFIG.APPROVAL_COLUMNS.REJECTED_IMAGES] + 1;

    // 差し戻し画像名の一覧を自動生成（スプレッドシートでの視認性用）
    var imageNames = rejectedImages.map(function(img) { return img.name || img.id; });
    var autoComment = imageNames.join(', ') + ' を差し戻し';

    sheet.getRange(rowIndex, statusCol).setValue(CONFIG.APPROVAL_STATUS.REJECTED);
    sheet.getRange(rowIndex, approverCol).setValue(approverName);
    sheet.getRange(rowIndex, approvedAtCol).setValue(new Date());
    sheet.getRange(rowIndex, rejectCommentCol).setValue(autoComment);
    sheet.getRange(rowIndex, rejectedImagesCol).setValue(JSON.stringify(rejectedImages));

    // 差し戻し画像に対応する質問列のセル背景色を赤に変更
    var rejectedQuestionCols = getQuestionColumnsFromImages(rejectedImages, colIndex);
    for (var qi = 0; qi < rejectedQuestionCols.length; qi++) {
      sheet.getRange(rowIndex, rejectedQuestionCols[qi] + 1).setBackground('#ffcccc');
    }

    // 承認履歴に記録
    appendApprovalHistory(
      reportType, siteName, reporterName, submittedAt,
      approverName, CONFIG.APPROVAL_STATUS.REJECTED, autoComment
    );

    return { success: true, message: siteName + ' の画像 ' + rejectedImages.length + ' 枚を差し戻しました' };
  }

  // =================================================================
  // 承認履歴
  // =================================================================

  /**
   * 承認履歴シートに1行追加する
   * シートが無ければ作成してヘッダーを設定する
   * @param {string} reportType - 報告種別
   * @param {string} siteName - 現場名
   * @param {string} reporterName - 報告者名
   * @param {string} submittedAt - 送信日時
   * @param {string} operator - 操作者
   * @param {string} action - 操作内容（確認済 / 差し戻し）
   * @param {string} comment - コメント
   */
  function appendApprovalHistory(reportType, siteName, reporterName, submittedAt, operator, action, comment) {
    var ss = SpreadsheetApp.openById(CONFIG.SOURCE_SPREADSHEET_ID);
    var sheet = ss.getSheetByName(CONFIG.APPROVAL_HISTORY_SHEET_NAME);

    if (!sheet) {
      sheet = ss.insertSheet(CONFIG.APPROVAL_HISTORY_SHEET_NAME);
      sheet.appendRow(CONFIG.APPROVAL_HISTORY_HEADERS);
    }

    // ヘッダー順: ['操作日時', '報告種別', '現場名', '報告者名', '送信日時', '操作者', '操作内容', 'コメント']
    sheet.appendRow([
      new Date(),       // 操作日時
      reportType,       // 報告種別
      siteName,         // 現場名
      reporterName,     // 報告者名
      submittedAt,      // 送信日時
      operator,         // 操作者
      action,           // 操作内容
      comment           // コメント
    ]);
  }

  /**
   * 承認履歴を取得する（報告種別 + 現場名でフィルタ）
   * @param {string} reportType - 報告種別
   * @param {string} siteName - 現場名
   * @return {Array} 承認履歴の配列
   */
  function getApprovalHistory(reportType, siteName) {
    var ss = SpreadsheetApp.openById(CONFIG.SOURCE_SPREADSHEET_ID);
    var sheet = ss.getSheetByName(CONFIG.APPROVAL_HISTORY_SHEET_NAME);
    if (!sheet) return [];

    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];

    var headerCount = CONFIG.APPROVAL_HISTORY_HEADERS.length;
    var data = sheet.getRange(2, 1, lastRow - 1, headerCount).getValues();

    // ヘッダー: ['操作日時', '報告種別', '現場名', '報告者名', '送信日時', '操作者', '操作内容', 'コメント']
    var history = [];

    for (var i = 0; i < data.length; i++) {
      var rowReportType = (data[i][1] || '').toString().trim();
      var rowSiteName = (data[i][2] || '').toString().trim();

      if (rowReportType === reportType && rowSiteName === siteName) {
        history.push({
          timestamp: formatDateValue(data[i][0]),
          reportType: rowReportType,
          siteName: rowSiteName,
          reporterName: (data[i][3] || '').toString().trim(),
          submittedAt: (data[i][4] || '').toString(),
          operator: (data[i][5] || '').toString().trim(),
          action: (data[i][6] || '').toString().trim(),
          comment: (data[i][7] || '').toString().trim()
        });
      }
    }

    return history;
  }

  // =================================================================
  // 再送検知の一括処理（トリガーから呼び出される）
  // =================================================================

  /**
   * 全ログシートの差し戻し中の行をスキャンし、再送済み画像があれば
   * 赤背景クリア＋ステータスリセットを自動で行う
   * ステータス列を先行読み込みし、書き込み操作を分離して最適化
   */
  function processResubmissions() {
    initHeaderSets();

    // 再送シートのデータを1回だけ読み込む
    var resubData = loadResubmissionData();
    if (!resubData) return;

    // 個別行読み込みと全行読み込みを切り替える閾値
    var BATCH_THRESHOLD = 10;

    var reportTypes = CONFIG.REPORT_TYPES;
    for (var rt = 0; rt < reportTypes.length; rt++) {
      var reportType = reportTypes[rt];
      var sheet;
      try {
        sheet = getLogSheet(reportType);
      } catch (e) {
        continue;
      }

      var lastRow = sheet.getLastRow();
      var lastCol = sheet.getLastColumn();
      if (lastRow < 2 || lastCol < 1) continue;

      var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0]
        .map(function(h) { return h.toString().trim(); });
      headers = ensureApprovalColumns(sheet, headers);
      var colIndex = buildColumnIndex(headers);

      var statusColIdx = colIndex[CONFIG.APPROVAL_COLUMNS.STATUS];
      var rejectedImagesColIdx = colIndex[CONFIG.APPROVAL_COLUMNS.REJECTED_IMAGES];
      var approvedAtColIdx = colIndex[CONFIG.APPROVAL_COLUMNS.APPROVED_AT];
      if (statusColIdx === undefined || rejectedImagesColIdx === undefined) continue;

      var currentLastCol = sheet.getLastColumn();

      // A. ステータス列の先行読み込み（1列だけ）
      var statusColNum = statusColIdx + 1; // 1-indexed
      var statusValues = sheet.getRange(2, statusColNum, lastRow - 1, 1).getValues();

      // REJECTED 行のインデックスを収集（0-indexed, データ配列上のインデックス）
      var rejectedRowIndices = [];
      for (var si = 0; si < statusValues.length; si++) {
        var statusVal = (statusValues[si][0] || '').toString().trim();
        if (statusVal === CONFIG.APPROVAL_STATUS.REJECTED) {
          rejectedRowIndices.push(si);
        }
      }

      // REJECTED 行がなければスキップ
      if (rejectedRowIndices.length === 0) continue;

      // REJECTED 行数に応じてデータの読み込み方を切り替え
      var rowDataMap = {}; // dataIndex → rowData
      if (rejectedRowIndices.length <= BATCH_THRESHOLD) {
        // 個別行読み込み
        for (var ri = 0; ri < rejectedRowIndices.length; ri++) {
          var dataIdx = rejectedRowIndices[ri];
          var sheetRow = dataIdx + 2; // 1-indexed
          rowDataMap[dataIdx] = sheet.getRange(sheetRow, 1, 1, currentLastCol).getValues()[0];
        }
      } else {
        // 全行読み込み
        var allData = sheet.getRange(2, 1, lastRow - 1, currentLastCol).getValues();
        for (var ai = 0; ai < rejectedRowIndices.length; ai++) {
          rowDataMap[rejectedRowIndices[ai]] = allData[rejectedRowIndices[ai]];
        }
      }

      // フェーズ1: 読み込み + 再送チェック → 書き込み操作を蓄積
      var writeOps = [];

      for (var rj = 0; rj < rejectedRowIndices.length; rj++) {
        var idx = rejectedRowIndices[rj];
        var rowData = rowDataMap[idx];
        var rowIndex = idx + 2; // シート上の行番号（1-indexed）

        // 差し戻し画像のパース
        var rejectedImagesRaw = (rowData[rejectedImagesColIdx] || '').toString().trim();
        if (rejectedImagesRaw === '') continue;

        var rejectedImages;
        try {
          rejectedImages = JSON.parse(rejectedImagesRaw);
          if (!Array.isArray(rejectedImages) || rejectedImages.length === 0) continue;
        } catch (e) {
          continue;
        }

        var siteName = (rowData[colIndex['工事現場名']] || '').toString().trim();
        var buildingName = (rowData[colIndex['棟名']] || '').toString().trim();
        var reporterName = (rowData[colIndex['報告者名']] || '').toString().trim();
        var rejectionTimestamp = (approvedAtColIdx !== undefined) ? rowData[approvedAtColIdx] : null;

        // 事前読み込み済みの resubData を渡す（再送シートの再読み込みを回避）
        var resubResult = checkResubmissions(
          reportType, siteName, buildingName, reporterName,
          rejectedImages, rejectionTimestamp, resubData
        );

        if (resubResult.resubmitted.length === 0) continue;

        // 再送された画像の質問列背景色リセットを蓄積
        var colsToReset = getQuestionColumnsFromImages(resubResult.resubmitted, colIndex);
        for (var ci = 0; ci < colsToReset.length; ci++) {
          writeOps.push({ type: 'background', row: rowIndex, col: colsToReset[ci] + 1, value: null });
        }

        var rejImgCol = rejectedImagesColIdx + 1;
        if (resubResult.remaining.length > 0) {
          // 一部再送：差し戻し画像列を更新
          writeOps.push({ type: 'value', row: rowIndex, col: rejImgCol, value: JSON.stringify(resubResult.remaining) });
        } else {
          // 全部再送：ステータスを未確認にリセット
          writeOps.push({ type: 'value', row: rowIndex, col: rejImgCol, value: '' });
          writeOps.push({ type: 'value', row: rowIndex, col: statusColIdx + 1, value: CONFIG.APPROVAL_STATUS.UNCHECKED });
          writeOps.push({ type: 'value', row: rowIndex, col: colIndex[CONFIG.APPROVAL_COLUMNS.REJECT_COMMENT] + 1, value: '' });
        }
      }

      // フェーズ2: 蓄積した書き込み操作をまとめて実行
      for (var wi = 0; wi < writeOps.length; wi++) {
        var op = writeOps[wi];
        if (op.type === 'value') {
          sheet.getRange(op.row, op.col).setValue(op.value);
        } else if (op.type === 'background') {
          sheet.getRange(op.row, op.col).setBackground(op.value);
        }
      }
    }
  }

  // =================================================================
  // 公開API
  // =================================================================

  return {
    getLogSheet: getLogSheet,
    ensureApprovalColumns: ensureApprovalColumns,
    getReportList: getReportList,
    getReportDetail: getReportDetail,
    approveReport: approveReport,
    rejectReport: rejectReport,
    appendApprovalHistory: appendApprovalHistory,
    getApprovalHistory: getApprovalHistory,
    processResubmissions: processResubmissions
  };
})();
