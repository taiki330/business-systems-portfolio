// 定数はconfig.jsに一元管理。ここではエイリアスとして参照する。
var TEMP_FOLDER_IDS = CONFIG.TEMP_FOLDER_IDS;
var SITE_SUB_FOLDERS = CONFIG.SITE_SUB_FOLDERS;
var PHASE_TO_SUBFOLDER = getPhaseToSubFolderMap();
var FIELD_NEW_SITE = CONFIG.NEW_SITE_FIELD;
var FIELD_EXISTING_SITE = CONFIG.EXISTING_SITE_FIELD;

function organizeFilesOnSubmit(e) {
  var itemResponses = e.response.getItemResponses();

  // 変数の初期化
  var category = 'その他';
  var siteName = '現場名不明';
  var reporter = '担当者不明';
  var newSiteName = '';
  var isNewSite = false;
  var buildingName = '';
  var fileIds = [];

  var now = new Date();
  var yearMonth = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy年MM月');
  var day = Utilities.formatDate(now, Session.getScriptTimeZone(), 'dd日');

  // 回答内容を解析
  for (var i = 0; i < itemResponses.length; i++) {
    var itemResponse = itemResponses[i];
    var title = itemResponse.getItem().getTitle();
    var answer = itemResponse.getResponse();

    // 業務カテゴリ
    if (title === '実施する業務を選択してください') {
      category = answer;
    }
    // 提出者
    if (title === '提出者氏名') {
      reporter = answer;
    }
    // 現場名（汎用）
    if ((title.indexOf('現場名') !== -1 || title.indexOf('工事名称') !== -1) && answer) {
      siteName = answer;
    }
    // 新規現場の入力があれば新規と判定
    if (title === FIELD_NEW_SITE && answer) {
      isNewSite = true;
      newSiteName = answer;
    }
    // 棟名
    if (title === '棟名' && answer) {
      buildingName = answer;
    }
    // ファイルアップロード
    if (itemResponse.getItem().getType() == FormApp.ItemType.FILE_UPLOAD) {
      if (answer) {
        fileIds = fileIds.concat(answer);
      }
    }
  }

  // ファイルがなければ終了
  if (fileIds.length === 0) return;

  // ========================================
  // 新規現場 かつ 仮フォルダ対象のフェーズ
  // ========================================
  if (isNewSite && TEMP_FOLDER_IDS[category]) {
    var finalSiteName = newSiteName || siteName;
    var tempFolder = DriveApp.getFolderById(TEMP_FOLDER_IDS[category]);

    // 仮フォルダ配下に [現場名] フォルダを作成（既存なら取得）
    var siteFolder = getOrCreateFolder_(tempFolder, finalSiteName);

    // アップロードファイルを該当フェーズのサブフォルダ配下の日付フォルダに移動
    var phaseSubfolderName = PHASE_TO_SUBFOLDER[category];
    if (phaseSubfolderName) {
      var targetFolder = getOrCreateFolder_(siteFolder, phaseSubfolderName);
      var buildingFolder = resolveBuildingFolder_(targetFolder, buildingName);
      var dateFolder = createDateFolder_(buildingFolder);
      for (var j = 0; j < fileIds.length; j++) {
        var file = DriveApp.getFileById(fileIds[j]);
        file.moveTo(dateFolder);
      }
      // 日付フォルダURLを報告シートに書き込む
      writeFolderUrlToReportSheet(category, dateFolder.getUrl());
    }

    return;
  }

  // ========================================
  // 既存現場 または 仮フォルダ対象外のフェーズ
  // [現場名]/[フェーズフォルダ]/yyyy-MM-dd_HH-mm に統一
  // ========================================
  var phaseSubfolderName = PHASE_TO_SUBFOLDER[category];
  if (phaseSubfolderName) {
    var folderContext = DriveService.resolvePhaseFolder(siteName, 0, phaseSubfolderName);
    var buildingFolder = resolveBuildingFolder_(folderContext.targetFolder, buildingName);
    var dateFolder = createDateFolder_(buildingFolder);
    for (var j = 0; j < fileIds.length; j++) {
      var file = DriveApp.getFileById(fileIds[j]);
      file.moveTo(dateFolder);
    }

    // 日付フォルダURLを報告シートに書き込む
    writeFolderUrlToReportSheet(category, dateFolder.getUrl());
  }
}

// 棟名フォルダを解決する（スキップ対象ならparentFolderをそのまま返す）
var SKIP_BUILDING_VALUES_ = CONFIG.SKIP_BUILDING_VALUES;
function resolveBuildingFolder_(parentFolder, buildingName) {
  if (!buildingName) return parentFolder;
  var s = String(buildingName);
  s = s.replace(/[Ａ-Ｚａ-ｚ０-９]/g, function(ch) {
    return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0);
  });
  s = s.toUpperCase().trim();
  if (!s || SKIP_BUILDING_VALUES_.indexOf(s) !== -1) return parentFolder;
  return getOrCreateFolder_(parentFolder, s);
}

// 日付フォルダ（yyyy-MM-dd_HH-mm）を新規作成する
function createDateFolder_(parentFolder) {
  var now = new Date();
  var name = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd_HH-mm');
  return parentFolder.createFolder(name);
}

// フォルダがあれば取得、なければ作る（名前末尾に_をつけてDriveServiceと衝突回避）
function getOrCreateFolder_(parentFolder, folderName) {
  var folders = parentFolder.getFoldersByName(folderName);
  if (folders.hasNext()) {
    return folders.next();
  } else {
    return parentFolder.createFolder(folderName);
  }
}
