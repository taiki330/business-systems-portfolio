/**
 * JobMedley用 サムネ案生成ツール
 * --------------------------------------------
 * 使い方:
 * 1) スプレッドシートに以下シートを作成 (列順は下記のとおり)
 *    - 求人マスター: 求人ID / 医院名 / 職種 / ターゲット / 仕事内容 / 働きやすさ / 教育制度 / 福利厚生 / 給与・待遇 / その他強み / NG表現
 *    - 画像案生成: 求人ID / 使用写真 / 訴求軸(プルダウン) / 雰囲気 / AI出力 / 案データ(JSON・F列/非表示推奨・手入力不要)
 *    - 求人文生成: 求人ID / 訴求軸(プルダウン) / 現在求人文(参考) / 補足 / AI出力 / 結果データ(JSON・F列/非表示推奨・手入力不要)
 *    - スカウト文生成: 求人ID / 候補者プロフィール / 候補者の気になった点 / 今回特に訴求したい内容 / AI出力 / 結果データ(JSON・F列/非表示推奨・手入力不要)
 *    - 写真マスター: 写真ID / 医院名 / 職種 / 写真内容 / 写真の印象 / 使えそうな訴求軸 / 注意点 / 画像URL
 *    - 効果記録: 保存日時 / 施策種別 / 求人ID / 医院名 / 職種 / 採用案番号 / 訴求軸 / 件名 / メインコピー / サブコピー / 本文 / デザイン指示 / メモ
 *      ※ 施策種別 = IMAGE(画像案) / JOB_TEXT(求人文) / SCOUT(スカウト文)
 *
 * 【Webアプリ化に向けた構成】
 *  - UIに依存しない「コア関数」を用意済み:
 *      generateThumbnailIdeasCore(jobId, input) / generateJobTextCore(jobId, input)
 *      generateScoutTextCore(jobId, profile, options) / saveEffectRecord(record)
 *  - GASメニュー用関数は上記コアを呼ぶだけ。将来 doGet/doPost や外部UIからも同じコアを再利用できる。
 * 2) スクリプトプロパティを設定（プロジェクト設定 → スクリプト プロパティ）
 *    - OPENAI_API_KEY … API自動生成に必須
 *    - GENERATED_IMAGE_FOLDER_ID … 任意（未設定時は初回画像保存で自動作成）
 *    - APP_MODE … 任意（既定 client）
 *    - ADMIN_EMAIL … 任意
 *    移行後は checkInstallStatus() で設定漏れを確認
 * 3) シートを開き直すと「サムネ案ツール」メニューが出る
 * 4) 「画像案生成」シートで対象行のセルを選択 → メニューから「選択行のAI案を生成」
 */

// ===== 設定 =====
const SHEET_NAMES = {
  CLINIC: '医院マスター',
  MASTER: '求人マスター',
  IDEA: '画像案生成',
  RECORD: '効果記録',
  JOB_TEXT: '求人文生成',
  PHOTO: '写真マスター',
  SCOUT: 'スカウト文生成'
};

// 医院マスターシートの列番号 (1始まり)
// 医院ID / 医院名 / エリア・最寄駅 / 住所 / 備考
const CLINIC_COL = {
  CLINIC_ID: 1,
  NAME: 2,
  AREA: 3,
  ADDRESS: 4,
  NOTE: 5
};

// 画像案生成シートの列番号 (1始まり)
// 6列目に生成した3案の構造化データ(JSON)を保持する（F列は非表示推奨・手入力不要）
const IDEA_COL = {
  JOB_ID: 1,
  PHOTO: 2,
  AXIS: 3,        // 訴求軸 (プルダウン選択)
  MOOD: 4,        // 雰囲気 (デザイン方向の参考)
  AI_OUTPUT: 5,
  IDEAS_JSON: 6
};

// 効果記録シートの列番号 (1始まり)
// 施策種別(IMAGE/JOB_TEXT/SCOUT)を持ち、画像案・求人文・スカウト文を1シートで履歴管理する
const RECORD_COL = {
  SAVED_AT: 1,    // 保存日時
  KIND: 2,        // 施策種別 IMAGE / JOB_TEXT / SCOUT
  JOB_ID: 3,      // 求人ID
  CLINIC: 4,      // 医院名
  POSITION: 5,    // 職種
  IDEA_NO: 6,     // 採用案番号
  AXIS: 7,        // 訴求軸
  SUBJECT: 8,     // 件名 (スカウト等)
  MAIN_COPY: 9,   // メインコピー
  SUB_COPY: 10,   // サブコピー
  BODY: 11,       // 本文 (求人文・スカウト本文)
  CANVA: 12,      // デザイン指示（画像案のdesign_instruction / 【画像生成】フラグ）
  MEMO: 13        // メモ (色味/配置/狙い 等の補足)
};

// 求人マスターシートの列番号 (1始まり)
// 求人ID / 医院名 / 職種 / ターゲット / 仕事内容 / 働きやすさ / 教育制度 / 福利厚生 / 給与・待遇 / その他強み / NG表現
const MASTER_COL = {
  JOB_ID: 1,
  CLINIC: 2,
  POSITION: 3,
  TARGET: 4,
  JOB_CONTENT: 5,   // 仕事内容 (予防歯科・患者担当制・業務内容 など)
  WORK_STYLE: 6,    // 働きやすさ (勤務時間・休日・有給 など)
  EDUCATION: 7,     // 教育制度 (研修・マニュアル・資格支援 など)
  BENEFITS: 8,      // 福利厚生 (協会けんぽ・住宅手当・引越し補助 など)
  SALARY: 9,        // 給与・待遇
  OTHER: 10,        // その他強み (立地・通勤 など)
  NG: 11,           // NG表現
  CLINIC_ID: 12     // 医院ID (医院マスターへのFK・任意。空欄なら医院名で従来動作)
};

// 求人マスターのカテゴリ列 (表示順・キー名/ラベル)
const MASTER_STRENGTH_FIELDS = [
  { key: 'jobContent', label: '仕事内容' },
  { key: 'workStyle', label: '働きやすさ' },
  { key: 'education', label: '教育制度' },
  { key: 'benefits', label: '福利厚生' },
  { key: 'salary', label: '給与・待遇' },
  { key: 'otherStrength', label: 'その他の強み' }
];

// 訴求軸 → 最優先で参照する求人マスターのカテゴリ(ラベル)
const AXIS_PRIMARY_FIELD = {
  '働きやすさ': '働きやすさ',
  '休日・有給': '働きやすさ',
  '教育制度': '教育制度',
  '予防歯科': '仕事内容',
  '患者担当制': '仕事内容',
  '福利厚生': '福利厚生',
  '給与・待遇': '給与・待遇',
  '通勤・立地': 'その他の強み',
  'その他': ''
};

// 求人マスターの基本情報+カテゴリ別の強みを行配列で返す (プロンプト共通)
function masterInfoLines_(master) {
  const lines = [
    `- 医院名: ${master.clinic}`,
    `- 職種: ${master.position}`,
    `- ターゲット: ${master.target}`
  ];
  MASTER_STRENGTH_FIELDS.forEach(function (f) {
    lines.push(`- ${f.label}: ${master[f.key] || '(指定なし)'}`);
  });
  lines.push(`- NG表現: ${master.ng || '(指定なし)'}`);
  return lines;
}

// 訴求軸に応じた「最優先で参照するカテゴリ」の指示文を返す
function axisPriorityNote_(axis) {
  const field = AXIS_PRIMARY_FIELD[axis];
  if (field) {
    return `- 訴求軸「${axis}」では、求人マスターの「${field}」を最優先で主役にする。情報が不足する場合のみ他カテゴリを補足利用する。`;
  }
  return '- 訴求軸の指定が無い場合は、ターゲットに最も刺さるカテゴリを選んで主役にし、他カテゴリは補足利用する。';
}

// 求人文生成シートの列番号 (1始まり)
// 6列目に生成結果(JSON)を保持する（F列は非表示推奨・手入力不要・採用保存で参照）
const JOB_TEXT_COL = {
  JOB_ID: 1,
  AXIS: 2,          // 訴求軸 (プルダウン選択)
  CURRENT_TEXT: 3,  // 現在求人文 (参考情報)
  NOTE: 4,          // 補足
  AI_OUTPUT: 5,
  RESULT_JSON: 6
};

// 求人文生成「訴求軸」プルダウンの選択肢
const JOB_AXIS_OPTIONS = [
  '働きやすさ', '教育制度', '予防歯科', '患者担当制',
  '福利厚生', '休日・有給', '給与・待遇', '通勤・立地', 'その他'
];

// 訴求軸ごとに「優先して使う強みの方向性」をAIへ伝えるヒント
// ※ ヒントは「優先して拾う強みの方向性」を示すもの。マスターに無い項目を創作する根拠ではない。
const JOB_AXIS_PRIORITY_HINT = {
  '働きやすさ': '平日18:00終了、土曜17:00終了、年間休日、有給取得率',
  '教育制度': 'マンツーマン研修、教育体制、研修制度、未経験歓迎、スキルアップ支援',
  '予防歯科': '予防歯科への注力、患者担当制(マスターに記載がある範囲のみ)',
  '患者担当制': '患者担当制、継続して同じ患者に関われる体制、予防歯科(マスターに記載がある範囲のみ)',
  '福利厚生': '社会保険(協会けんぽ等)、住宅手当、引越し補助、各種手当',
  '休日・有給': '年間休日、有給取得率、土日休み、長期休暇',
  '給与・待遇': '給与水準、昇給・賞与、各種手当',
  '通勤・立地': '駅近、通勤アクセス、車通勤可、駐車場',
  'その他': '求人マスターの強み全般から、ターゲットに最も刺さるものを選ぶ'
};

// 訴求軸ごとの「3案の切り口(差別化)」。同じ軸を二重に使わないよう案ごとに役割を変える。
// ※ 追加要素は求人マスターに存在する強みに限る。根拠が無ければ訴求軸内で別の見せ方に変える。
const JOB_AXIS_DIFF = {
  '働きやすさ': ['働きやすさ特化', '働きやすさ + 福利厚生', '働きやすさ + 成長環境'],
  '教育制度': ['教育制度特化', '教育制度 + 働きやすさ', '教育制度 + 予防歯科・患者担当制'],
  '予防歯科': ['予防歯科特化', '予防歯科 + 働きやすさ', '予防歯科 + 成長環境'],
  '患者担当制': ['患者担当制特化', '患者担当制 + 働きやすさ', '患者担当制 + 成長環境'],
  '福利厚生': ['福利厚生特化', '福利厚生 + 働きやすさ', '福利厚生 + 成長環境'],
  '休日・有給': ['休日・有給特化', '休日・有給 + 福利厚生', '休日・有給 + 成長環境'],
  '給与・待遇': ['給与・待遇特化', '給与・待遇 + 働きやすさ', '給与・待遇 + 成長環境'],
  '通勤・立地': ['通勤・立地特化', '通勤・立地 + 働きやすさ', '通勤・立地 + 成長環境'],
  'その他': ['訴求軸を最も強く出す', '訴求軸 + 働きやすさ', '訴求軸 + 成長環境']
};

// 訴求軸に応じた3案の切り口配列を返す (未指定/未定義は「その他」を使う)
function jobAxisDiff_(axis) {
  return JOB_AXIS_DIFF[axis] || JOB_AXIS_DIFF['その他'];
}

// 写真マスターシートの列番号 (1始まり)
// 写真ID / 医院名 / 職種 / 写真内容 / 写真の印象 / 使えそうな訴求軸 / 注意点 / 画像URL / 医院ID / 使用可否
const PHOTO_COL = {
  PHOTO_ID: 1,
  CLINIC: 2,
  POSITION: 3,
  CONTENT: 4,
  IMPRESSION: 5,
  APPEAL: 6,
  NOTE: 7,
  IMAGE_URL: 8,
  CLINIC_ID: 9,   // 医院ID (医院マスターへのFK・任意)
  USABLE: 10      // 使用可否 (空欄/TRUE=使用可, FALSE=使用不可)
};

// マスター系シートはヘッダー名を優先して列を特定する。
// 既存シートでヘッダーが見つからない場合だけ、従来の固定列番号へフォールバックする。
const CLINIC_HEADERS_ = {
  CLINIC_ID: '医院ID', NAME: '医院名', AREA: 'エリア・最寄駅', ADDRESS: '住所', NOTE: '備考'
};
const MASTER_HEADERS_ = {
  JOB_ID: '求人ID', CLINIC: '医院名', POSITION: '職種', TARGET: 'ターゲット',
  JOB_CONTENT: '仕事内容', WORK_STYLE: '働きやすさ', EDUCATION: '教育制度',
  BENEFITS: '福利厚生', SALARY: '給与・待遇', OTHER: 'その他強み', NG: 'NG表現', CLINIC_ID: '医院ID'
};
const PHOTO_HEADERS_ = {
  PHOTO_ID: '写真ID', CLINIC: '医院名', POSITION: '職種', CONTENT: '写真内容',
  IMPRESSION: '写真の印象', APPEAL: '使えそうな訴求軸', NOTE: '注意点',
  IMAGE_URL: '画像URL', CLINIC_ID: '医院ID', USABLE: '使用可否'
};

// スカウト文生成シートの列番号 (1始まり)
// 6列目に生成結果(JSON)を保持する（F列は非表示推奨・手入力不要・採用保存で参照）
const SCOUT_COL = {
  JOB_ID: 1,
  CANDIDATE_PROFILE: 2,
  CANDIDATE_POINT: 3,
  APPEAL: 4,
  AI_OUTPUT: 5,
  RESULT_JSON: 6
};

const OPENAI_MODEL = 'gpt-4o-mini';
const OPENAI_IMAGE_MODEL = 'gpt-image-1';
const OPENAI_IMAGE_SIZE = '1024x1024';
const OPENAI_VISION_MODEL = 'gpt-4.1-mini';
const GENERATED_IMAGE_FOLDER_NAME = 'JobMedley_生成画像';

// スクリプトプロパティキー（移行・納品時はここを参照）
const SCRIPT_PROP = {
  OPENAI_API_KEY: 'OPENAI_API_KEY',
  GENERATED_IMAGE_FOLDER_ID: 'GENERATED_IMAGE_FOLDER_ID',
  APP_MODE: 'APP_MODE',
  ADMIN_EMAIL: 'ADMIN_EMAIL'
};

// ===== スクリプトプロパティ・設定一元管理 =====
function getScriptProperty_(key) {
  return String(PropertiesService.getScriptProperties().getProperty(key) || '').trim();
}

function setScriptProperty_(key, value) {
  PropertiesService.getScriptProperties().setProperty(key, String(value || ''));
}

function requireScriptProperty_(key, userMessage) {
  const val = getScriptProperty_(key);
  if (!val) {
    throw new Error(userMessage || ('スクリプトプロパティ「' + key + '」が未設定です。'));
  }
  return val;
}

function getAppConfig_() {
  return {
    openaiApiKey: getScriptProperty_(SCRIPT_PROP.OPENAI_API_KEY),
    generatedImageFolderId: getScriptProperty_(SCRIPT_PROP.GENERATED_IMAGE_FOLDER_ID),
    appMode: getScriptProperty_(SCRIPT_PROP.APP_MODE) || 'client',
    adminEmail: getScriptProperty_(SCRIPT_PROP.ADMIN_EMAIL)
  };
}


// ===== ヘッダー名参照・ID自動採番 =====
function resolveColumnsByHeader_(sheet, headerNames, fallbackColumns) {
  const lastColumn = Math.max(sheet.getLastColumn(), 1);
  const headers = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0]
    .map(function (value) { return String(value || '').trim(); });
  const columns = {};
  Object.keys(headerNames).forEach(function (key) {
    const found = headers.indexOf(headerNames[key]);
    columns[key] = found >= 0 ? found + 1 : fallbackColumns[key];
  });
  return columns;
}

function getClinicColumns_(sheet) {
  return resolveColumnsByHeader_(sheet, CLINIC_HEADERS_, CLINIC_COL);
}

function getMasterColumns_(sheet) {
  return resolveColumnsByHeader_(sheet, MASTER_HEADERS_, MASTER_COL);
}

function getPhotoColumns_(sheet) {
  return resolveColumnsByHeader_(sheet, PHOTO_HEADERS_, PHOTO_COL);
}

function getNextSequentialIdNumber_(sheet, idColumn, prefix) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 1;
  const values = sheet.getRange(2, idColumn, lastRow - 1, 1).getDisplayValues();
  const pattern = new RegExp('^' + prefix + '(\\d+)$', 'i');
  let maxNumber = 0;
  values.forEach(function (row) {
    const match = String(row[0] || '').trim().match(pattern);
    if (match) maxNumber = Math.max(maxNumber, Number(match[1]) || 0);
  });
  return maxNumber + 1;
}

function formatSequentialId_(prefix, number, width) {
  return prefix + String(number).padStart(width, '0');
}

function assignClinicIds_(sheet, firstRow, lastRow) {
  if (!sheet || lastRow < firstRow || lastRow < 2) return 0;
  const columns = getClinicColumns_(sheet);
  let nextNumber = getNextSequentialIdNumber_(sheet, columns.CLINIC_ID, 'CLINIC');
  let assigned = 0;
  for (let row = Math.max(firstRow, 2); row <= lastRow; row++) {
    const id = String(sheet.getRange(row, columns.CLINIC_ID).getDisplayValue() || '').trim();
    const name = String(sheet.getRange(row, columns.NAME).getDisplayValue() || '').trim();
    if (!id && name) {
      sheet.getRange(row, columns.CLINIC_ID).setValue(formatSequentialId_('CLINIC', nextNumber++, 3));
      assigned++;
    }
  }
  return assigned;
}

function assignPhotoIds_(sheet, firstRow, lastRow) {
  if (!sheet || lastRow < firstRow || lastRow < 2) return 0;
  const columns = getPhotoColumns_(sheet);
  let nextNumber = getNextSequentialIdNumber_(sheet, columns.PHOTO_ID, 'PHOTO');
  let assigned = 0;
  for (let row = Math.max(firstRow, 2); row <= lastRow; row++) {
    const id = String(sheet.getRange(row, columns.PHOTO_ID).getDisplayValue() || '').trim();
    const clinic = String(sheet.getRange(row, columns.CLINIC).getDisplayValue() || '').trim();
    const content = String(sheet.getRange(row, columns.CONTENT).getDisplayValue() || '').trim();
    const imageUrl = String(sheet.getRange(row, columns.IMAGE_URL).getDisplayValue() || '').trim();
    if (!id && (clinic || content || imageUrl)) {
      sheet.getRange(row, columns.PHOTO_ID).setValue(formatSequentialId_('PHOTO', nextNumber++, 3));
      assigned++;
    }
  }
  return assigned;
}

function buildClinicNameIdMap_(ss) {
  const sheet = ss.getSheetByName(SHEET_NAMES.CLINIC);
  if (!sheet || sheet.getLastRow() < 2) return {};
  const columns = getClinicColumns_(sheet);
  const values = sheet.getDataRange().getDisplayValues();
  const map = {};
  const duplicates = {};
  for (let i = 1; i < values.length; i++) {
    const name = String(values[i][columns.NAME - 1] || '').trim();
    const id = String(values[i][columns.CLINIC_ID - 1] || '').trim();
    if (!name || !id) continue;
    if (map[name] && map[name] !== id) duplicates[name] = true;
    else map[name] = id;
  }
  Object.keys(duplicates).forEach(function (name) { delete map[name]; });
  return map;
}

function syncClinicIdsByName_(ss, sheet, firstRow, lastRow, columns) {
  if (!sheet || lastRow < firstRow || lastRow < 2) return 0;
  const clinicMap = buildClinicNameIdMap_(ss);
  let synced = 0;
  for (let row = Math.max(firstRow, 2); row <= lastRow; row++) {
    const currentId = String(sheet.getRange(row, columns.CLINIC_ID).getDisplayValue() || '').trim();
    const clinicName = String(sheet.getRange(row, columns.CLINIC).getDisplayValue() || '').trim();
    if (!currentId && clinicName && clinicMap[clinicName]) {
      sheet.getRange(row, columns.CLINIC_ID).setValue(clinicMap[clinicName]);
      synced++;
    }
  }
  return synced;
}

// 手入力・複数行貼り付けのどちらでも、空欄のIDだけを補完する。
// 既に設定されたIDは名称変更や並べ替えでも上書きしない。
function onEdit(e) {
  if (!e || !e.range) return;
  const sheet = e.range.getSheet();
  const ss = e.source || sheet.getParent();
  const firstRow = e.range.getRow();
  const lastRow = e.range.getLastRow();
  if (lastRow < 2) return;

  if (sheet.getName() === SHEET_NAMES.CLINIC) {
    assignClinicIds_(sheet, firstRow, lastRow);
  } else if (sheet.getName() === SHEET_NAMES.MASTER) {
    syncClinicIdsByName_(ss, sheet, firstRow, lastRow, getMasterColumns_(sheet));
  } else if (sheet.getName() === SHEET_NAMES.PHOTO) {
    assignPhotoIds_(sheet, firstRow, lastRow);
    syncClinicIdsByName_(ss, sheet, firstRow, lastRow, getPhotoColumns_(sheet));
  }
}

// 既存行をまとめて整備するメニュー用処理。
function assignAndSyncMasterIds() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ui = SpreadsheetApp.getUi();
  const clinicSheet = ss.getSheetByName(SHEET_NAMES.CLINIC);
  const masterSheet = ss.getSheetByName(SHEET_NAMES.MASTER);
  const photoSheet = ss.getSheetByName(SHEET_NAMES.PHOTO);

  const clinicAssigned = clinicSheet ? assignClinicIds_(clinicSheet, 2, clinicSheet.getLastRow()) : 0;
  const photoAssigned = photoSheet ? assignPhotoIds_(photoSheet, 2, photoSheet.getLastRow()) : 0;
  const masterSynced = masterSheet
    ? syncClinicIdsByName_(ss, masterSheet, 2, masterSheet.getLastRow(), getMasterColumns_(masterSheet)) : 0;
  const photoSynced = photoSheet
    ? syncClinicIdsByName_(ss, photoSheet, 2, photoSheet.getLastRow(), getPhotoColumns_(photoSheet)) : 0;

  ui.alert([
    'ID整備が完了しました。',
    '医院IDの新規採番: ' + clinicAssigned + '件',
    '写真IDの新規採番: ' + photoAssigned + '件',
    '求人マスターの医院ID同期: ' + masterSynced + '件',
    '写真マスターの医院ID同期: ' + photoSynced + '件',
    '',
    '求人IDは外部システムのIDを優先するため、自動採番していません。'
  ].join('\n'));
}


// ===== メニュー =====
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('サムネ案ツール')
    .addSubMenu(ui.createMenu('画像案')
      .addItem('選択行のAI案を生成（3案）', 'generateThumbnailIdeas')
      .addItem('案1を採用（効果記録へ保存）', 'adoptIdea1')
      .addItem('案2を採用（効果記録へ保存）', 'adoptIdea2')
      .addItem('案3を採用（効果記録へ保存）', 'adoptIdea3'))
    .addSubMenu(ui.createMenu('求人文')
      .addItem('選択行の求人文を生成（3案：タイトル+本文）', 'generateJobText')
      .addItem('求人案1を採用（効果記録へ保存）', 'adoptJobText1')
      .addItem('求人案2を採用（効果記録へ保存）', 'adoptJobText2')
      .addItem('求人案3を採用（効果記録へ保存）', 'adoptJobText3'))
    .addSubMenu(ui.createMenu('スカウト文')
      .addItem('選択行のスカウト文を生成（1案）', 'generateScoutText')
      .addItem('スカウト文JSONを整形表示', 'formatScoutJsonInCell')
      .addItem('スカウト文を採用（効果記録へ保存）', 'adoptScoutText'))
    .addSeparator()
    .addSubMenu(ui.createMenu('プロンプト出力（API未接続用）')
      .addItem('選択行の画像案プロンプトを生成', 'generateThumbnailPrompt')
      .addItem('選択行の求人文プロンプトを生成', 'generateJobTextPrompt')
      .addItem('選択行のスカウト文プロンプトを生成', 'generateScoutPrompt'))
    .addSeparator()
    .addSubMenu(ui.createMenu('マスター整備')
      .addItem('医院マスターを作成（無ければ）', 'setupClinicMaster')
      .addItem('求人マスターに医院ID列を追加', 'setupMasterClinicIdColumn')
      .addItem('写真マスターに医院ID・使用可否列を追加', 'setupPhotoClinicColumns')
      .addItem('IDを自動採番・医院IDを同期', 'assignAndSyncMasterIds'))
    .addSeparator()
    .addItem('求人文シートに訴求軸プルダウンを設定', 'setupJobAxisDropdown')
    .addItem('画像案シートに訴求軸プルダウンを設定', 'setupImageAxisDropdown')
    .addItem('画像案シートに使用写真プルダウンを設定', 'setupImagePhotoDropdown')
    .addItem('開発用：ダミー案データを作成', 'createDummyIdeas')
    .addItem('APIキーを設定', 'setApiKeyDialog')
    .addSeparator()
    .addItem('初期設定チェック', 'checkInstallStatusWithAlert')
    .addToUi();
}


// ===== フェーズ1: マスター整備 =====

// 医院マスターシートを作成 (無ければ)。ヘッダー行とサンプル1行を用意する。
function setupClinicMaster() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAMES.CLINIC);
  if (sheet) {
    ui.alert(`「${SHEET_NAMES.CLINIC}」シートは既に存在します。`);
    return;
  }
  sheet = ss.insertSheet(SHEET_NAMES.CLINIC);
  const header = ['医院ID', '医院名', 'エリア・最寄駅', '住所', '備考'];
  sheet.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
  // サンプル行 (任意・上書き/削除可)
  sheet.getRange(2, 1, 1, header.length).setValues([
    ['CLINIC001', '（医院名を入力）', '（エリア・最寄駅を入力）', '', 'サンプル行です。上書きまたは削除してください']
  ]);
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, header.length);
  ui.alert('「医院マスター」を作成しました。\n医院IDは CLINIC001, CLINIC002 ... の形式で採番してください。');
}

// 求人マスターの右端に「医院ID」ヘッダーを追加 (既存列は変更しない)
function setupMasterClinicIdColumn() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.MASTER);
  if (!sheet) {
    ui.alert(`「${SHEET_NAMES.MASTER}」シートが見つかりません。`);
    return;
  }
  const headers = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getDisplayValues()[0];
  if (headers.some(function (value) { return String(value || '').trim() === MASTER_HEADERS_.CLINIC_ID; })) {
    ui.alert('求人マスターには既に「医院ID」列があります。');
    return;
  }
  const targetColumn = Math.max(sheet.getLastColumn() + 1, MASTER_COL.CLINIC_ID);
  const cell = sheet.getRange(1, targetColumn);
  cell.setValue('医院ID').setFontWeight('bold');
  ui.alert('求人マスターの右端に「医院ID」列を追加しました。\n医院マスターのIDを入力すると、医院名はそちらを優先表示します（空欄なら従来の医院名で動作）。');
}

// 写真マスターの右端に「医院ID」「使用可否」ヘッダーを追加 (既存列は変更しない)
function setupPhotoClinicColumns() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.PHOTO);
  if (!sheet) {
    ui.alert(`「${SHEET_NAMES.PHOTO}」シートが見つかりません。`);
    return;
  }
  const headers = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getDisplayValues()[0]
    .map(function (value) { return String(value || '').trim(); });
  const hasClinicId = headers.indexOf(PHOTO_HEADERS_.CLINIC_ID) >= 0;
  const hasUsable = headers.indexOf(PHOTO_HEADERS_.USABLE) >= 0;
  if (hasClinicId && hasUsable) {
    ui.alert('写真マスターには既に「医院ID」「使用可否」列があります。');
    return;
  }
  let targetColumn = sheet.getLastColumn() + 1;
  if (!hasClinicId) sheet.getRange(1, targetColumn++).setValue('医院ID').setFontWeight('bold');
  if (!hasUsable) sheet.getRange(1, targetColumn).setValue('使用可否').setFontWeight('bold');
  ui.alert('写真マスターの右端に不足していた管理列を追加しました。\n使用可否はFALSE/×/NGで候補から除外、空欄またはTRUEで使用可です。');
}


// 指定シートの指定列(訴求軸)にプルダウン(データ入力規則)を設定する共通処理
function applyAxisDropdown_(sheetName, colIndex) {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    ui.alert(`「${sheetName}」シートが見つかりません。`);
    return;
  }
  const lastRow = Math.max(sheet.getMaxRows(), 2);
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(JOB_AXIS_OPTIONS, true)
    .setAllowInvalid(false)
    .build();
  // 2行目以降の訴求軸列にプルダウンを適用 (1行目はヘッダー)
  sheet.getRange(2, colIndex, lastRow - 1, 1).setDataValidation(rule);
  ui.alert(`「${sheetName}」の訴求軸列にプルダウンを設定しました。`);
}

// 求人文生成シートのB列(訴求軸)にプルダウンを設定
function setupJobAxisDropdown() {
  applyAxisDropdown_(SHEET_NAMES.JOB_TEXT, JOB_TEXT_COL.AXIS);
}

// 画像案生成シートのC列(訴求軸)にプルダウンを設定
function setupImageAxisDropdown() {
  applyAxisDropdown_(SHEET_NAMES.IDEA, IDEA_COL.AXIS);
}

// 画像案生成シートのB列(使用写真)に、写真マスターから作ったプルダウンを設定する
// プルダウンの値は「PHOTO001｜笑顔のスタッフ集合写真｜働きやすさ」形式
function setupImagePhotoDropdown() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ideaSheet = ss.getSheetByName(SHEET_NAMES.IDEA);
  if (!ideaSheet) {
    ui.alert(`「${SHEET_NAMES.IDEA}」シートが見つかりません。`);
    return;
  }
  const photoSheet = ss.getSheetByName(SHEET_NAMES.PHOTO);
  if (!photoSheet) {
    ui.alert(`「${SHEET_NAMES.PHOTO}」シートが見つかりません。先に写真マスターを作成してください。`);
    return;
  }
  const values = photoSheet.getDataRange().getValues();
  const photoColumns = getPhotoColumns_(photoSheet);
  const labels = [];
  for (let i = 1; i < values.length; i++) {
    const photoId = String(values[i][photoColumns.PHOTO_ID - 1] || '').trim();
    if (!photoId) continue;
    const content = String(values[i][photoColumns.CONTENT - 1] || '').trim();
    const appeal = String(values[i][photoColumns.APPEAL - 1] || '').trim();
    labels.push([photoId, content, appeal].filter(function (v) { return v; }).join('｜'));
  }
  if (!labels.length) {
    ui.alert('写真マスターに写真が登録されていません。');
    return;
  }
  const lastRow = Math.max(ideaSheet.getMaxRows(), 2);
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(labels, true)
    .setAllowInvalid(true) // 旧データや手入力メモも許容
    .build();
  ideaSheet.getRange(2, IDEA_COL.PHOTO, lastRow - 1, 1).setDataValidation(rule);
  ui.alert('「使用写真」列に写真マスターのプルダウンを設定しました。');
}


// ===== メイン処理 =====
function generateThumbnailIdeas() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getActiveSheet();

  // シートチェック
  if (sheet.getName() !== SHEET_NAMES.IDEA) {
    ui.alert(`「${SHEET_NAMES.IDEA}」シートで実行してください。`);
    return;
  }

  // 行チェック (1行目はヘッダー想定)
  const row = sheet.getActiveCell().getRow();
  if (row < 2) {
    ui.alert('データ行を選択してから実行してください。(1行目はヘッダー)');
    return;
  }

  // 入力値取得
  const rowValues = sheet.getRange(row, 1, 1, IDEA_COL.AI_OUTPUT).getValues()[0];
  const jobId = String(rowValues[IDEA_COL.JOB_ID - 1] || '').trim();
  const input = {
    photo: String(rowValues[IDEA_COL.PHOTO - 1] || '').trim(),
    axis: String(rowValues[IDEA_COL.AXIS - 1] || '').trim(),
    mood: String(rowValues[IDEA_COL.MOOD - 1] || '').trim()
  };

  // 出力セル準備
  const outputCell = sheet.getRange(row, IDEA_COL.AI_OUTPUT);
  outputCell.setValue('⏳ 生成中...');
  SpreadsheetApp.flush();

  try {
    const ideas = generateThumbnailIdeasCore(jobId, input); // 検証・マスター/写真参照・API はコアに集約
    const text = formatIdeas_(ideas);
    outputCell.setValue(text);
    outputCell.setWrap(true);
    outputCell.setVerticalAlignment('top');
    // 採用時に参照できるよう、3案の構造化データをJSONで保持 (F列・手入力不要)
    sheet.getRange(row, IDEA_COL.IDEAS_JSON).setValue(JSON.stringify(ideas));
  } catch (e) {
    outputCell.setValue('');
    ui.alert(e.message);
  }
}


// ===== 求人マスター検索 =====
function lookupMaster_(ss, jobId) {
  const sheet = ss.getSheetByName(SHEET_NAMES.MASTER);
  if (!sheet) {
    throw new Error(`「${SHEET_NAMES.MASTER}」シートが見つかりません。`);
  }
  const values = sheet.getDataRange().getValues();
  const columns = getMasterColumns_(sheet);
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][columns.JOB_ID - 1]).trim() === jobId) {
      const m = {
        jobId: String(values[i][columns.JOB_ID - 1] || '').trim(),
        clinic: String(values[i][columns.CLINIC - 1] || '').trim(),
        position: String(values[i][columns.POSITION - 1] || '').trim(),
        target: String(values[i][columns.TARGET - 1] || '').trim(),
        jobContent: String(values[i][columns.JOB_CONTENT - 1] || '').trim(),
        workStyle: String(values[i][columns.WORK_STYLE - 1] || '').trim(),
        education: String(values[i][columns.EDUCATION - 1] || '').trim(),
        benefits: String(values[i][columns.BENEFITS - 1] || '').trim(),
        salary: String(values[i][columns.SALARY - 1] || '').trim(),
        otherStrength: String(values[i][columns.OTHER - 1] || '').trim(),
        ng: String(values[i][columns.NG - 1] || '').trim(),
        clinicId: String(values[i][columns.CLINIC_ID - 1] || '').trim()
      };
      // 後方互換: 全カテゴリを結合した「強み」も保持 (旧コード/表示用)
      m.strength = MASTER_STRENGTH_FIELDS
        .map(function (f) { return m[f.key] ? `${f.label}: ${m[f.key]}` : ''; })
        .filter(function (v) { return v; })
        .join(' / ');
      // 医院IDがあれば医院マスターの正式名称を優先。無ければ求人マスターの医院名(従来)をそのまま使う。
      if (m.clinicId) {
        const clinic = lookupClinic_(ss, m.clinicId);
        if (clinic && clinic.name) m.clinic = clinic.name;
      }
      return m;
    }
  }
  return null;
}


// ===== 医院マスター検索 =====
// 医院IDで医院マスターを参照。シートが無い/IDが見つからない場合は null を返す(後方互換)。
function lookupClinic_(ss, clinicId) {
  const id = String(clinicId || '').trim();
  if (!id) return null;
  const sheet = ss.getSheetByName(SHEET_NAMES.CLINIC);
  if (!sheet) return null; // 医院マスター未作成でも従来動作を壊さない
  const values = sheet.getDataRange().getValues();
  const columns = getClinicColumns_(sheet);
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][columns.CLINIC_ID - 1]).trim() === id) {
      return {
        clinicId: String(values[i][columns.CLINIC_ID - 1] || '').trim(),
        name: String(values[i][columns.NAME - 1] || '').trim(),
        area: String(values[i][columns.AREA - 1] || '').trim(),
        address: String(values[i][columns.ADDRESS - 1] || '').trim(),
        note: String(values[i][columns.NOTE - 1] || '').trim()
      };
    }
  }
  return null;
}


// ===== 写真マスター検索 =====
// 写真IDで写真マスターを参照。シートが無い/IDが見つからない場合は null を返す。
function lookupPhoto_(ss, photoId) {
  const sheet = ss.getSheetByName(SHEET_NAMES.PHOTO);
  if (!sheet) return null;
  // 「PHOTO001｜笑顔のスタッフ集合写真｜働きやすさ」のような選択値でも先頭IDで照合する
  const id = String(photoId || '').split('｜')[0].split('|')[0].trim();
  if (!id) return null;
  const values = sheet.getDataRange().getValues();
  const columns = getPhotoColumns_(sheet);
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][columns.PHOTO_ID - 1]).trim() === id) {
      return {
        photoId: String(values[i][columns.PHOTO_ID - 1] || '').trim(),
        clinic: String(values[i][columns.CLINIC - 1] || '').trim(),
        position: String(values[i][columns.POSITION - 1] || '').trim(),
        content: String(values[i][columns.CONTENT - 1] || '').trim(),
        impression: String(values[i][columns.IMPRESSION - 1] || '').trim(),
        appeal: String(values[i][columns.APPEAL - 1] || '').trim(),
        note: String(values[i][columns.NOTE - 1] || '').trim(),
        imageUrl: String(values[i][columns.IMAGE_URL - 1] || '').trim(),
        clinicId: String(values[i][columns.CLINIC_ID - 1] || '').trim(),
        usable: String(values[i][columns.USABLE - 1] || '').trim()
      };
    }
  }
  return null;
}


// ===== Webアプリ対応コア関数 (UIに依存しない) =====
// これらは SpreadsheetApp.getUi() を一切使わず、戻り値 or 例外で結果を返す。
// GASメニュー関数・将来のWebアプリ(doGet/doPost)の双方から再利用する。

// 求人マスター必須項目チェック (医院名/職種/ターゲット/強み)
function masterMissing_(master) {
  const missing = [];
  if (!master.clinic) missing.push('医院名');
  if (!master.position) missing.push('職種');
  if (!master.target) missing.push('ターゲット');
  if (!master.strength) missing.push('強み');
  return missing;
}

// 旧名互換 (既存呼び出し用)
function scoutMasterMissing_(master) {
  return masterMissing_(master);
}

// 求人マスターを取得し、未存在/必須不足なら例外を投げる
function requireMaster_(ss, jobId) {
  if (!jobId) throw new Error('求人IDが入力されていません。');
  const master = lookupMaster_(ss, jobId);
  if (!master) throw new Error(`求人マスターに ID「${jobId}」が見つかりません。`);
  const missing = masterMissing_(master);
  if (missing.length > 0) {
    throw new Error(`求人マスターの必須項目が不足しています: ${missing.join(' / ')}`);
  }
  return master;
}

// OpenAI APIキーを取得し、無ければ例外を投げる
function requireApiKey_() {
  const apiKey = getScriptProperty_(SCRIPT_PROP.OPENAI_API_KEY);
  if (!apiKey) {
    throw new Error('スクリプトプロパティに OPENAI_API_KEY が設定されていません。\nメニュー「APIキーを設定」から登録してください。');
  }
  return apiKey;
}

// OpenAI APIの一時障害・レート制限に対する共通リトライ処理。
// 認証エラーや入力不備など、待っても直らない4xxは再試行しない。
const OPENAI_RETRY_MAX_ATTEMPTS_ = 3;
const OPENAI_RETRY_BASE_DELAY_MS_ = 1000;
const OPENAI_RETRY_MAX_DELAY_MS_ = 8000;

function isRetryableOpenAIStatus_(statusCode) {
  return statusCode === 408 || statusCode === 409 || statusCode === 429 || statusCode >= 500;
}

function getOpenAIRetryDelayMs_(response, attempt) {
  const headers = response && response.getHeaders ? response.getHeaders() : {};
  const retryAfter = headers['Retry-After'] || headers['retry-after'];
  const retryAfterSeconds = Number(retryAfter);
  if (isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return Math.min(retryAfterSeconds * 1000, OPENAI_RETRY_MAX_DELAY_MS_);
  }
  const exponential = OPENAI_RETRY_BASE_DELAY_MS_ * Math.pow(2, attempt - 1);
  const jitter = Math.floor(Math.random() * 250);
  return Math.min(exponential + jitter, OPENAI_RETRY_MAX_DELAY_MS_);
}

function getOpenAIErrorDetail_(body) {
  const text = String(body || '').trim();
  if (!text) return '詳細情報は返されませんでした。';
  try {
    const parsed = JSON.parse(text);
    const apiError = parsed && parsed.error;
    const message = apiError && apiError.message ? String(apiError.message) : '';
    const code = apiError && (apiError.code || apiError.type)
      ? String(apiError.code || apiError.type)
      : '';
    const detail = [message, code ? 'code=' + code : ''].filter(function (v) { return v; }).join(' / ');
    if (detail) return detail.substring(0, 500);
  } catch (e) {
    // JSON以外のエラー応答は、長すぎる内容を切り詰めて返す。
  }
  return text.replace(/\s+/g, ' ').substring(0, 500);
}

function buildOpenAIHttpErrorMessage_(label, statusCode, body, attempts) {
  const detail = getOpenAIErrorDetail_(body);
  let advice = '';
  if (statusCode === 401 || statusCode === 403) {
    advice = 'APIキーまたはOpenAIプロジェクトの権限を確認してください。';
  } else if (statusCode === 429) {
    advice = '利用上限またはレート制限の可能性があります。少し時間を置き、課金・利用上限も確認してください。';
  } else if (statusCode >= 500) {
    advice = 'OpenAI側の一時障害の可能性があります。少し時間を置いて再実行してください。';
  } else {
    advice = '入力内容、モデル名、API設定を確認してください。';
  }
  const retryNote = attempts > 1 ? '（' + attempts + '回試行）' : '';
  return label + 'エラー (HTTP ' + statusCode + ')' + retryNote + '\n' + advice + '\n詳細: ' + detail;
}

function fetchOpenAIWithRetry_(url, options, label, retryOptions) {
  retryOptions = retryOptions || {};
  const maxAttempts = Math.max(1, Number(retryOptions.maxAttempts || OPENAI_RETRY_MAX_ATTEMPTS_));
  const retryNetworkErrors = retryOptions.retryNetworkErrors !== false;
  let lastNetworkError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let response;
    try {
      response = UrlFetchApp.fetch(url, options);
    } catch (e) {
      lastNetworkError = e;
      if (!retryNetworkErrors || attempt >= maxAttempts) {
        throw new Error(
          label + 'への接続に失敗しました' + (attempt > 1 ? '（' + attempt + '回試行）' : '') +
          '。通信状況を確認し、少し時間を置いて再実行してください。\n詳細: ' +
          String((e && e.message) || e || '').substring(0, 500)
        );
      }
      Utilities.sleep(getOpenAIRetryDelayMs_(null, attempt));
      continue;
    }

    const statusCode = response.getResponseCode();
    if (statusCode >= 200 && statusCode < 300) return response;

    const body = response.getContentText();
    if (!isRetryableOpenAIStatus_(statusCode) || attempt >= maxAttempts) {
      throw new Error(buildOpenAIHttpErrorMessage_(label, statusCode, body, attempt));
    }
    Utilities.sleep(getOpenAIRetryDelayMs_(response, attempt));
  }

  throw new Error(
    label + 'への接続に失敗しました。少し時間を置いて再実行してください。\n詳細: ' +
    String((lastNetworkError && lastNetworkError.message) || lastNetworkError || '').substring(0, 500)
  );
}

// ===== 画像生成APIエラー（Web向け） =====
const IMAGE_GEN_ERROR_MESSAGES_ = {
  API_KEY_MISSING: 'OpenAI APIキーが設定されていません。スクリプトプロパティの OPENAI_API_KEY を確認してください。',
  PHOTO_URL_FETCH_FAILED: '写真を取得できませんでした。写真マスターの画像URL、またはDrive共有設定を確認してください。',
  PHOTO_FILE_READ_FAILED: '画像ファイルを読み込めませんでした。画像URLが有効か、アクセス権限があるか確認してください。',
  OPENAI_API_ERROR: 'OpenAI APIでエラーが発生しました。APIキー、課金状況、モデル名、リクエスト内容を確認してください。',
  TIMEOUT: '画像生成に時間がかかりすぎました。少し時間を置いて再実行してください。',
  DRIVE_SAVE_FAILED: '生成画像のDrive保存に失敗しました。保存先フォルダの権限を確認してください。',
  UNKNOWN: '画像生成中に予期しないエラーが発生しました。'
};

function imageGenError_(errorCode, detail) {
  const code = IMAGE_GEN_ERROR_MESSAGES_[errorCode] ? errorCode : 'UNKNOWN';
  const message = IMAGE_GEN_ERROR_MESSAGES_[code];
  const err = new Error(message);
  err.errorCode = code;
  err.detail = String(detail || message);
  return err;
}

function truncateImageGenDetail_(detail, maxLen) {
  const d = String(detail || '').trim().replace(/\s+/g, ' ');
  maxLen = maxLen || 200;
  if (d.length <= maxLen) return d;
  return d.substring(0, maxLen) + '...';
}

function classifyImageGenError_(e) {
  const raw = String((e && e.detail) || (e && e.message) || e || '');
  const msg = raw.toLowerCase();
  if (e && e.errorCode && IMAGE_GEN_ERROR_MESSAGES_[e.errorCode]) {
    return {
      errorCode: e.errorCode,
      message: e.message || IMAGE_GEN_ERROR_MESSAGES_[e.errorCode],
      detail: e.detail || e.message || ''
    };
  }
  if (/openai_api_key|apiキー|api_key|openai apiキー/.test(msg)) {
    return { errorCode: 'API_KEY_MISSING', message: IMAGE_GEN_ERROR_MESSAGES_.API_KEY_MISSING, detail: raw };
  }
  if (/画像urlが未設定|画像urlの形式|写真マスターに画像url|写真を取得できません|drive共有/.test(msg)) {
    return { errorCode: 'PHOTO_URL_FETCH_FAILED', message: IMAGE_GEN_ERROR_MESSAGES_.PHOTO_URL_FETCH_FAILED, detail: raw };
  }
  if (/写真urlから|空の画像|画像を取得できません|http \d{3}|アクセス権限|読み込めません/.test(msg)) {
    return { errorCode: 'PHOTO_FILE_READ_FAILED', message: IMAGE_GEN_ERROR_MESSAGES_.PHOTO_FILE_READ_FAILED, detail: raw };
  }
  if (/exceeded maximum execution time|timeout|timed out|時間がかかり|deadline exceeded/.test(msg)) {
    return { errorCode: 'TIMEOUT', message: IMAGE_GEN_ERROR_MESSAGES_.TIMEOUT, detail: raw };
  }
  if (/openai images api|openai vision api|openai apiエラー|http 4\d\d|http 5\d\d/.test(msg)) {
    return { errorCode: 'OPENAI_API_ERROR', message: IMAGE_GEN_ERROR_MESSAGES_.OPENAI_API_ERROR, detail: raw };
  }
  if (/drive保存|保存先フォルダ|createfolder|createfile|driveapp/.test(msg)) {
    return { errorCode: 'DRIVE_SAVE_FAILED', message: IMAGE_GEN_ERROR_MESSAGES_.DRIVE_SAVE_FAILED, detail: raw };
  }
  const short = truncateImageGenDetail_(raw);
  return {
    errorCode: 'UNKNOWN',
    message: IMAGE_GEN_ERROR_MESSAGES_.UNKNOWN + (short ? '詳細：' + short : ''),
    detail: raw
  };
}

function toImageGenWebError_(e) {
  return classifyImageGenError_(e);
}

function imageGenWebFailure_(e) {
  const err = toImageGenWebError_(e);
  Logger.log('[ImageGen] ' + err.errorCode + ': ' + err.detail);
  return {
    ok: false,
    errorCode: err.errorCode,
    message: err.message,
    detail: err.detail
  };
}

// 画像案を3案生成して配列で返す。input: { photo, axis, mood }
function generateThumbnailIdeasCore(jobId, input) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const master = requireMaster_(ss, jobId);
  const apiKey = requireApiKey_();
  const photoInfo = (input && input.photo) ? lookupPhoto_(ss, input.photo) : null;
  const merged = Object.assign({}, input || {}, { photoInfo: photoInfo });
  return callOpenAI_(apiKey, master, merged); // ideas[] を返す
}

// 求人文を生成して結果オブジェクトで返す。input: { axis, currentText, note }
function generateJobTextCore(jobId, input) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const master = requireMaster_(ss, jobId);
  const apiKey = requireApiKey_();
  return callOpenAIForJobText_(apiKey, master, input || {});
}

// スカウト文を1案生成して結果オブジェクトで返す。
// profile: 候補者プロフィール(必須), options: { candidatePoint, appeal }
function generateScoutTextCore(jobId, profile, options) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!profile) throw new Error('候補者プロフィールが入力されていません。');
  const master = requireMaster_(ss, jobId);
  const apiKey = requireApiKey_();
  const opts = options || {};
  const input = {
    candidateProfile: profile,
    candidatePoint: opts.candidatePoint || '',
    appeal: opts.appeal || ''
  };
  return callOpenAIForScout_(apiKey, master, input);
}

// 効果記録シートへ1行追記する。record はフィールド名で受け取る(列順に依存しない)。
// record: { kind, jobId, clinic, position, ideaNo, axis, subject, mainCopy, subCopy, body, canva, memo, savedAt? }
function saveEffectRecord(record) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.RECORD);
  if (!sheet) throw new Error(`「${SHEET_NAMES.RECORD}」シートが見つかりません。`);

  const savedAt = record.savedAt || Utilities.formatDate(
    new Date(), ss.getSpreadsheetTimeZone(), 'yyyy/MM/dd HH:mm:ss'
  );

  const row = [];
  row[RECORD_COL.SAVED_AT - 1] = savedAt;
  row[RECORD_COL.KIND - 1] = String(record.kind || '');
  row[RECORD_COL.JOB_ID - 1] = String(record.jobId || '');
  row[RECORD_COL.CLINIC - 1] = String(record.clinic || '');
  row[RECORD_COL.POSITION - 1] = String(record.position || '');
  row[RECORD_COL.IDEA_NO - 1] = String(record.ideaNo || '');
  row[RECORD_COL.AXIS - 1] = String(record.axis || '');
  row[RECORD_COL.SUBJECT - 1] = String(record.subject || '');
  row[RECORD_COL.MAIN_COPY - 1] = String(record.mainCopy || '');
  row[RECORD_COL.SUB_COPY - 1] = String(record.subCopy || '');
  row[RECORD_COL.BODY - 1] = String(record.body || '');
  row[RECORD_COL.CANVA - 1] = String(record.canva || '');
  row[RECORD_COL.MEMO - 1] = String(record.memo || '');

  sheet.appendRow(row);
  return row;
}


// ===== 画像案プロンプト組み立て (共通) =====
// format: 'json'(API用・既定) / 'readable'(ChatGPT貼り付け用・見出し付きテキスト)

// 旧JSON( template_type / canva_instruction 等)を新形式へ変換
function normalizeIdea_(idea, context) {
  idea = idea || {};
  context = context || {};
  let designInstruction = String(idea.design_instruction || '').trim();
  if (!designInstruction) {
    const parts = [];
    if (idea.template_type) parts.push('構成: ' + idea.template_type);
    if (idea.photo_placement) parts.push('写真の使い方: ' + idea.photo_placement);
    if (idea.text_placement) parts.push('文字配置: ' + idea.text_placement);
    if (idea.color) parts.push('配色: ' + idea.color);
    if (idea.canva_instruction) parts.push(String(idea.canva_instruction));
    designInstruction = parts.filter(function (v) { return v; }).join('。');
  }
  let result = {
    axis: String(idea.axis || '').trim(),
    main_copy: String(idea.main_copy || '').trim(),
    sub_copy: String(idea.sub_copy || '').trim(),
    emphasis: String(idea.emphasis || '').trim(),
    design_instruction: designInstruction,
    aim: String(idea.aim || '').trim()
  };
  if (context.master) {
    result = applySafeCopiesToIdea_(result, context.master, context.photoInfo || null, context.ideaType || 'axis_primary');
  }
  return result;
}

function normalizeIdeas_(ideas, context) {
  if (!Array.isArray(ideas)) return [];
  return ideas.map(function (idea, i) {
    const ctx = Object.assign({}, context || {}, {
      ideaType: (context && context.ideaType) || ideaTypeByIndex_(i)
    });
    return normalizeIdea_(idea, ctx);
  });
}

const IDEA_TYPE_BY_INDEX_ = ['axis_primary', 'photo_impression', 'complementary'];

function ideaTypeByIndex_(index) {
  return IDEA_TYPE_BY_INDEX_[index] || 'axis_primary';
}

function buildThumbnailPrompt_(master, input, format) {
  const readable = format === 'readable';
  const axis = String((input && input.axis) || '').trim();
  const axisHint = JOB_AXIS_PRIORITY_HINT[axis] || '';

  const systemPrompt = [
    'あなたはジョブメドレーの歯科医院求人サムネイルに特化したクリエイティブディレクターです。',
    '20代〜30代の歯科衛生士・歯科助手・歯科医師の求職者に、自然に「ここで働いてみたいかも」と思わせる案を考えます。',
    '',
    '【情報の優先順位】',
    '- 主データ = 求人マスター(特に「強み」)。コピー・訴求の根拠は必ず求人マスターを優先する。',
    '- 参考情報 = 使用写真の情報・雰囲気。デザイン方向(構図・余白・配色・トーン)の参考に使う。',
    '',
    '【前提(最重要)】',
    '- 出力する案は、既存の実写写真をベースにGPT-Image-1で直接生成する求人サムネイルの「設計案」である。',
    '- 各案のデザイン指示は、画像生成AIが理解しやすい具体的なレイアウト指示にする。',
    '- 構図・余白・文字配置・視線誘導・配色・デザインテイストを明確に書く。',
    '- ジョブメドレーの求人サムネとして実務でそのまま使えるレベルにする。',
    '',
    '【絶対遵守】',
    '- デザイン指示は「実写写真を活かし、その上に帯・コピー・あしらいを重ねる」前提で書く。',
    '- 背景除去・人物切り抜き・写真にない要素の追加は指示しない。',
    '- 写真情報の「注意点」は必ず守る。写真内容・印象・使えそうな訴求軸はデザイン指示の参考に使い、メインコピー・サブコピー・強調情報にそのまま転記しない。',
    '- 求人マスターに書かれていない給与・待遇・福利厚生・休日数などの具体数値や事実は絶対に勝手に作らない/追加しない。',
    '  → マスターに記載があるものだけ言及してよい。',
    '- 他院批判・比較・「うちは違う」系の表現は禁止。',
    '- 過度な煽り(「絶対」「日本一」「神」「最強」など)や、誇大表現は使わない。',
    '- 差別的表現・特定の年齢/性別/容姿を貶める表現は使わない。',
    '- 20代〜30代に刺さる、等身大で自然な言葉づかい(SNSで嫌味なく読める温度感)。',
    '- 求人マスターのNG表現は使わない。',
    '',
    '【コピーの書き方(重要)】',
    '- メインコピー・サブコピー・強調情報は求職者向けの自然な言葉にする。写真マスターの写真内容・写真の印象・使えそうな訴求軸・注意点をコピーにそのまま使わない。',
    '- 写真の印象はデザイン指示で活かす。例:「明るい・仲がよさそう」→コピーは「雰囲気も大切に」「あたたかい職場で働く」などに変換する。',
    '- コピーを文字数制限で途中切断しない。長い場合は短い自然な言葉に置き換える。',
    '- 強調情報は求人マスター根拠のみ。多くても3項目程度。',
    '',
    '【3案の作り方】',
    '- 選択された訴求軸に関連する求人マスターの強みを「優先して」使い、それ以外の強みは「補足的に」使う。',
    '- 3案は同じ内容の言い換えにしない。訴求角度・レイアウト・構図をそれぞれ変える。',
    '- 目安: 案1=選択された訴求軸を主軸に / 案2・案3=それを補完する別の訴求角度に変える。',
    '- 該当する強みがマスターに無い場合は、無い事実を創作せず、最も近い強みを使う。',
    '',
    '【出力】',
    readable
      ? '- 下記「出力ルール」の見出し付きテキスト形式でそのまま返す。JSON・コードブロック・前置き/後書きは使わない。'
      : '- 必ず指定のJSON形式のみで返す。前置き・後書き・コードブロックは一切不要。'
  ].join('\n');

  // 出力フォーマット (readable=人間向け見出し / json=API用)
  const outputRules = readable ? [
    '# 出力ルール',
    '- JSONでは出力しない。下記の見出し形式そのままで、画像生成AI向けのサムネイル案を3案、読みやすいテキストで返す。',
    '- 各案に以下6項目を必ず記載する。余計な前置き・後書きは書かない。',
    '',
    '【画像案1】',
    '訴求軸：',
    'メインコピー：(全角15文字以内)',
    'サブコピー：(全角25文字以内)',
    '強調情報：(求人マスター根拠の訴求ポイント。創作禁止。多くても3項目)',
    'デザイン指示：(構図・余白・文字配置・視線誘導・写真の活かし方・配色・テイストを具体的に)',
    '狙い：',
    '',
    '【画像案2】',
    '(同じ6項目。訴求軸の見せ方・レイアウト・構図を案1と変える)',
    '',
    '【画像案3】',
    '(同じ6項目。案1・案2と切り口を変える)'
  ] : [
    '# 出力ルール',
    '- 必ず次のJSON構造で返す: { "ideas": [ {...}, {...}, {...} ] }',
    '- 各案には以下のキーを必ず全て含める (画像生成AI向けの設計案):',
    '  - axis: 訴求軸 (3案で必ず重複しない。案1は選択された訴求軸を主軸に)',
    '  - main_copy: メインコピー (全角15文字以内・等身大で20〜30代に刺さる言葉)',
    '  - sub_copy: サブコピー (全角25文字以内・補足や安心感。盛らない)',
    '  - emphasis: 強調情報 (求人マスター根拠の訴求ポイント。創作禁止。多くても3項目。途中切断禁止)',
    '  - design_instruction: デザイン指示 (構図・余白・文字配置・視線誘導・写真の活かし方・配色・テイストを画像生成AI向けに具体的に。写真内容・印象はここで使う)',
    '  - aim: 狙い (この案で20〜30代求職者の何に刺すか・なぜこの訴求軸を選んだかを1〜2文)'
  ];

  // 写真マスター情報 (写真IDで参照できた場合のみ詳細を載せる)
  const photo = input.photoInfo;
  const photoLines = photo
    ? [
        '# 使用写真の情報 (写真マスター参照)',
        `- 写真ID: ${photo.photoId}`,
        `- 医院名: ${photo.clinic || '(指定なし)'}`,
        `- 職種: ${photo.position || '(指定なし)'}`,
        `- 写真内容: ${photo.content || '(指定なし)'}`,
        `- 写真の印象: ${photo.impression || '(指定なし)'}`,
        `- 使えそうな訴求軸: ${photo.appeal || '(指定なし)'}`,
        `- 注意点: ${photo.note || '(指定なし)'}`,
        '※ 実際の画像生成時はVision APIで写真を分析する。注意点は必ず守ること。',
        ''
      ]
    : [
        '# 使用写真の情報',
        `- 使用写真(実在スタッフ写真): ${input.photo || '(指定なし)'}`,
        '※ 写真マスターに該当IDがないか、写真IDではなくメモが入力されています。上記の記述をもとに考えてください。',
        ''
      ];

  const userPrompt = [
    '以下の歯科医院求人について、ジョブメドレー用サムネイル案を3つ生成してください。',
    '',
    '# 求人情報 (求人マスター ＝ 主データ)',
    ...masterInfoLines_(master),
    '',
    ...photoLines,
    '# 今回の訴求軸 (選択式)',
    `- 訴求軸: ${axis || '(指定なし → 強み全体からターゲットに最も刺さるものを選ぶ)'}`,
    `- この訴求軸で優先して使う強みの方向性: ${axisHint || '求人マスターの強み全体から、ターゲットに最も刺さるものを選ぶ'}`,
    axisPriorityNote_(axis),
    '- 上記の訴求軸に関連する強みを優先して使い、それ以外の強みは補足的に使うこと。',
    '',
    '# 画像案の条件 (デザイン方向の参考)',
    `- 雰囲気: ${input.mood || '(指定なし)'}`,
    '',
    ...outputRules,
    '',
    '# 禁止事項 (再確認)',
    '- マスターに無い給与・待遇・休日数・残業時間などの具体数値を創作しない',
    '- 他院批判・比較表現は使わない',
    '- 差別的表現は使わない',
    '- 「絶対」「No.1」「最強」などの誇大表現は使わない',
    '- NG表現は使わない',
    '- 写真マスターの写真内容・印象・使えそうな訴求軸をメインコピー・サブコピー・強調情報にそのまま使わない',
    '- コピーを途中切断しない(「ホワイ」のような欠けた語を出さない)',
    readable ? '- 指定の見出し付きテキスト形式以外で出力しない(JSON・コードブロック禁止)' : '- JSON以外の出力をしない'
  ].join('\n');

  return { system: systemPrompt, user: userPrompt };
}


// ===== OpenAI 呼び出し =====
function callOpenAI_(apiKey, master, input) {
  const prompt = buildThumbnailPrompt_(master, input);
  const systemPrompt = prompt.system;
  const userPrompt = prompt.user;

  const payload = {
    model: OPENAI_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    temperature: 0.8,
    response_format: { type: 'json_object' }
  };

  const response = fetchOpenAIWithRetry_('https://api.openai.com/v1/chat/completions', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + apiKey },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  }, 'OpenAI API');

  const body = response.getContentText();
  const data = JSON.parse(body);
  const content = data && data.choices && data.choices[0] &&
    data.choices[0].message && data.choices[0].message.content;
  if (!content) {
    throw new Error('OpenAIからの応答が空でした。');
  }

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    throw new Error('OpenAI応答のJSONパースに失敗しました。\n' + content);
  }

  if (!parsed.ideas || !Array.isArray(parsed.ideas) || parsed.ideas.length === 0) {
    throw new Error('OpenAI応答に ideas 配列がありません。');
  }
  return normalizeIdeas_(parsed.ideas, { master: master, photoInfo: input.photoInfo });
}


// ===== 画像生成 (OpenAI Images API) =====

// 訴求軸に応じた強み行を返す（画像生成プロンプト用）
function buildImageGenStrengthLines_(master, ideaAxis) {
  const primaryLabel = AXIS_PRIMARY_FIELD[ideaAxis] || '';
  const lines = [];
  MASTER_STRENGTH_FIELDS.forEach(function (f) {
    const val = String(master[f.key] || '').trim();
    if (!val) return;
    if (primaryLabel && f.label === primaryLabel) {
      lines.push(`【強調】${f.label}: ${val}`);
    } else {
      lines.push(`${f.label}: ${val}`);
    }
  });
  return lines.length ? lines : ['(求人マスターに強み情報なし)'];
}

// 写真種別（専用列がないため 写真内容 + 印象 で表現）
function inferPhotoType_(photoInfo) {
  const content = String(photoInfo.content || '').trim();
  const impression = String(photoInfo.impression || '').trim();
  if (content && impression) return content + '（印象: ' + impression + '）';
  return content || impression || '(未指定)';
}

// Google Drive URL からファイルIDを抽出
function extractDriveFileId_(url) {
  const u = String(url || '').trim();
  const fileMatch = u.match(/drive\.google\.com\/file\/d\/([^/?]+)/);
  if (fileMatch) return fileMatch[1];
  const openMatch = u.match(/drive\.google\.com\/open\?id=([^&]+)/);
  if (openMatch) return openMatch[1];
  const ucMatch = u.match(/drive\.google\.com\/uc\?(?:[^#]*&)?id=([^&]+)/);
  if (ucMatch) return ucMatch[1];
  return '';
}

// Google Drive URL を GAS から取得可能な形式に変換
function normalizeImageUrl_(url) {
  const u = String(url || '').trim();
  if (!u) return u;
  const fileId = extractDriveFileId_(u);
  if (fileId) {
    return 'https://drive.google.com/uc?export=download&id=' + fileId;
  }
  return u;
}

// Webプレビュー用URL（imgタグ向け）
function toPhotoPreviewUrl_(imageUrl) {
  const fileId = extractDriveFileId_(imageUrl);
  if (fileId) return 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w600';
  const u = String(imageUrl || '').trim();
  if (/^https?:\/\//i.test(u)) return u;
  return '';
}

// ブラウザで開く用URL
function toPhotoOpenUrl_(imageUrl) {
  const fileId = extractDriveFileId_(imageUrl);
  if (fileId) return 'https://drive.google.com/file/d/' + fileId + '/view';
  const u = String(imageUrl || '').trim();
  if (/^https?:\/\//i.test(u)) return u;
  return '';
}

// 写真マスターの URL から画像 Blob を取得
function fetchPhotoBlob_(imageUrl) {
  const url = normalizeImageUrl_(imageUrl);
  const response = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true,
    followRedirects: true
  });
  const code = response.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error(
      '写真URLから画像を取得できませんでした (HTTP ' + code + ')。\n' +
      'URLが公開設定になっているか確認してください。\n' + imageUrl
    );
  }
  const bytes = response.getBlob().getBytes();
  if (!bytes || bytes.length === 0) {
    throw new Error('写真URLから空の画像が返されました。');
  }
  const contentType = String(response.getHeaders()['Content-Type'] || 'image/png').split(';')[0];
  let ext = 'png';
  if (/jpe?g/i.test(contentType)) ext = 'jpg';
  else if (/webp/i.test(contentType)) ext = 'webp';
  else if (/gif/i.test(contentType)) ext = 'gif';
  return Utilities.newBlob(bytes, contentType, 'photo.' + ext);
}

// Vision分析プロンプト
function buildVisionAnalysisPrompt_(photoInfo) {
  const masterHint = [
    '写真マスターの参考情報（実画像を優先）:',
    '- 写真内容: ' + (photoInfo.content || '(未指定)'),
    '- 印象: ' + (photoInfo.impression || '(未指定)'),
    '- 注意点: ' + (photoInfo.note || '(なし)')
  ].join('\n');
  return [
    'あなたは求人サムネイル制作のための画像分析アシスタントです。',
    '添付の実写写真を見て、歯科医院求人サムネイル制作に必要な情報を日本語で短く分析してください。',
    '',
    masterHint,
    '',
    '必ず次のJSON形式のみで返してください（前置き・後書き不要）:',
    '{',
    '  "photo_summary": "写真全体の短い説明",',
    '  "photo_kind": "写真の種類（例: スタッフ集合 / 診療風景 / 受付 など）",',
    '  "main_subject": "写っている主な対象",',
    '  "subject_position": "人物や主対象の位置（例: 右寄り / 中央 / 左下 など）",',
    '  "background": "背景の状態",',
    '  "safe_text_area": "文字を置きやすい場所",',
    '  "brightness": "明るさ（例: 明るい / やや暗い）",',
    '  "accent_colors": ["色1", "色2"],',
    '  "layout_advice": "サムネイル化のレイアウト提案（1〜2文）",',
    '  "warnings": ["注意点1", "注意点2"]',
    '}'
  ].join('\n');
}

// Vision対応モデルで画像分析（失敗時は例外）
function callOpenAIVision_(apiKey, photoBlob, photoInfo) {
  const base64 = Utilities.base64Encode(photoBlob.getBytes());
  const mime = photoBlob.getContentType() || 'image/png';
  const payload = {
    model: OPENAI_VISION_MODEL,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: buildVisionAnalysisPrompt_(photoInfo) },
        { type: 'image_url', image_url: { url: 'data:' + mime + ';base64,' + base64 } }
      ]
    }],
    temperature: 0.2,
    response_format: { type: 'json_object' }
  };

  const response = fetchOpenAIWithRetry_('https://api.openai.com/v1/chat/completions', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + apiKey },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  }, 'OpenAI Vision API');

  const body = response.getContentText();
  const data = JSON.parse(body);
  const content = data && data.choices && data.choices[0] &&
    data.choices[0].message && data.choices[0].message.content;
  if (!content) {
    throw new Error('OpenAI Visionからの応答が空でした。');
  }

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    throw new Error('Vision応答のJSONパースに失敗しました。\n' + content);
  }
  return parsed;
}

// 画像生成前の写真分析。失敗しても null を返し、画像生成は続行する
function analyzePhotoForImageGen_(apiKey, photoBlob, photoInfo) {
  try {
    return callOpenAIVision_(apiKey, photoBlob, photoInfo);
  } catch (e) {
    Logger.log('Vision分析失敗（画像生成は続行）: ' + e.message);
    return null;
  }
}

// Vision分析結果を画像生成プロンプト用テキストに変換
function formatPhotoAnalysisForPrompt_(photoAnalysis) {
  if (!photoAnalysis) return [];
  const lines = ['【AI画像分析結果（実写を確認済み）】'];
  if (photoAnalysis.photo_summary) lines.push('- 概要: ' + photoAnalysis.photo_summary);
  if (photoAnalysis.photo_kind) lines.push('- 写真の種類: ' + photoAnalysis.photo_kind);
  if (photoAnalysis.main_subject) lines.push('- 主な対象: ' + photoAnalysis.main_subject);
  if (photoAnalysis.subject_position) lines.push('- 人物/対象の位置: ' + photoAnalysis.subject_position);
  if (photoAnalysis.background) lines.push('- 背景: ' + photoAnalysis.background);
  if (photoAnalysis.safe_text_area) lines.push('- 文字を置きやすい場所: ' + photoAnalysis.safe_text_area);
  if (photoAnalysis.brightness) lines.push('- 明るさ: ' + photoAnalysis.brightness);
  if (photoAnalysis.accent_colors) {
    const colorStr = Array.isArray(photoAnalysis.accent_colors)
      ? photoAnalysis.accent_colors.join('、')
      : String(photoAnalysis.accent_colors);
    if (colorStr) lines.push('- 写真内アクセントカラー: ' + colorStr);
  }
  if (photoAnalysis.layout_advice) lines.push('- レイアウト提案: ' + photoAnalysis.layout_advice);
  if (photoAnalysis.warnings) {
    const warnStr = Array.isArray(photoAnalysis.warnings)
      ? photoAnalysis.warnings.join(' / ')
      : String(photoAnalysis.warnings);
    if (warnStr) lines.push('- 分析上の注意: ' + warnStr);
  }
  lines.push('- 上記分析を踏まえ、人物の顔や手元を隠さず、余白を活かして文字を配置すること。');
  return lines;
}

// 選択案 + マスター + Vision分析から Images API 用プロンプトを組み立て（一元生成）
function buildImageGenPrompt_(master, photoInfo, idea, photoAnalysis, ideaType) {
  idea = normalizeIdea_(idea, {
    master: master,
    photoInfo: photoInfo,
    ideaType: ideaType || 'axis_primary'
  });
  const analysisLines = formatPhotoAnalysisForPrompt_(photoAnalysis);
  const sections = [
    'ジョブメドレー用の歯科医院求人サムネイル画像を、添付の実写写真をベースに1枚生成してください。',
    '',
    '【絶対制約】',
    '- 添付写真を主役として活かす。構図・人物・背景を大きく変えない。',
    '- 背景除去・人物切り抜き・切り抜き後の孤立配置は禁止。',
    '- 写真に写っていない人物・設備・ロゴ・文字・風景を新たに追加しない。',
    '- 帯・テキスト・あしらいは写真の上に重ねる編集のみ。',
    '- 日本語コピーは一字一句そのまま描画する（文字化け・誤字・略字禁止）。'
  ];
  if (analysisLines.length) {
    sections.push('', analysisLines.join('\n'));
  } else if (photoInfo) {
    sections.push(
      '',
      '【写真マスター参考（Vision未使用）】',
      '- 注意点: ' + (photoInfo.note || '(なし)')
    );
  }
  sections.push(
    '',
    '【コピー（正確に描画）】',
    '- メインコピー: 「' + (idea.main_copy || '') + '」',
    '- サブコピー: 「' + (idea.sub_copy || '') + '」',
    '',
    '【訴求軸】',
    idea.axis || '(なし)',
    '',
    '【強調情報（創作禁止・マスター根拠のみ）】',
    idea.emphasis || '(なし)',
    '',
    '【デザイン指示】',
    idea.design_instruction || '(なし)',
    '',
    '【狙い】',
    idea.aim || '(なし)',
    '',
    '【NG表現（使用禁止）】',
    master.ng || '(なし)',
    '',
    '【ネガティブ指示】',
    '- 文字を人物の顔や手元に被せない',
    '- 過度なエフェクト・ロゴ追加・誇大表現を入れない',
    '',
    '【出力】',
    '- 求人サムネイルとしてそのまま使える完成画像1枚',
    '- 清潔感・信頼感のある歯科クリニックのトーン'
  );
  return sections.join('\n');
}

// ===== サムネイルコピー安全処理 =====

const AXIS_MAIN_COPY_FALLBACK_ = {
  '働きやすさ': '無理なく働ける',
  '休日・有給': '休みもしっかり',
  '教育制度': 'しっかり学べる',
  '予防歯科': '予防にじっくり関われる',
  '患者担当制': '患者担当制',
  '福利厚生': '安心の福利厚生',
  '給与・待遇': '納得の待遇',
  '通勤・立地': '通いやすい立地',
  'その他': 'ここで働きたい'
};

const AXIS_SUB_COPY_FALLBACK_ = {
  '働きやすさ': '長く働きやすい環境',
  '休日・有給': '無理なく続けられる',
  '教育制度': 'スキルアップできる',
  '予防歯科': '予防処置を大切にできる',
  '患者担当制': '患者様と継続的に関わる',
  '福利厚生': '安心して働ける環境',
  '給与・待遇': '納得して働ける',
  '通勤・立地': '通いやすく働きやすい',
  'その他': '一緒に働きませんか'
};

// 長い記載を短いコピーに言い換えるための対応表。
// ※ 数値(休日数・有給取得率・診療時間)を含む言い換えをここに置いてはいけない。
//    固定値を返すと、求人マスターの実際の値と異なるコピーが生成される。
//    数値は NUMERIC_COPY_PATTERNS_ で「マスターの記載から切り出して」使う。
const PHRASE_TO_SHORT_COPY_ = [
  [/患者担当制/, '患者担当制'],
  [/予防歯科|予防処置/, '予防にじっくり関われる'],
  [/歯周治療/, '歯周治療に関われる'],
  [/ホワイトニング/, 'ホワイトニング'],
  [/PMTC/, 'PMTC'],
  [/SRP/, 'SRP'],
  [/メンテナンス/, 'メンテ業務を大切に'],
  [/教育|研修|マンツーマン/, 'しっかり学べる'],
  [/福利厚生|手当/, '安心の福利厚生'],
  [/駅近|アクセス|通勤/, '通いやすい立地']
];

// 数値を含む条件は、求人マスターの記載から実際の値をそのまま切り出す。
// 拾えなければ何も返さない(固定値で埋めない)。
const NUMERIC_COPY_PATTERNS_ = [
  /年間休日[\s]*[0-9０-９]+[\s]*日(以上|程度)?/,
  /有給(取得率|消化率)?[\s]*[0-9０-９]+[\s]*[%％](以上)?/,
  /(平日|土曜|土)[\s]*[0-9０-９]{1,2}[:：時][0-9０-９]{0,2}[分]?[\s]*(診療)?(終了|まで)/,
  /残業[^0-9０-９]{0,4}[0-9０-９]+[\s]*(時間|分)/,
  /月給[\s]*[0-9０-９,，]+[\s]*(万)?円(以上|〜|~)?/,
  /時給[\s]*[0-9０-９,，]+[\s]*円(以上|〜|~)?/
];

// 数値付きの条件をマスターの記載から抜き出す(maxLenに収まるもののみ)
function extractNumericCopy_(phrase, maxLen) {
  const t = String(phrase || '');
  for (let i = 0; i < NUMERIC_COPY_PATTERNS_.length; i++) {
    const m = t.match(NUMERIC_COPY_PATTERNS_[i]);
    if (m && m[0]) {
      const hit = m[0].trim();
      if (hit.length <= maxLen) return hit;
    }
  }
  return '';
}

function splitMasterPhrases_(text) {
  // 「・」も区切りとして扱う。区切らないと長文のまま言い換え処理に落ち、
  // 意図しない要約が起きるため。
  return String(text || '').split(/[\/／、。・\n]/).map(function (p) { return p.trim(); }).filter(Boolean);
}

function shortenPhraseToCopy_(phrase, maxLen) {
  phrase = String(phrase || '').trim();
  if (!phrase) return '';
  // 数値付きの条件は、まずマスターの実際の値を切り出して使う
  const numeric = extractNumericCopy_(phrase, maxLen);
  if (numeric) return numeric;
  for (let i = 0; i < PHRASE_TO_SHORT_COPY_.length; i++) {
    if (PHRASE_TO_SHORT_COPY_[i][0].test(phrase)) {
      const cand = PHRASE_TO_SHORT_COPY_[i][1];
      if (cand.length <= maxLen) return cand;
    }
  }
  if (phrase.length <= maxLen) return phrase;
  return '';
}

function fitNaturalCopy_(text, maxLen) {
  const t = sanitizeThumbnailCopy_(text);
  if (!t) return '';
  if (t.length <= maxLen) return t;
  const parts = splitMasterPhrases_(t);
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].length <= maxLen) return parts[i];
    const shortened = shortenPhraseToCopy_(parts[i], maxLen);
    if (shortened) return shortened;
  }
  const shortened = shortenPhraseToCopy_(t, maxLen);
  if (shortened) return shortened;
  return maxLen <= 15 ? AXIS_MAIN_COPY_FALLBACK_['その他'] : AXIS_SUB_COPY_FALLBACK_['その他'];
}

function looksLikePhotoDescription_(text, photoInfo) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (/^(写真|スタッフ集合|院内|治療風景|集合写真)/.test(t)) return true;
  if (/写真(内容|種別|の印象)|使えそうな訴求/.test(t)) return true;
  if (/明るい・仲がよさそう|仲がよさそう/.test(t)) return true;
  if (/スタッフ集合写真/.test(t)) return true;
  if (!photoInfo) return false;
  const fields = [
    photoInfo.content,
    photoInfo.impression,
    photoInfo.appeal,
    photoInfo.note,
    inferPhotoType_(photoInfo)
  ].map(function (v) { return String(v || '').trim(); }).filter(Boolean);
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    if (t === f) return true;
    if (f.length >= 4 && (t.indexOf(f) >= 0 || f.indexOf(t) >= 0)) return true;
  }
  return false;
}

function sanitizeThumbnailCopy_(text, photoInfo) {
  let t = String(text || '').trim();
  if (!t) return '';
  t = t.replace(/^写真(内容|種別|の印象)[:：]\s*/i, '');
  t = t.replace(/^使えそうな訴求(軸)?[:：]\s*/i, '');
  if (looksLikePhotoDescription_(t, photoInfo)) return '';
  return t;
}

function hasTruncationArtifact_(copy, maxLen) {
  const c = String(copy || '').trim();
  if (!c) return false;
  if (c.length >= maxLen - 1 && /ホワイ$|メンテ$|診療$|予防歯$|担当$/.test(c)) return true;
  return false;
}

function needsCopyRebuild_(copy, photoInfo, maxLen) {
  const c = String(copy || '').trim();
  if (!c) return true;
  if (looksLikePhotoDescription_(c, photoInfo)) return true;
  if (hasTruncationArtifact_(c, maxLen)) return true;
  if (/写真内容|写真の印象|使えそうな訴求/.test(c)) return true;
  return false;
}

function needsEmphasisRebuild_(emphasis, photoInfo) {
  const e = String(emphasis || '').trim();
  if (!e) return true;
  if (/写真内容:|写真の印象:|使えそうな訴求/.test(e)) return true;
  if (looksLikePhotoDescription_(e, photoInfo)) return true;
  const items = splitMasterPhrases_(e.replace(/\s*\/\s*/g, '/'));
  if (items.length > 3) return true;
  return false;
}

function formatEmphasisItems_(text, maxItems) {
  const parts = splitMasterPhrases_(text);
  const items = [];
  for (let i = 0; i < parts.length && items.length < maxItems; i++) {
    let item = fitNaturalCopy_(parts[i], 22);
    if (!item) item = shortenPhraseToCopy_(parts[i], 22);
    if (item && !looksLikePhotoDescription_(item, null)) items.push(item);
  }
  return items.join(' / ');
}

function sanitizeEmphasisText_(emphasis, master, photoInfo) {
  let e = String(emphasis || '').trim();
  e = e.replace(/写真内容:\s*[^/]+/g, '');
  e = e.replace(/写真の印象:\s*[^/]+/g, '');
  e = e.replace(/使えそうな訴求:\s*[^/]+/g, '');
  e = e.replace(/\s*\/\s*\/+/g, ' / ').replace(/^\s*\/\s*|\s*\/\s*$/g, '').trim();
  if (!e || needsEmphasisRebuild_(e, photoInfo)) return '';
  return formatEmphasisItems_(e, 3);
}

function convertPhotoImpressionToCopy_(impression, kind) {
  const imp = String(impression || '').trim();
  const rules = [
    { re: /明るい|仲がよ|チーム|和やか|笑顔|一体感/, main: '雰囲気も大切に', sub: 'あたたかい職場で働く' },
    { re: /安心|落ち着|穏やか/, main: '安心して働ける環境', sub: '長く働きやすい職場' },
    { re: /プロ|清潔|きれい/, main: '清潔感のある職場', sub: 'チーム感のある職場' }
  ];
  if (imp) {
    for (let i = 0; i < rules.length; i++) {
      if (rules[i].re.test(imp)) return kind === 'main' ? rules[i].main : rules[i].sub;
    }
  }
  return kind === 'main' ? 'チーム感のある職場' : '長く働きやすい職場';
}

function getComplementaryMasterField_(axis, master) {
  const selectedAxis = String(axis || '').trim() || 'その他';
  const primaryLabel = AXIS_PRIMARY_FIELD[selectedAxis] || '';
  for (let i = 0; i < MASTER_STRENGTH_FIELDS.length; i++) {
    const f = MASTER_STRENGTH_FIELDS[i];
    if (f.label === primaryLabel) continue;
    const val = String(master[f.key] || '').trim();
    if (val) return { label: f.label, text: val };
  }
  const fallbacks = ['仕事内容', '教育制度', '福利厚生', 'その他の強み'];
  for (let j = 0; j < fallbacks.length; j++) {
    const val = masterFieldByLabel_(master, fallbacks[j]);
    if (val) return { label: fallbacks[j], text: val };
  }
  return { label: '', text: '' };
}

function extractShortMainFromMasterText_(text, axis) {
  if (!text) return '';
  const keywords = ['患者担当制', '予防歯科', '歯周治療', 'ホワイトニング', 'PMTC', 'SRP', 'マンツーマン', '年間休日', '有給取得率'];
  for (let i = 0; i < keywords.length; i++) {
    if (text.indexOf(keywords[i]) >= 0 && keywords[i].length <= 15) return keywords[i];
  }
  const parts = splitMasterPhrases_(text);
  if (parts[0] && parts[0].length <= 15) return parts[0];
  return AXIS_MAIN_COPY_FALLBACK_[axis] || '';
}

function extractShortSubFromMasterText_(text, axis) {
  if (!text) return '';
  const parts = splitMasterPhrases_(text);
  for (let i = 1; i < parts.length; i++) {
    if (parts[i].length <= 25) return parts[i];
    const shortened = shortenPhraseToCopy_(parts[i], 25);
    if (shortened) return shortened;
  }
  if (parts[0]) {
    const shortened = shortenPhraseToCopy_(parts[0], 25);
    if (shortened && shortened !== extractShortMainFromMasterText_(text, axis)) return shortened;
  }
  return AXIS_SUB_COPY_FALLBACK_[axis] || '';
}

function buildComplementaryMainCopy_(compLabel, compText) {
  const keywords = ['患者担当制', '予防歯科', '歯周治療', 'ホワイトニング', 'PMTC', 'SRP', 'マンツーマン'];
  for (let i = 0; i < keywords.length; i++) {
    if (compText.indexOf(keywords[i]) >= 0 && keywords[i].length <= 15) return keywords[i];
  }
  if (compLabel && compLabel.length <= 15) return compLabel;
  return fitNaturalCopy_(compLabel, 15);
}

function buildComplementarySubCopy_(compLabel, compText) {
  if (compText.indexOf('予防') >= 0) return '予防にじっくり関われる';
  if (compText.indexOf('患者担当') >= 0) return '患者様と継続的に関わる';
  if (compText.indexOf('教育') >= 0 || compText.indexOf('研修') >= 0) return 'しっかりスキルアップできる';
  if (compText.indexOf('福利') >= 0) return '安心して働ける環境';
  const parts = splitMasterPhrases_(compText);
  if (parts[0]) {
    const shortened = shortenPhraseToCopy_(parts[0], 25);
    if (shortened) return shortened;
  }
  return fitNaturalCopy_(compLabel + 'に魅力', 25);
}

function buildSafeMainCopy_(axis, master, photoInfo, ideaType) {
  axis = String(axis || '').trim();
  ideaType = ideaType || 'axis_primary';
  if (ideaType === 'photo_impression') {
    return convertPhotoImpressionToCopy_(photoInfo ? photoInfo.impression : '', 'main');
  }
  if (ideaType === 'complementary') {
    const comp = getComplementaryMasterField_(axis, master);
    return buildComplementaryMainCopy_(comp.label, comp.text);
  }
  const primaryLabel = AXIS_PRIMARY_FIELD[axis] || '';
  const primaryText = primaryLabel ? masterFieldByLabel_(master, primaryLabel) : String(master.strength || '');
  const axisPhrase = shortenPhraseToCopy_(primaryText, 15);
  if (axisPhrase) return axisPhrase;
  const parts = splitMasterPhrases_(primaryText);
  if (parts[0] && parts[0].length <= 15) return parts[0];
  if (AXIS_MAIN_COPY_FALLBACK_[axis]) return AXIS_MAIN_COPY_FALLBACK_[axis];
  return fitNaturalCopy_(axis, 15);
}

function buildSafeSubCopy_(axis, master, photoInfo, ideaType) {
  axis = String(axis || '').trim();
  ideaType = ideaType || 'axis_primary';
  if (ideaType === 'photo_impression') {
    return convertPhotoImpressionToCopy_(photoInfo ? photoInfo.impression : '', 'sub');
  }
  if (ideaType === 'complementary') {
    const comp = getComplementaryMasterField_(axis, master);
    return buildComplementarySubCopy_(comp.label, comp.text);
  }
  const primaryLabel = AXIS_PRIMARY_FIELD[axis] || '';
  const primaryText = primaryLabel ? masterFieldByLabel_(master, primaryLabel) : String(master.strength || '');
  const fromMaster = extractShortSubFromMasterText_(primaryText, axis);
  if (fromMaster) return fromMaster;
  return AXIS_SUB_COPY_FALLBACK_[axis] || '一緒に働きませんか';
}

function buildSafeEmphasis_(axis, master, photoInfo, ideaType) {
  axis = String(axis || '').trim();
  ideaType = ideaType || 'axis_primary';
  let sourceText = '';
  if (ideaType === 'photo_impression') {
    sourceText = masterFieldByLabel_(master, '働きやすさ') ||
      masterFieldByLabel_(master, '福利厚生') ||
      masterFieldByLabel_(master, '仕事内容');
  } else if (ideaType === 'complementary') {
    const comp = getComplementaryMasterField_(axis, master);
    sourceText = comp.text || '';
  } else {
    const primaryLabel = AXIS_PRIMARY_FIELD[axis] || '';
    sourceText = primaryLabel ? masterFieldByLabel_(master, primaryLabel) : String(master.strength || '');
  }
  return formatEmphasisItems_(sourceText, 3);
}

function applySafeCopiesToIdea_(idea, master, photoInfo, ideaType) {
  const axis = idea.axis || '';
  const safeMain = buildSafeMainCopy_(axis, master, photoInfo, ideaType);
  const safeSub = buildSafeSubCopy_(axis, master, photoInfo, ideaType);
  const safeEmphasis = buildSafeEmphasis_(axis, master, photoInfo, ideaType);
  if (needsCopyRebuild_(idea.main_copy, photoInfo, 15)) {
    idea.main_copy = safeMain;
  } else {
    idea.main_copy = fitNaturalCopy_(sanitizeThumbnailCopy_(idea.main_copy, photoInfo), 15) || safeMain;
  }
  if (needsCopyRebuild_(idea.sub_copy, photoInfo, 25)) {
    idea.sub_copy = safeSub;
  } else {
    idea.sub_copy = fitNaturalCopy_(sanitizeThumbnailCopy_(idea.sub_copy, photoInfo), 25) || safeSub;
  }
  if (needsEmphasisRebuild_(idea.emphasis, photoInfo)) {
    idea.emphasis = safeEmphasis;
  } else {
    idea.emphasis = sanitizeEmphasisText_(idea.emphasis, master, photoInfo) || safeEmphasis;
  }
  return idea;
}

function buildPhotoImpressionDesignInstruction_(photoInfo, mood) {
  const content = photoInfo ? String(photoInfo.content || '').trim() : '';
  const impression = photoInfo ? String(photoInfo.impression || '').trim() : '';
  const parts = ['【案の方向性】使用写真の印象・雰囲気を主役にする。'];
  if (content) {
    parts.push(content + 'を大きく見せ、');
  }
  if (impression) {
    parts.push(impression + 'が伝わる明るく安心感のある雰囲気にする。');
  } else {
    parts.push('明るく安心感のある雰囲気が伝わるようにする。');
  }
  parts.push('顔を隠さない位置に半透明の帯を重ね、文字量は少なめにする。清潔感のある歯科医院トーン。');
  if (mood) parts.unshift('雰囲気の参考: ' + mood + '。');
  return parts.join('');
}

// 後方互換（途中切断しない）
function truncateCopy_(text, maxLen) {
  return fitNaturalCopy_(text, maxLen);
}

function masterFieldByLabel_(master, label) {
  const f = MASTER_STRENGTH_FIELDS.find(function (x) { return x.label === label; });
  return f ? String(master[f.key] || '').trim() : '';
}

function pickFirstPhrase_(text, maxLen) {
  const parts = splitMasterPhrases_(text);
  for (let i = 0; i < parts.length; i++) {
    const fitted = fitNaturalCopy_(parts[i], maxLen);
    if (fitted) return fitted;
  }
  return fitNaturalCopy_(text, maxLen);
}

// 手動運用：案1＝選択訴求軸主役
function buildManualIdeaAxisPrimary_(master, photoInfo, input) {
  const selectedAxis = String(input.axis || '').trim() || 'その他';
  const ideaType = 'axis_primary';
  const primaryLabel = AXIS_PRIMARY_FIELD[selectedAxis] || '';
  const mood = String(input.mood || '').trim();
  const designParts = [
    '【案の方向性】選択された訴求軸「' + selectedAxis + '」を主役にする。',
    '写真を全面または大きく背景に使用し、メインコピーを目立つ位置に配置。',
    '清潔感のある歯科医院トーン。文字は少なめ。顔を隠さない。'
  ];
  if (mood) designParts.unshift('雰囲気の参考: ' + mood + '。');
  return {
    axis: selectedAxis,
    main_copy: buildSafeMainCopy_(selectedAxis, master, photoInfo, ideaType),
    sub_copy: buildSafeSubCopy_(selectedAxis, master, photoInfo, ideaType),
    emphasis: buildSafeEmphasis_(selectedAxis, master, photoInfo, ideaType),
    design_instruction: designParts.join(' '),
    aim: '20〜30代求職者に、' + selectedAxis + 'を最優先で伝えるサムネイル。'
  };
}

// 手動運用：案2＝写真の印象主役
function buildManualIdeaPhotoImpression_(master, photoInfo, input) {
  const selectedAxis = String(input.axis || '').trim();
  const ideaType = 'photo_impression';
  const mood = String(input.mood || '').trim();
  return {
    axis: selectedAxis || '雰囲気・チーム感',
    main_copy: buildSafeMainCopy_(selectedAxis, master, photoInfo, ideaType),
    sub_copy: buildSafeSubCopy_(selectedAxis, master, photoInfo, ideaType),
    emphasis: buildSafeEmphasis_(selectedAxis, master, photoInfo, ideaType),
    design_instruction: buildPhotoImpressionDesignInstruction_(photoInfo, mood),
    aim: '写真の雰囲気から「ここで働きやすそう」と直感で思わせる。'
  };
}

// 手動運用：案3＝補足訴求主役
function buildManualIdeaComplementary_(master, photoInfo, input) {
  const selectedAxis = String(input.axis || '').trim() || 'その他';
  const ideaType = 'complementary';
  const comp = getComplementaryMasterField_(selectedAxis, master);
  const mood = String(input.mood || '').trim();
  const designParts = [
    '【案の方向性】「' + selectedAxis + '」とは別角度の補足訴求「' + comp.label + '」を主役にする。',
    '写真はそのまま活かし、別の強みが伝わるレイアウト。情報は詰め込みすぎない。',
    'メインコピーで補足訴求を明確に、サブで補足する。'
  ];
  if (mood) designParts.unshift('雰囲気の参考: ' + mood + '。');
  return {
    axis: comp.label || '仕事内容',
    main_copy: buildSafeMainCopy_(selectedAxis, master, photoInfo, ideaType),
    sub_copy: buildSafeSubCopy_(selectedAxis, master, photoInfo, ideaType),
    emphasis: buildSafeEmphasis_(selectedAxis, master, photoInfo, ideaType),
    design_instruction: designParts.join(' '),
    aim: selectedAxis + '以外の魅力も伝え、検討中の求職者の関心を広げる。'
  };
}

// API不要：求人マスター・写真マスターから手動用3案を組み立て
function buildManualImageIdeasWithoutApi_(master, photoInfo, input) {
  input = input || {};
  return normalizeIdeas_([
    buildManualIdeaAxisPrimary_(master, photoInfo, input),
    buildManualIdeaPhotoImpression_(master, photoInfo, input),
    buildManualIdeaComplementary_(master, photoInfo, input)
  ], { master: master, photoInfo: photoInfo });
}

// ChatGPT手動画像生成用プロンプト（選択案1件・1枚生成前提）
function buildManualImagePrompt_(master, photoInfo, idea, ideaNo, options) {
  options = options || {};
  const ideaType = ideaTypeByIndex_(ideaNo ? ideaNo - 1 : 0);
  idea = normalizeIdea_(idea, { master: master, photoInfo: photoInfo, ideaType: ideaType });
  const ideaLabel = ideaNo ? '案' + ideaNo : '選択案';
  const selectedAxis = String(options.selectedAxis || '').trim();

  const photoLines = photoInfo
    ? [
        '【使用写真（写真マスター）】',
        '- 写真ID: ' + photoInfo.photoId,
        '- 写真内容: ' + (photoInfo.content || '(未指定)'),
        '- 写真種別: ' + inferPhotoType_(photoInfo),
        '- 写真の印象: ' + (photoInfo.impression || '(未指定)'),
        '- 使えそうな訴求軸: ' + (photoInfo.appeal || '(未指定)'),
        '- 注意点: ' + (photoInfo.note || '(なし)'),
        '- 画像URL: ' + (photoInfo.imageUrl || '(未指定)'),
        '※ ChatGPTで画像生成する際は、上記URLの実写写真を1枚添付して使用してください。'
      ]
    : [
        '【使用写真】',
        '(写真が選択されていません。生成時に実写写真を1枚添付してください。)'
      ];

  return [
    'この求人サムネイルを1枚だけ生成してください。',
    '3案の提案は不要です。',
    '比較画像やコラージュ画像にしないでください。',
    '以下の「' + ideaLabel + '」だけを元にしてください。他の案の内容は使わないでください。',
    '既存の実写写真をベースにデザイン化してください。',
    '',
    '【必須条件】',
    '- この求人サムネイルを1枚だけ生成してください。',
    '- 3案の提案は不要です。',
    '- 比較画像やコラージュ画像にしないでください。',
    '- 以下の1案だけを元にしてください。',
    '- 写真は1枚のみ使用してください。',
    '- 写真の複製は禁止です。',
    '- 人物追加は禁止です。',
    '- 背景除去は禁止です。',
    '- 写真にない人物・小物・設備を追加しないでください。',
    '- 文字量は少なめにしてください。',
    '- ジョブメドレーの求人一覧で3秒見ても伝わるサムネイルにしてください。',
    '- 帯・テキスト・あしらいは写真の上に重ねるのみ。',
    '- 日本語テキストは指定コピーを正確に描画する（文字化け・誤字・略字禁止）。',
    '',
    '【求人情報】',
    '- 医院名: ' + master.clinic,
    '- 職種: ' + master.position,
    '- 選択された訴求軸: ' + (selectedAxis || idea.axis || '(未指定)'),
    ...masterInfoLines_(master).filter(function (line) {
      return line.indexOf('医院名:') < 0 && line.indexOf('職種:') < 0;
    }),
    '',
    photoLines.join('\n'),
    '',
    '【' + ideaLabel + 'の内容】',
    '- 訴求軸（この案）: ' + (idea.axis || ''),
    '- メインコピー: 「' + (idea.main_copy || '') + '」',
    '- サブコピー: 「' + (idea.sub_copy || '') + '」',
    '- 強調情報: ' + (idea.emphasis || ''),
    '- デザイン指示: ' + (idea.design_instruction || ''),
    '- 狙い: ' + (idea.aim || ''),
    '',
    '【禁止事項】',
    '- NG表現: ' + (master.ng || '(なし)'),
    '- 求人マスターに無い数値・事実の創作禁止',
    '- 他院批判・誇大表現禁止',
    '',
    '【出力】',
    'ジョブメドレー用の歯科医院求人サムネイル画像を1枚だけ生成してください。'
  ].join('\n');
}

// 表示中の全案それぞれの手動画像生成プロンプトを生成
function buildManualImagePromptsForAllIdeas_(master, photoInfo, ideas, options) {
  options = options || {};
  return normalizeIdeas_(ideas, { master: master, photoInfo: photoInfo }).map(function (idea, i) {
    const ideaNo = i + 1;
    return {
      ideaNo: ideaNo,
      prompt: buildManualImagePrompt_(master, photoInfo, idea, ideaNo, options)
    };
  });
}

// OpenAI Images API (edits) を呼び出し、Base64 画像データを返す
function callOpenAIImages_(apiKey, prompt, photoBlob) {
  const response = fetchOpenAIWithRetry_('https://api.openai.com/v1/images/edits', {
    method: 'post',
    headers: { Authorization: 'Bearer ' + apiKey },
    payload: {
      image: photoBlob,
      prompt: prompt,
      model: OPENAI_IMAGE_MODEL,
      n: '1',
      size: OPENAI_IMAGE_SIZE,
      quality: 'high',
      input_fidelity: 'high'
    },
    muteHttpExceptions: true
  }, 'OpenAI Images API', {
    // 画像生成は高コストで、通信切断時の自動再送は二重生成になり得るため行わない。
    maxAttempts: 2,
    retryNetworkErrors: false
  });

  const body = response.getContentText();
  const data = JSON.parse(body);
  const item = data && data.data && data.data[0];
  if (!item || !item.b64_json) {
    throw new Error('OpenAI Images APIから画像データが返されませんでした。\n' + body);
  }
  return item;
}

// 生成画像の保存先フォルダを取得（なければスプレッドシートと同階層に作成）
function getOrCreateGeneratedImageFolder_() {
  const savedId = getScriptProperty_(SCRIPT_PROP.GENERATED_IMAGE_FOLDER_ID);
  if (savedId) {
    try {
      return DriveApp.getFolderById(savedId);
    } catch (e) {
      // フォルダ削除済み → 再作成
    }
  }
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ssFile = DriveApp.getFileById(ss.getId());
  const parents = ssFile.getParents();
  const parent = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
  const folder = parent.createFolder(GENERATED_IMAGE_FOLDER_NAME);
  setScriptProperty_(SCRIPT_PROP.GENERATED_IMAGE_FOLDER_ID, folder.getId());
  return folder;
}

// 生成画像を Google Drive に保存し、共有URLを返す
function saveGeneratedImageToDrive_(blob, meta) {
  meta = meta || {};
  const folder = getOrCreateGeneratedImageFolder_();
  const tz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
  const ts = Utilities.formatDate(new Date(), tz, 'yyyyMMdd_HHmmss');
  const name = [
    meta.jobId || 'job',
    meta.photoId || 'photo',
    meta.ideaNo ? '案' + meta.ideaNo : '',
    ts
  ].filter(function (v) { return v; }).join('_') + '.png';
  const file = folder.createFile(blob.setName(name));
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return {
    fileId: file.getId(),
    url: 'https://drive.google.com/file/d/' + file.getId() + '/view'
  };
}

// 選択案1件を画像化するコア処理
function generateJobThumbnailImageCore(jobId, photoId, idea, options) {
  options = options || {};
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const master = requireMaster_(ss, jobId);
    if (!photoId) throw imageGenError_('PHOTO_URL_FETCH_FAILED', '使用写真が指定されていません。');
    const photoInfo = lookupPhoto_(ss, photoId);
    if (!photoInfo) {
      throw imageGenError_('PHOTO_URL_FETCH_FAILED', '写真マスターに ID「' + photoId + '」が見つかりません。');
    }
    const imageUrl = String(photoInfo.imageUrl || '').trim();
    if (!imageUrl) {
      throw imageGenError_('PHOTO_URL_FETCH_FAILED', '写真マスターに画像URLが未設定です。');
    }
    if (!normalizeImageUrl_(imageUrl)) {
      throw imageGenError_('PHOTO_URL_FETCH_FAILED', '画像URLの形式が不正です: ' + imageUrl);
    }
    if (!idea) throw imageGenError_('UNKNOWN', '画像案が指定されていません。');

    const ideaType = ideaTypeByIndex_((options.ideaNo || 1) - 1);
    idea = normalizeIdea_(idea, { master: master, photoInfo: photoInfo, ideaType: ideaType });

    let apiKey;
    try {
      apiKey = requireApiKey_();
    } catch (e) {
      throw imageGenError_('API_KEY_MISSING', e.message);
    }

    let photoBlob;
    try {
      photoBlob = fetchPhotoBlob_(imageUrl);
    } catch (e) {
      throw imageGenError_('PHOTO_FILE_READ_FAILED', e.message);
    }

    const photoAnalysis = analyzePhotoForImageGen_(apiKey, photoBlob, photoInfo);
    const prompt = buildImageGenPrompt_(master, photoInfo, idea, photoAnalysis, ideaType);

    let result;
    try {
      result = callOpenAIImages_(apiKey, prompt, photoBlob);
    } catch (e) {
      throw imageGenError_('OPENAI_API_ERROR', e.message);
    }

    const imageBytes = Utilities.base64Decode(result.b64_json);
    const mimeType = 'image/png';
    const imageBlob = Utilities.newBlob(imageBytes, mimeType, 'thumbnail.png');

    let driveInfo;
    try {
      driveInfo = saveGeneratedImageToDrive_(imageBlob, {
        jobId: jobId,
        photoId: photoInfo.photoId,
        ideaNo: options.ideaNo || ''
      });
    } catch (e) {
      throw imageGenError_('DRIVE_SAVE_FAILED', e.message);
    }

    return {
      imageBase64: result.b64_json,
      mimeType: mimeType,
      prompt: prompt,
      promptSummary: prompt.length > 200 ? prompt.substring(0, 200) + '...' : prompt,
      driveUrl: driveInfo.url,
      driveFileId: driveInfo.fileId,
      ideaNo: options.ideaNo || null,
      visionAnalysisUsed: !!photoAnalysis
    };
  } catch (e) {
    if (e && e.errorCode && IMAGE_GEN_ERROR_MESSAGES_[e.errorCode]) throw e;
    const classified = classifyImageGenError_(e);
    throw imageGenError_(classified.errorCode, classified.detail);
  }
}


// ===== 出力整形 =====
function formatIdeas_(ideas) {
  const divider = '\n────────────────\n';
  const blocks = normalizeIdeas_(ideas).map((idea, i) => {
    return [
      `■ 案${i + 1}  [訴求軸: ${idea.axis || '-'}]`,
      `【メインコピー】   ${idea.main_copy || ''}`,
      `【サブコピー】     ${idea.sub_copy || ''}`,
      `【強調情報】       ${idea.emphasis || ''}`,
      `【デザイン指示】   ${idea.design_instruction || ''}`,
      `【狙い】           ${idea.aim || ''}`
    ].join('\n');
  });
  return blocks.join(divider);
}


// ===== 採用案を効果記録シートに保存 =====
// メニューから呼ぶ薄いラッパー (案1〜案3)
function adoptIdea1() { adoptIdea_(1); }
function adoptIdea2() { adoptIdea_(2); }
function adoptIdea3() { adoptIdea_(3); }

// 選択行の生成済み案から ideaNo(1始まり) を採用し、効果記録へ自動保存する
function adoptIdea_(ideaNo) {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getActiveSheet();

  if (sheet.getName() !== SHEET_NAMES.IDEA) {
    ui.alert(`「${SHEET_NAMES.IDEA}」シートで実行してください。`);
    return;
  }

  const row = sheet.getActiveCell().getRow();
  if (row < 2) {
    ui.alert('データ行を選択してから実行してください。(1行目はヘッダー)');
    return;
  }

  const rowValues = sheet.getRange(row, 1, 1, IDEA_COL.IDEAS_JSON).getValues()[0];
  const jobId = String(rowValues[IDEA_COL.JOB_ID - 1] || '').trim();
  const ideasJson = String(rowValues[IDEA_COL.IDEAS_JSON - 1] || '').trim();

  if (!jobId) {
    ui.alert('求人IDが入力されていません。');
    return;
  }
  if (!ideasJson) {
    ui.alert('この行にはまだ生成済みの案がありません。\n先に「選択行のAI案を生成」を実行してください。');
    return;
  }

  // 保持しておいた3案の構造化データを復元
  let ideas;
  try {
    ideas = JSON.parse(ideasJson);
  } catch (e) {
    ui.alert('案データの読み込みに失敗しました。\nお手数ですが「選択行のAI案を生成」をやり直してください。');
    return;
  }
  if (!Array.isArray(ideas) || ideas.length < ideaNo) {
    ui.alert(`案${ideaNo}が見つかりません。生成された案は ${Array.isArray(ideas) ? ideas.length : 0} 件です。`);
    return;
  }

  const idea = normalizeIdea_(ideas[ideaNo - 1]);

  // 医院名・職種は求人マスターから取得
  const master = lookupMaster_(ss, jobId);
  if (!master) {
    ui.alert(`求人マスターに ID「${jobId}」が見つかりません。`);
    return;
  }

  const memo = [
    `強調情報: ${idea.emphasis || ''}`,
    `デザイン指示: ${idea.design_instruction || ''}`,
    `狙い: ${idea.aim || ''}`
  ].join(' ／ ');

  try {
    saveEffectRecord({
      kind: 'IMAGE',
      jobId: jobId,
      clinic: master.clinic,
      position: master.position,
      ideaNo: `案${ideaNo}`,
      axis: idea.axis || '',
      subject: '',
      mainCopy: idea.main_copy || '',
      subCopy: idea.sub_copy || '',
      body: '',
      canva: idea.design_instruction || '',
      memo: memo
    });
  } catch (e) {
    ui.alert(e.message);
    return;
  }
  ui.alert(`画像案${ideaNo}を効果記録に保存しました。`);
}


// ===== 求人文生成 (求人文生成シート) =====
function generateJobText() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getActiveSheet();

  if (sheet.getName() !== SHEET_NAMES.JOB_TEXT) {
    ui.alert(`「${SHEET_NAMES.JOB_TEXT}」シートで実行してください。`);
    return;
  }

  const row = sheet.getActiveCell().getRow();
  if (row < 2) {
    ui.alert('データ行を選択してから実行してください。(1行目はヘッダー)');
    return;
  }

  const rowValues = sheet.getRange(row, 1, 1, JOB_TEXT_COL.AI_OUTPUT).getValues()[0];
  const jobId = String(rowValues[JOB_TEXT_COL.JOB_ID - 1] || '').trim();
  const input = {
    axis: String(rowValues[JOB_TEXT_COL.AXIS - 1] || '').trim(),
    currentText: String(rowValues[JOB_TEXT_COL.CURRENT_TEXT - 1] || '').trim(),
    note: String(rowValues[JOB_TEXT_COL.NOTE - 1] || '').trim()
  };

  const outputCell = sheet.getRange(row, JOB_TEXT_COL.AI_OUTPUT);
  outputCell.setValue('⏳ 生成中...');
  SpreadsheetApp.flush();

  try {
    const result = generateJobTextCore(jobId, input); // 検証・マスター・API はコアに集約
    const text = formatJobText_(result);
    outputCell.setValue(text);
    outputCell.setWrap(true);
    outputCell.setVerticalAlignment('top');
    // 採用時に参照できるよう、生成結果をJSONで保持 (F列・手入力不要)
    sheet.getRange(row, JOB_TEXT_COL.RESULT_JSON).setValue(JSON.stringify(result));
  } catch (e) {
    outputCell.setValue('');
    ui.alert(e.message);
  }
}


// ===== 求人文の採用保存 (求人案 1〜3) =====
// 「タイトル+本文を3案出し、1つ選ぶ」仕様。選んだ案を効果記録へ保存する。
function adoptJobText1() { adoptJobText_(1); }
function adoptJobText2() { adoptJobText_(2); }
function adoptJobText3() { adoptJobText_(3); }

function adoptJobText_(ideaNo) {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getActiveSheet();

  if (sheet.getName() !== SHEET_NAMES.JOB_TEXT) {
    ui.alert(`「${SHEET_NAMES.JOB_TEXT}」シートで実行してください。`);
    return;
  }

  const row = sheet.getActiveCell().getRow();
  if (row < 2) {
    ui.alert('データ行を選択してから実行してください。(1行目はヘッダー)');
    return;
  }

  const rowValues = sheet.getRange(row, 1, 1, JOB_TEXT_COL.RESULT_JSON).getValues()[0];
  const jobId = String(rowValues[JOB_TEXT_COL.JOB_ID - 1] || '').trim();
  const axis = String(rowValues[JOB_TEXT_COL.AXIS - 1] || '').trim();
  const resultJson = String(rowValues[JOB_TEXT_COL.RESULT_JSON - 1] || '').trim();

  if (!jobId) {
    ui.alert('求人IDが入力されていません。');
    return;
  }
  if (!resultJson) {
    ui.alert('この行にはまだ生成済みの求人文がありません。\n先に「選択行の求人文を生成」を実行してください。');
    return;
  }

  let result;
  try {
    result = JSON.parse(resultJson);
  } catch (e) {
    ui.alert('求人文データの読み込みに失敗しました。\nお手数ですが「選択行の求人文を生成」をやり直してください。');
    return;
  }

  const ideas = (result && result.ideas) || [];
  const idea = ideas[ideaNo - 1];
  if (!idea) {
    ui.alert(`求人案${ideaNo}が見つかりません。生成された案は ${ideas.length} 件です。`);
    return;
  }

  const master = lookupMaster_(ss, jobId);
  if (!master) {
    ui.alert(`求人マスターに ID「${jobId}」が見つかりません。`);
    return;
  }

  try {
    saveEffectRecord({
      kind: 'JOB_TEXT',
      jobId: jobId,
      clinic: master.clinic,
      position: master.position,
      ideaNo: `求人案${ideaNo}`,
      axis: axis,
      subject: '',
      mainCopy: String(idea.title || '').trim(),
      subCopy: '',
      body: String(idea.body || '').trim(),
      canva: '',
      memo: '求人タイトル+本文を採用'
    });
  } catch (e) {
    ui.alert(e.message);
    return;
  }
  ui.alert(`求人案${ideaNo}(タイトル+本文)を効果記録に保存しました。`);
}


// ===== 求人文プロンプト組み立て (共通) =====
// format: 'json'(API用・既定) / 'readable'(ChatGPT貼り付け用・見出し付きテキスト)
function buildJobTextPrompt_(master, input, format) {
  const readable = format === 'readable';
  const axis = String((input && input.axis) || '').trim();
  const axisHint = JOB_AXIS_PRIORITY_HINT[axis] || '';
  const diff = jobAxisDiff_(axis);

  const systemPrompt = [
    'あなたはジョブメドレーの歯科医院求人ライティングに特化したコピーライターです。',
    '20代〜30代の歯科衛生士・歯科助手・歯科医師の求職者に、自然に「ここで働いてみたい」と思わせる文章を書きます。',
    '',
    '【情報の優先順位】',
    '- 主データ = 求人マスター(特に「強み」)。内容の根拠は必ず求人マスターを優先する。',
    '- 参考情報 = 現在求人文。トーン・言い回し・固有の雰囲気は参考にしてよいが、事実の根拠は求人マスターを優先する。',
    '',
    '【書き方の品質ルール(最重要)】',
    '- 強みを箇条書き的に並べるだけの文章を書かない。「○○あり、△△あり、□□あり」のような羅列を禁止する。',
    '- 各強みが、求職者にとってどんな働き方・経験・メリットにつながるのかを、自然な文章で表現する。',
    '- 医院の説明ではなく、求職者が「自分がそこで働く姿」をイメージできる文章を優先する。',
    '  悪い例: 「当院は患者担当制です」 → 良い例: 「患者さまと継続的に関わりながら働けます」',
    '  悪い例: 勤務時間や休日数を数値のまま並べただけの文 → 良い例: 「平日も夕方には終わるので、自分の時間を持ちながら長く働けます」',
    '  ※ 数値を書く場合は、求人マスターに記載された値をそのまま使う。この指示文や例文の数値を流用しない。',
    '- 主語を「当院は」より「あなたは/働くと」に寄せ、読み手のメリットを中心に書く。',
    '',
    '【絶対遵守】',
    '- 求人マスターと「現在求人文」に書かれていない事実(給与・休日・福利厚生・待遇・残業時間など)は絶対に勝手に作らない/追加しない。',
    '- 求人マスターに無い情報から「推測して具体を足す」ことを禁止する。記載された強みの語句が示す範囲を超えない。',
    '  例: 「予防歯科重視」とだけある → 「定期管理を任せられる」等を勝手に書かない。',
    '  例: 「患者担当制」とだけある → 「長期メンテナンスを担当」等を勝手に書かない。',
    '  → 強みを「言い換えて求職者メリットにする」のは可。「無い事実・無い制度を新たに足す」のは不可。',
    '- 事実と異なる内容は書かない。誇張・推測で断定しない。',
    '- 他院批判・比較・「うちは違う」系の表現は禁止。',
    '- 「絶対」「日本一」「No.1」「神」「最強」などの誇大表現は使わない。',
    '- 差別的表現・特定の年齢/性別/容姿を貶める表現は使わない。',
    '- 20〜30代にも自然に伝わる、等身大で読みやすい言葉づかい(SNSで読んで嫌味のない温度感)。',
    '- 求人マスターのNG表現は使わない。',
    '',
    readable
      ? '【出力】下記「出力ルール」の見出し付きテキスト形式でそのまま返す。JSON・コードブロック・前置き/後書きは使わない。'
      : '【出力】必ず指定のJSON形式のみで返す。前置き・後書き・コードブロックは一切不要。'
  ].join('\n');

  // 出力フォーマット (readable=人間向け見出し / json=API用)
  // ジョブメドレーへそのまま掲載できる「タイトル + 本文」のセットを3案生成する
  const outputRules = readable ? [
    '# 出力ルール',
    '- JSONでは出力しない。下記の見出し形式そのままで、タイトル+本文のセットを3案返す。',
    '- 余計な前置き・後書き・補足説明は書かない。各案は区切り線「────────────────」で区切る。',
    '',
    '【求人案1】',
    '',
    'タイトル：',
    '(全角20〜40文字程度・強みを活かしクリックしたくなる内容・誇大表現禁止)',
    '',
    '本文：',
    '(400〜800文字程度。「#見出し」付き・箇条書きを適度に使い、ジョブメドレー掲載文として自然な構成)',
    '',
    '────────────────',
    '',
    '【求人案2】',
    '',
    'タイトル：',
    '(案1とは別案。同じキーワードを使い回さない)',
    '',
    '本文：',
    '(案1と切り口を変える)',
    '',
    '────────────────',
    '',
    '【求人案3】',
    '',
    'タイトル：',
    '(案1・案2とは別案)',
    '',
    '本文：',
    '(案1・案2と切り口を変える)'
  ] : [
    '# 出力ルール',
    '- 必ず次のJSON構造で返す (タイトル+本文のセットを3案):',
    '  {',
    '    "ideas": [',
    '      { "title": "求人タイトル1", "body": "本文1(見出しや改行を含む1つの文字列。見出しは # で始める)" },',
    '      { "title": "求人タイトル2", "body": "本文2" },',
    '      { "title": "求人タイトル3", "body": "本文3" }',
    '    ]',
    '  }',
    '- title: 全角20〜40文字程度・求人マスターの強みを活かしクリックしたくなる内容・誇大表現禁止。3案で別案にし、同じキーワードを使い回さない',
    '- body: 400〜800文字程度。「#見出し」付き・箇条書きを適度に使い、ジョブメドレー掲載文として自然な構成。3案で切り口を変える'
  ];

  const userPrompt = [
    '以下の歯科医院求人について、求人マスターの強みを主な情報源として、ジョブメドレーへそのまま掲載できる「求人タイトル + 求人本文」のセットを3案生成してください。',
    '',
    '# 求人情報 (求人マスター ＝ 主データ)',
    ...masterInfoLines_(master),
    '',
    '# 今回の訴求軸 (選択式・最重要)',
    `- 訴求軸: ${axis || '(指定なし → 強み全体からターゲットに最も刺さるものを選ぶ)'}`,
    `- この訴求軸で優先して使う強みの方向性: ${axisHint || '求人マスターの強み全体から、ターゲットに最も刺さるものを選ぶ'}`,
    axisPriorityNote_(axis),
    '- タイトルと本文の冒頭で、必ず訴求軸が伝わるようにする。本文全体の比重もこの訴求軸に寄せる。',
    '- 求人マスターの強みのうち、上記の方向性に該当するものを「主役」として優先的に使い、それ以外は「補足」に留める。',
    '- 該当する強みが求人マスターに無い場合は、無い事実を創作せず、最も近い強みを使う。',
    '',
    '# 参考情報',
    `- 現在求人文(参考): ${input.currentText || '(指定なし)'}`,
    `- 補足: ${input.note || '(指定なし)'}`,
    '- 現在求人文はトーン・言い回しの参考に留め、内容の根拠は求人マスターを優先すること。',
    '',
    ...outputRules,
    '',
    '# タイトルのルール',
    '- 全角20〜40文字程度。求人マスターの強み(特に訴求軸に該当するもの)を活かす。',
    '- 求職者がクリックしたくなる具体性を持たせる。誇大表現・煽りは禁止。',
    '',
    '# 本文の構成ルール (掲載文として自然に)',
    '- 400〜800文字程度。ジョブメドレーの掲載文として自然なボリューム感にする。',
    '- 「#見出し」付きで、複数のまとまりに分ける。例:',
    '  #当院の特徴',
    '  #気になるお休みや有給は？',
    '  #成長環境について',
    '- 見出しは内容と訴求軸に合わせて自由に決めてよい(上記は例)。',
    '- 箇条書きは適度に使う。ただし強みの単純な羅列で終わらせず、各項目が求職者にとってどんな働き方・メリットになるかを一言添える。',
    '- 選択された訴求軸に応じて本文の比重を変える:',
    '  ・働きやすさ → 勤務時間・休日・有給を中心に厚く書く',
    '  ・教育制度 → マンツーマン研修・教育体制を中心に厚く書く',
    '  ・予防歯科 / 患者担当制 → 予防歯科・患者担当制を中心に厚く書く',
    '- 医院説明の羅列ではなく、求職者が「自分が働く姿」をイメージできる読みやすい文章にする。',
    '',
    '# 3案の差別化ルール (最重要)',
    '- 3案は単なる言い換えにしない。タイトル・本文ともに切り口を必ず変える。',
    '- 各案で使う見出し・書き出し・主役にする強みの組み合わせを変える。',
    `- 今回の訴求軸「${axis || '(指定なし)'}」に対する各案の切り口は次のとおり:`,
    `  ・案1 = ${diff[0]}`,
    `  ・案2 = ${diff[1]}`,
    `  ・案3 = ${diff[2]}`,
    '  ※ 各案で追加する要素は、求人マスターに存在する強みに限る。根拠が無ければ訴求軸内で別の見せ方(見出し・切り口)に変える。',
    '- タイトルは3案とも別案にし、同じキーワード(数値・フレーズ)を使い回さない。',
    '- 採用担当が3案を並べて見たときに「明確に別案だ」と感じるレベルまで差別化する。',
    '',
    '# 禁止事項 (再確認)',
    '- マスターと現在求人文に無い給与・休日・福利厚生・待遇などの事実を創作・追加しない',
    '- 事実と異なる内容を書かない',
    '- 他院批判・比較表現は使わない',
    '- 差別的表現は使わない',
    '- 「絶対」「No.1」「最強」などの誇大表現は使わない',
    '- NG表現は使わない',
    readable ? '- 指定の見出し付きテキスト形式以外で出力しない(JSON・コードブロック禁止)' : '- JSON以外の出力をしない'
  ].join('\n');

  return { system: systemPrompt, user: userPrompt };
}


function callOpenAIForJobText_(apiKey, master, input) {
  const prompt = buildJobTextPrompt_(master, input);
  const systemPrompt = prompt.system;
  const userPrompt = prompt.user;

  const payload = {
    model: OPENAI_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    temperature: 0.8,
    response_format: { type: 'json_object' }
  };

  const response = fetchOpenAIWithRetry_('https://api.openai.com/v1/chat/completions', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + apiKey },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  }, 'OpenAI API');

  const body = response.getContentText();
  const data = JSON.parse(body);
  const content = data && data.choices && data.choices[0] &&
    data.choices[0].message && data.choices[0].message.content;
  if (!content) {
    throw new Error('OpenAIからの応答が空でした。');
  }

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    throw new Error('OpenAI応答のJSONパースに失敗しました。\n' + content);
  }

  if (!parsed.ideas || !Array.isArray(parsed.ideas) || parsed.ideas.length === 0) {
    throw new Error('OpenAI応答に「ideas」配列がありません。');
  }
  parsed.ideas.forEach((idea, i) => {
    if (!idea || !String(idea.title || '').trim() || !String(idea.body || '').trim()) {
      throw new Error(`OpenAI応答の案${i + 1}に title / body がありません。`);
    }
  });
  return parsed;
}


function formatJobText_(result) {
  const ideas = (result && result.ideas) || [];
  const divider = '\n\n────────────────\n\n';
  const blocks = ideas.map((idea, i) => {
    return [
      `【求人案${i + 1}】`,
      '',
      'タイトル：',
      String(idea.title || '').trim(),
      '',
      '本文：',
      String(idea.body || '').trim()
    ].join('\n');
  });
  return blocks.join(divider);
}


// ===== スカウト文生成 (スカウト文生成シート) =====
function generateScoutText() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getActiveSheet();

  if (sheet.getName() !== SHEET_NAMES.SCOUT) {
    ui.alert(`「${SHEET_NAMES.SCOUT}」シートで実行してください。`);
    return;
  }

  const row = sheet.getActiveCell().getRow();
  if (row < 2) {
    ui.alert('データ行を選択してから実行してください。(1行目はヘッダー)');
    return;
  }

  const input = readScoutInput_(sheet, row);

  const outputCell = sheet.getRange(row, SCOUT_COL.AI_OUTPUT);
  outputCell.setValue('⏳ 生成中...');
  SpreadsheetApp.flush();

  try {
    const result = generateScoutTextCore(input.jobId, input.candidateProfile, {
      candidatePoint: input.candidatePoint,
      appeal: input.appeal
    });
    writeAiOutputCell_(outputCell, formatScout_(result));
    // 採用時に参照できるよう、生成結果をJSONで保持 (F列・手入力不要)
    sheet.getRange(row, SCOUT_COL.RESULT_JSON).setValue(JSON.stringify(result));
  } catch (e) {
    outputCell.setValue('');
    ui.alert(e.message);
  }
}


// スカウト文生成シートの選択行から入力値を取得
function readScoutInput_(sheet, row) {
  const rowValues = sheet.getRange(row, 1, 1, SCOUT_COL.AI_OUTPUT).getValues()[0];
  return {
    jobId: String(rowValues[SCOUT_COL.JOB_ID - 1] || '').trim(),
    candidateProfile: String(rowValues[SCOUT_COL.CANDIDATE_PROFILE - 1] || '').trim(),
    candidatePoint: String(rowValues[SCOUT_COL.CANDIDATE_POINT - 1] || '').trim(),
    appeal: String(rowValues[SCOUT_COL.APPEAL - 1] || '').trim()
  };
}


// ===== スカウト文プロンプト組み立て (共通) =====
// format: 'json'(API用・既定) / 'readable'(ChatGPT貼り付け用・見出し付きテキスト)
function buildScoutPrompt_(master, input, format) {
  const readable = format === 'readable';
  const systemPrompt = [
    'あなたはジョブメドレーの歯科医院採用に特化した、スカウト(ダイレクトリクルーティング)文面のプロです。',
    '単なる求人紹介ではなく、「なぜこの候補者に連絡したのか」「候補者の経験・希望と医院の強みがどう合うのか」が自然に伝わるスカウト文を書きます。',
    '',
    '【最重要】',
    '- 求人の強みを並べるだけにしない。必ず候補者の経験・興味・志向性と接続して書く。',
    '- 求人票・求人説明のような書き方は避け、候補者本人に送っている一人称のスカウト文にする。',
  ].join('\n');

  const workflowLines = [
    '【進め方】',
    '1. 候補者プロフィールから「興味」「強み」「志向性」を要約・抽出する。',
    '2. プロフィールを見て惹かれた点(なぜ連絡したか)を明確にする。',
    '3. 候補者の経験・興味・志向性と、求人マスターの強みが合う理由を言語化する。',
    '4. 合う理由を踏まえ、求人マスターの強みを2〜4個だけ、自然な文章の中で紹介する。',
    '5. 「候補者の気になった点」が未入力なら、プロフィールから魅力に感じる点を自動抽出する。',
    '6. 「今回特に訴求したい内容」が未入力なら、候補者像に最も響く強みを求人マスターから自動選定する。',
    '7. 上記の任意入力がある場合は、その内容を優先して反映する。',
    '8. 入力が空でも、候補者プロフィールと求人マスターだけで完成度の高いスカウト文を必ず生成する。',
    '',
    '【スカウト本文の構成(この順で4〜5段落・350〜550字程度)】',
    '1. 宛名(候補者プロフィールから氏名が分かる場合のみ「〇〇様」。分からなければ宛名を書かず、挨拶から始める)',
    '2. はじめましての挨拶(医院名・採用担当であること)',
    '3. プロフィールを見て惹かれた点(なぜ連絡したか)',
    '4. 候補者の経験・興味・志向性と、医院の強みが合う理由(接続文を必ず入れる)',
    '5. 医院の強みを2〜4個だけ、候補者との接続を保ったまま自然に紹介',
    '6. 「まずは一度お話しできれば」「お話しできれば」など、軽く次の一歩を促す締め(押し売りしない)',
    '',
    '【接続の書き方(必須)】',
    '悪い例: 当院では患者担当制を取り入れています。',
    '良い例: 予防処置やメンテナンス業務を大切にされてきた〇〇様には、患者様を継続して担当できる当院の患者担当制は合いやすいのではないかと感じました。',
    '悪い例: (休日数や有給取得率の数値をそのまま並べただけの文)',
    '良い例: 勤務時間や休日面も重視されているとのことでしたので、(求人情報に記載された休日・有給の値)の点も、長く働くうえで安心材料になるかと思います。',
    '※ 休日数・有給取得率・診療時間・給与などの数値は、上記「求人情報」に書かれた値をそのまま使うこと。',
    '  この指示文や例文に数値が現れても、それを流用してはならない。求人情報に無い数値は書かない。',
    '',
    '【件名】',
    '- 医院の特徴だけの羅列にしない。',
    '- 候補者の希望・経験に合う形で書く(例: 予防経験を活かして長く働ける環境です / 患者担当制で予防に関われる職場です)。',
    '- 全角25文字以内・開封したくなる自然な表現。',
    '',
    '【温度感】',
    '- 丁寧・自然・押し売り感を出さない・求人広告っぽくしすぎない。',
    '- 「ぜひ応募してください」より「一度お話しできれば」の温度感。',
    '- 候補者を褒めすぎない。誇大表現をしない。',
    '',
    '【絶対遵守】',
    '- 求人マスターに書かれていない給与・待遇・福利厚生・休日数などの事実は絶対に勝手に作らない/盛らない。',
    '- 事実と異なる内容・過度な約束はしない。',
    '- 他院批判・比較・「うちは違う」系の表現は禁止。',
    '- 「必ず」「絶対」「日本一」「No.1」「最高」「最強」などの誇大表現は使わない。',
    '- 差別的表現(若手限定・女性限定など)・特定の年齢/性別/容姿を貶める表現は使わない。',
    '- 候補者を過剰に持ち上げる表現は使わない。',
    '- 「今すぐ応募してください」のような強すぎる誘導は使わない。',
    '- 求人マスターのNG表現は使わない。',
    '',
    readable
      ? '【出力】下記「出力ルール」の見出し付きテキスト形式でそのまま返す。JSON・コードブロック・前置き/後書きは使わない。'
      : '【出力】必ず指定のJSON形式のみで返す。前置き・後書き・コードブロックは一切不要。'
  ];

  const fullSystemPrompt = systemPrompt + '\n' + workflowLines.join('\n');

  // 出力フォーマット (readable=人間向け見出し / json=API用)
  const outputRules = readable ? [
    '# 出力ルール',
    '- JSONでは出力しない。下記の見出し形式そのままで、読みやすいテキストとして返す。',
    '- 件名・本文はそれぞれ1案のみ。余計な前置き・後書きは書かない。',
    '',
    '【候補者プロフィール要約】',
    '興味：',
    '強み：',
    '志向性：',
    '',
    '【スカウト件名】',
    '(全角25文字以内。候補者の希望・経験に合う形で。医院特徴だけの羅列にしない)',
    '',
    '【スカウト本文】',
    '(4〜5段落・350〜550字程度。宛名→挨拶→惹かれた点→候補者と医院の接続→強み2〜4個→軽い締め。求人説明の羅列にしない)',
    '',
    '【AIが注目したポイント】',
    '(候補者のどこを見て、なぜ今回の求人と相性が良いと判断したかを2〜3文で。単なるプロフィール要約にしない)',
    '',
    '【訴求した強み】',
    '(候補者の希望に対して、どの強みをなぜ使ったかを2〜3文で。強みの羅列にしない)'
  ] : [
    '# 出力ルール',
    '- 必ず次のJSON構造で返す (件名・本文はそれぞれ1案のみ):',
    '  {',
    '    "candidate_summary": { "interest": "興味", "strength": "強み", "orientation": "志向性" },',
    '    "subject": "件名",',
    '    "body": "スカウト本文",',
    '    "appeal_point": "候補者のどこを見て、なぜ相性が良いと判断したか",',
    '    "used_strength": "候補者の希望に対して、どの強みをなぜ使ったか"',
    '  }',
    '- candidate_summary: 候補者プロフィールから抽出した 興味 / 強み / 志向性 (各1〜2文)',
    '- subject: スカウト件名 1案 (全角25文字以内。候補者の希望・経験に合う形。医院特徴だけの羅列にしない)',
    '- body: スカウト本文 1案 (4〜5段落・350〜550字。宛名→挨拶→惹かれた点→候補者と医院の接続→強み2〜4個→「まずはお話しできれば」系の軽い締め。各強みは候補者情報と接続すること)',
    '- appeal_point: 候補者のどこを見て、なぜ今回の求人と相性が良いと判断したかを2〜3文 (単なる要約にしない)',
    '- used_strength: 候補者の希望に対して、求人マスターのどの強みをなぜ使ったかを2〜3文 (羅列にしない)',
    '- 候補者の気になった点・今回特に訴求したい内容が指定されていれば必ず反映する。未入力なら自動で補って生成する',
    '- 件名・本文は最も効果的と判断できる1案に絞る。複数案は出さない'
  ];

  const userPrompt = [
    '以下の歯科医院求人と候補者情報をもとに、スカウト文を1案生成してください。',
    '求人紹介文ではなく、候補者本人に向けたスカウト文として書いてください。',
    '',
    '# 求人情報 (求人マスター ＝ 主データ・ここにない事実は書かない)',
    ...masterInfoLines_(master),
    '',
    '# 候補者情報',
    `- 候補者プロフィール【必須】: ${input.candidateProfile || '(指定なし)'}`,
    `- 候補者の気になった点【任意】: ${input.candidatePoint || '(未入力 → プロフィールから自動抽出すること)'}`,
    `- 今回特に訴求したい内容【任意】: ${input.appeal || '(未入力 → 求人マスターの強みから自動選定すること)'}`,
    '',
    '# 強みの選び方',
    '- 求人マスターはカテゴリ別(仕事内容/働きやすさ/教育制度/福利厚生/給与・待遇/その他の強み)に整理されている。',
    '- 候補者の関心・志向に合うカテゴリを1〜2個選び、本文では強みを多くても4つまでに絞る。',
    '- 各強みは「候補者の〇〇だから／〇〇を重視されているので」という形で接続してから紹介する。',
    '- 例: 子育て・ワークライフバランス志向→働きやすさ / 未経験・成長志向→教育制度 / 予防やキャリア志向→仕事内容。',
    '- 該当カテゴリが空欄の場合は創作せず、他カテゴリで最も近い強みを使う。',
    '',
    '# 本文のひな形(構成・温度感の目安。( )内は必ず具体的な内容に置き換えて書くこと)',
    '※ ひな形はあくまで型。( )の中身は、上記の求人情報と候補者情報からのみ作ること。',
    '(候補者名が分かる場合のみ)〇〇様',
    '',
    `はじめまして。${master.clinic || '当院'}の採用担当です。`,
    '',
    'プロフィールを拝見し、(候補者の経験・実績のうち、今回の求人と関係が深いもの)に惹かれ、ご連絡いたしました。',
    '',
    '(候補者が関心を持っている分野)に関心をお持ちで、(候補者が希望している働き方)を希望されている点は、当院の(求人情報に記載された該当する強み)とも相性が良いのではないかと感じています。',
    '',
    '当院では、(求人情報「仕事内容」に記載された強み)。また、(求人情報「働きやすさ」「福利厚生」に記載された内容。数値は求人情報に書かれた値のみ使う)と、無理なく長く働きやすい体制も整えています。',
    '',
    '今の働き方で感じていることや、今後どのような環境で働きたいかなど、まずは一度お話しできればと思います。',
    '',
    ...outputRules,
    '',
    '# 禁止事項 (再確認)',
    '- マスターに無い給与・待遇・休日・福利厚生などの事実を創作・追加しない',
    '- 給与・休日・福利厚生を実際以上に表現しない',
    '- 事実と異なる内容を書かない',
    '- 他院批判・比較表現は使わない',
    '- 差別的表現(若手限定・女性限定など)は使わない',
    '- 候補者を過剰に持ち上げる表現は使わない',
    '- 「必ず」「絶対」「最高」「最強」などの誇大表現は使わない',
    '- 「今すぐ応募してください」のような強すぎる誘導は使わない',
    '- NG表現は使わない',
    readable ? '- 指定の見出し付きテキスト形式以外で出力しない(JSON・コードブロック禁止)' : '- JSON以外の出力をしない'
  ].join('\n');

  return { system: fullSystemPrompt, user: userPrompt };
}


function callOpenAIForScout_(apiKey, master, input) {
  const prompt = buildScoutPrompt_(master, input);
  const systemPrompt = prompt.system;
  const userPrompt = prompt.user;

  const payload = {
    model: OPENAI_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    temperature: 0.8,
    response_format: { type: 'json_object' }
  };

  const response = fetchOpenAIWithRetry_('https://api.openai.com/v1/chat/completions', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + apiKey },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  }, 'OpenAI API');

  const body = response.getContentText();
  const data = JSON.parse(body);
  const content = data && data.choices && data.choices[0] &&
    data.choices[0].message && data.choices[0].message.content;
  if (!content) {
    throw new Error('OpenAIからの応答が空でした。');
  }

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    throw new Error('OpenAI応答のJSONパースに失敗しました。\n' + content);
  }

  // 1案構造(subject/body)を基本とし、旧構造(subjects/bodies配列)が来ても先頭を採用する
  const scoutSubject = parsed.subject || (Array.isArray(parsed.subjects) ? parsed.subjects[0] : '');
  const scoutBody = parsed.body || (Array.isArray(parsed.bodies) ? parsed.bodies[0] : '');
  if (!scoutSubject) {
    throw new Error('OpenAI応答に「subject」(件名)がありません。');
  }
  if (!scoutBody) {
    throw new Error('OpenAI応答に「body」(本文)がありません。');
  }
  parsed.subject = scoutSubject;
  parsed.body = scoutBody;
  return parsed;
}


// スカウト結果(JSON相当のオブジェクト)を、院長が読む前提の見やすいテキストに整形する。
// ※ JSONそのもの({ } [ ] "candidate_summary" 等)は一切表示しない。API版・JSON貼付版で共通利用。
function formatScout_(result) {
  const divider = '\n────────────────\n';
  const summary = result.candidate_summary || {};
  // 1案構造(subject/body)を基本。旧構造(subjects/bodies配列)が来ても先頭を表示
  const subject = result.subject || (Array.isArray(result.subjects) ? result.subjects[0] : '') || '';
  const body = result.body || (Array.isArray(result.bodies) ? result.bodies[0] : '') || '';
  const blocks = [];

  blocks.push([
    '【候補者プロフィール要約】',
    `興味　：${String(summary.interest || '').trim()}`,
    `強み　：${String(summary.strength || '').trim()}`,
    `志向性：${String(summary.orientation || '').trim()}`
  ].join('\n'));

  blocks.push(['【スカウト件名】', String(subject).trim()].join('\n'));
  blocks.push(['【スカウト本文】', String(body).trim()].join('\n'));
  blocks.push(['【AIが注目したポイント】', String(result.appeal_point || '').trim()].join('\n'));
  blocks.push(['【訴求した強み】', String(result.used_strength || '').trim()].join('\n'));

  return blocks.join(divider);
}


// ===== テストモード: プロンプトだけ出力 =====

// 画像案生成シート: AIへ送るプロンプトを組み立ててAI出力列に書き込む (API呼び出しなし)
function generateThumbnailPrompt() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getActiveSheet();

  if (sheet.getName() !== SHEET_NAMES.IDEA) {
    ui.alert(`「${SHEET_NAMES.IDEA}」シートで実行してください。`);
    return;
  }

  const row = sheet.getActiveCell().getRow();
  if (row < 2) {
    ui.alert('データ行を選択してから実行してください。(1行目はヘッダー)');
    return;
  }

  const rowValues = sheet.getRange(row, 1, 1, IDEA_COL.AI_OUTPUT).getValues()[0];
  const input = {
    jobId: String(rowValues[IDEA_COL.JOB_ID - 1] || '').trim(),
    photo: String(rowValues[IDEA_COL.PHOTO - 1] || '').trim(),
    axis: String(rowValues[IDEA_COL.AXIS - 1] || '').trim(),
    mood: String(rowValues[IDEA_COL.MOOD - 1] || '').trim()
  };

  if (!input.jobId) {
    ui.alert('求人IDが入力されていません。');
    return;
  }

  const master = lookupMaster_(ss, input.jobId);
  if (!master) {
    ui.alert(`求人マスターに ID「${input.jobId}」が見つかりません。`);
    return;
  }

  const missing = [];
  if (!master.clinic) missing.push('医院名');
  if (!master.position) missing.push('職種');
  if (!master.target) missing.push('ターゲット');
  if (!master.strength) missing.push('強み');
  if (missing.length > 0) {
    ui.alert(`求人マスターの必須項目が不足しています: ${missing.join(' / ')}`);
    return;
  }

  // 使用写真が写真IDなら写真マスターを参照 (該当なしなら null)
  input.photoInfo = input.photo ? lookupPhoto_(ss, input.photo) : null;

  const prompt = buildThumbnailPrompt_(master, input, 'readable');
  const text = formatPromptForSheet_(prompt);

  const outputCell = sheet.getRange(row, IDEA_COL.AI_OUTPUT);
  writeAiOutputCell_(outputCell, text);
}


// 求人文生成シート: AIへ送るプロンプトを組み立ててAI出力列に書き込む (API呼び出しなし)
function generateJobTextPrompt() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getActiveSheet();

  if (sheet.getName() !== SHEET_NAMES.JOB_TEXT) {
    ui.alert(`「${SHEET_NAMES.JOB_TEXT}」シートで実行してください。`);
    return;
  }

  const row = sheet.getActiveCell().getRow();
  if (row < 2) {
    ui.alert('データ行を選択してから実行してください。(1行目はヘッダー)');
    return;
  }

  const rowValues = sheet.getRange(row, 1, 1, JOB_TEXT_COL.AI_OUTPUT).getValues()[0];
  const input = {
    jobId: String(rowValues[JOB_TEXT_COL.JOB_ID - 1] || '').trim(),
    axis: String(rowValues[JOB_TEXT_COL.AXIS - 1] || '').trim(),
    currentText: String(rowValues[JOB_TEXT_COL.CURRENT_TEXT - 1] || '').trim(),
    note: String(rowValues[JOB_TEXT_COL.NOTE - 1] || '').trim()
  };

  if (!input.jobId) {
    ui.alert('求人IDが入力されていません。');
    return;
  }

  const master = lookupMaster_(ss, input.jobId);
  if (!master) {
    ui.alert(`求人マスターに ID「${input.jobId}」が見つかりません。`);
    return;
  }

  const missing = [];
  if (!master.clinic) missing.push('医院名');
  if (!master.position) missing.push('職種');
  if (!master.target) missing.push('ターゲット');
  if (!master.strength) missing.push('強み');
  if (missing.length > 0) {
    ui.alert(`求人マスターの必須項目が不足しています: ${missing.join(' / ')}`);
    return;
  }

  const prompt = buildJobTextPrompt_(master, input, 'readable');
  const text = formatPromptForSheet_(prompt);

  const outputCell = sheet.getRange(row, JOB_TEXT_COL.AI_OUTPUT);
  writeAiOutputCell_(outputCell, text);
}


// スカウト文生成シート: AIへ送るプロンプトを組み立ててAI出力列に書き込む (API呼び出しなし)
function generateScoutPrompt() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getActiveSheet();

  if (sheet.getName() !== SHEET_NAMES.SCOUT) {
    ui.alert(`「${SHEET_NAMES.SCOUT}」シートで実行してください。`);
    return;
  }

  const row = sheet.getActiveCell().getRow();
  if (row < 2) {
    ui.alert('データ行を選択してから実行してください。(1行目はヘッダー)');
    return;
  }

  const input = readScoutInput_(sheet, row);

  if (!input.jobId) {
    ui.alert('求人IDが入力されていません。');
    return;
  }
  if (!input.candidateProfile) {
    ui.alert('候補者プロフィールが入力されていません。');
    return;
  }

  const master = lookupMaster_(ss, input.jobId);
  if (!master) {
    ui.alert(`求人マスターに ID「${input.jobId}」が見つかりません。`);
    return;
  }

  const missing = scoutMasterMissing_(master);
  if (missing.length > 0) {
    ui.alert(`求人マスターの必須項目が不足しています: ${missing.join(' / ')}`);
    return;
  }

  const prompt = buildScoutPrompt_(master, input, 'readable');
  const text = formatPromptForSheet_(prompt);

  const outputCell = sheet.getRange(row, SCOUT_COL.AI_OUTPUT);
  writeAiOutputCell_(outputCell, text);
}


// API未接続用: AI出力列に貼り付けたスカウト文JSONを、見やすい形式に整形して書き戻す。
// (ChatGPT等でプロンプトを実行して得たJSONをE列に貼ってから実行する)
function formatScoutJsonInCell() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getActiveSheet();

  if (sheet.getName() !== SHEET_NAMES.SCOUT) {
    ui.alert(`「${SHEET_NAMES.SCOUT}」シートで実行してください。`);
    return;
  }

  const row = sheet.getActiveCell().getRow();
  if (row < 2) {
    ui.alert('データ行を選択してから実行してください。(1行目はヘッダー)');
    return;
  }

  const outputCell = sheet.getRange(row, SCOUT_COL.AI_OUTPUT);
  const raw = String(outputCell.getValue() || '').trim();
  if (!raw) {
    ui.alert('AI出力列が空です。\nスカウト文のJSONを貼り付けてから実行してください。');
    return;
  }

  const result = parseScoutJson_(raw);
  if (!result) {
    ui.alert('JSONとして読み取れませんでした。\nスカウト文プロンプトのAI回答(JSON)をそのまま貼り付けてください。');
    return;
  }

  writeAiOutputCell_(outputCell, formatScout_(result));
  // 採用時に参照できるよう、整形元のJSONをF列に保持
  sheet.getRange(row, SCOUT_COL.RESULT_JSON).setValue(JSON.stringify(result));
}


// ===== スカウト文の採用保存 =====
// 生成済み(または整形済み)のスカウト文を効果記録へ保存する。
function adoptScoutText() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getActiveSheet();

  if (sheet.getName() !== SHEET_NAMES.SCOUT) {
    ui.alert(`「${SHEET_NAMES.SCOUT}」シートで実行してください。`);
    return;
  }

  const row = sheet.getActiveCell().getRow();
  if (row < 2) {
    ui.alert('データ行を選択してから実行してください。(1行目はヘッダー)');
    return;
  }

  const rowValues = sheet.getRange(row, 1, 1, SCOUT_COL.RESULT_JSON).getValues()[0];
  const jobId = String(rowValues[SCOUT_COL.JOB_ID - 1] || '').trim();
  const resultJson = String(rowValues[SCOUT_COL.RESULT_JSON - 1] || '').trim();

  if (!jobId) {
    ui.alert('求人IDが入力されていません。');
    return;
  }
  if (!resultJson) {
    ui.alert('この行にはまだ生成済みのスカウト文がありません。\n先に「選択行のスカウト文を生成」または「スカウト文JSONを整形表示」を実行してください。');
    return;
  }

  let result;
  try {
    result = JSON.parse(resultJson);
  } catch (e) {
    ui.alert('スカウト文データの読み込みに失敗しました。\nお手数ですが生成をやり直してください。');
    return;
  }

  const master = lookupMaster_(ss, jobId);
  if (!master) {
    ui.alert(`求人マスターに ID「${jobId}」が見つかりません。`);
    return;
  }

  const subject = result.subject || (Array.isArray(result.subjects) ? result.subjects[0] : '') || '';
  const body = result.body || (Array.isArray(result.bodies) ? result.bodies[0] : '') || '';
  const memo = [
    `注目ポイント: ${result.appeal_point || ''}`,
    `訴求した強み: ${result.used_strength || ''}`
  ].join(' ／ ');

  try {
    saveEffectRecord({
      kind: 'SCOUT',
      jobId: jobId,
      clinic: master.clinic,
      position: master.position,
      ideaNo: '',
      axis: '',
      subject: String(subject),
      mainCopy: '',
      subCopy: '',
      body: String(body),
      canva: '',
      memo: memo
    });
  } catch (e) {
    ui.alert(e.message);
    return;
  }
  ui.alert('スカウト文を効果記録に保存しました。');
}


// 貼り付けテキストからスカウトJSONを取り出す。コードフェンス(```json 等)が付いていても除去する。
function parseScoutJson_(raw) {
  let text = raw.trim();
  // ```json ... ``` のようなコードフェンスを除去
  text = text.replace(/^```[a-zA-Z]*\s*/m, '').replace(/```$/m, '').trim();
  // 最初の { から最後の } までを抽出
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    text = text.substring(start, end + 1);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}


// system/user プロンプトを、そのままAIに貼れる見やすいテキストに整形
// ※ セル先頭が "=" だと Google Sheets が数式と解釈し #ERROR! になる。
//    "===== SYSTEM ..." は先頭文字が "=" のため、必ず非 "=" の行で始める。
function formatPromptForSheet_(prompt) {
  return [
    '【AI送信用プロンプト】',
    '（以下をそのまま ChatGPT / OpenAI に貼り付けてください）',
    '',
    '----- SYSTEM (役割・前提) -----',
    prompt.system,
    '',
    '----- USER (指示・入力) -----',
    prompt.user
  ].join('\n');
}


// AI出力列へ文字列として書き込む（数式解釈を防ぐ）
function writeAiOutputCell_(cell, text) {
  cell.setNumberFormat('@');
  cell.setValue(text);
  cell.setWrap(true);
  cell.setVerticalAlignment('top');
}


// ===== 開発用: ダミー案データ作成 =====
// API未接続でも採用機能をテストできるよう、選択行の F列に案1〜3のダミーJSON、
// E列に見やすいダミーAI出力を書き込む。本番のAI生成処理(callOpenAI_)には一切影響しない。
function createDummyIdeas() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getActiveSheet();

  if (sheet.getName() !== SHEET_NAMES.IDEA) {
    ui.alert(`「${SHEET_NAMES.IDEA}」シートで実行してください。`);
    return;
  }

  const row = sheet.getActiveCell().getRow();
  if (row < 2) {
    ui.alert('データ行を選択してから実行してください。(1行目はヘッダー)');
    return;
  }

  const ideas = getDummyIdeas_();

  sheet.getRange(row, IDEA_COL.IDEAS_JSON).setValue(JSON.stringify(ideas));

  const outputCell = sheet.getRange(row, IDEA_COL.AI_OUTPUT);
  const text = '【開発用ダミーデータ】\n' + formatIdeas_(ideas);
  outputCell.setValue(text);
  outputCell.setWrap(true);
  outputCell.setVerticalAlignment('top');

  ui.alert('ダミー案データを作成しました。\n「案1/2/3を採用」で効果記録に保存できます。');
}


// ===== APIキー設定用ダイアログ =====
function setApiKeyDialog() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt(
    'OpenAI APIキー設定',
    'OpenAI APIキー (sk-...) を入力してください。\n(スクリプトプロパティ OPENAI_API_KEY に保存されます)',
    ui.ButtonSet.OK_CANCEL
  );
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const key = res.getResponseText().trim();
  if (!key) {
    ui.alert('入力が空のため保存しませんでした。');
    return;
  }
  setScriptProperty_(SCRIPT_PROP.OPENAI_API_KEY, key);
  ui.alert('APIキーを保存しました。');
}


// 開発用ダミー画像案(3案)。メニュー版・Webアプリ版で共通利用。
function getDummyIdeas_() {
  return [
    {
      axis: '働きやすさ',
      main_copy: '残業ほぼなしで定時退社',
      sub_copy: 'プライベートも大切にできる歯科医院です',
      emphasis: '平日18:00終了・年間休日120日（マスター記載の範囲）',
      design_instruction: '写真を全面背景に使用。左上に半透明白帯を敷き、メインコピーを大きく配置。下部に細い帯でサブコピー。清潔感のある白×ミントグリーン。人物の顔は隠さない。',
      aim: '長時間労働を不安視する20〜30代に、働き方のゆとりを訴求する'
    },
    {
      axis: '教育制度',
      main_copy: '未経験から安心スタート',
      sub_copy: '先輩がマンツーマンでフォローします',
      emphasis: 'マンツーマン研修・教育体制（マスター記載の範囲）',
      design_instruction: '写真を中央に大きく配置。上部に細い半透明帯でサブコピー、下部に太帯でメインコピー。安心感のあるアイボリー×やわらかいブルー。',
      aim: '経験の浅い求職者に、研修・フォロー体制の手厚さで安心感を与える'
    },
    {
      axis: '予防歯科・患者担当制',
      main_copy: '担当制でじっくり関われる',
      sub_copy: '予防中心で患者さんと長く向き合えます',
      emphasis: '患者担当制・予防歯科への注力（マスター記載の範囲）',
      design_instruction: '写真を右側に配置し、左に縦組みの半透明帯。メイン→サブの順で縦積み。やさしいベージュ×グリーンで自然な印象。',
      aim: '丁寧な診療にやりがいを感じる層に、担当制・予防中心の働き方を訴求する'
    }
  ];
}


// ============================================================
// 初期設定チェック（移行・納品用）
// GASエディタから checkInstallStatus() を手動実行、または
// メニュー「初期設定チェック」/ Webアプリ開発者用エリアから実行。
// ============================================================

const INSTALL_CHECK_SHEETS_REQUIRED_ = ['MASTER', 'PHOTO', 'RECORD'];
const INSTALL_CHECK_SHEETS_WORK_ = ['IDEA', 'JOB_TEXT', 'SCOUT', 'CLINIC'];

function pushInstallCheckItem_(items, level, message) {
  items.push({ level: level, message: String(message || '') });
}

function summarizeInstallCheck_(items) {
  const summary = { ok: 0, warn: 0, ng: 0 };
  (items || []).forEach(function (item) {
    if (item.level === 'OK') summary.ok++;
    else if (item.level === 'WARN') summary.warn++;
    else summary.ng++;
  });
  return summary;
}

function formatInstallCheckReport_(items, summary) {
  const lines = (items || []).map(function (item) {
    const icon = item.level === 'OK' ? '✅ OK:' : (item.level === 'WARN' ? '⚠️ WARN:' : '❌ NG:');
    return icon + ' ' + item.message;
  });
  lines.push('');
  lines.push('初期設定チェック結果：');
  lines.push('OK ' + summary.ok + '件 / WARN ' + summary.warn + '件 / NG ' + summary.ng + '件');
  return lines.join('\n');
}

function checkSpreadsheetSheets_(ss, items) {
  INSTALL_CHECK_SHEETS_REQUIRED_.forEach(function (key) {
    const name = SHEET_NAMES[key];
    const sheet = ss.getSheetByName(name);
    if (sheet) {
      pushInstallCheckItem_(items, 'OK', name + ' が存在します');
    } else {
      pushInstallCheckItem_(items, 'NG', name + ' が見つかりません');
    }
  });
  INSTALL_CHECK_SHEETS_WORK_.forEach(function (key) {
    const name = SHEET_NAMES[key];
    const sheet = ss.getSheetByName(name);
    if (sheet) {
      pushInstallCheckItem_(items, 'OK', name + ' が存在します');
    } else {
      pushInstallCheckItem_(items, 'WARN', name + ' が見つかりません（シートメニュー運用時に必要）');
    }
  });
}

function checkUniqueIds_(sheet, idColumn, dataColumn, label, pattern, items) {
  if (!sheet || sheet.getLastRow() < 2) return;
  const values = sheet.getDataRange().getDisplayValues();
  const seen = {};
  let missingCount = 0;
  let invalidCount = 0;
  const duplicates = [];
  for (let i = 1; i < values.length; i++) {
    const id = String(values[i][idColumn - 1] || '').trim();
    const hasData = String(values[i][dataColumn - 1] || '').trim() !== '';
    if (!id) {
      if (hasData) missingCount++;
      continue;
    }
    if (pattern && !pattern.test(id)) invalidCount++;
    if (seen[id]) duplicates.push(id);
    else seen[id] = true;
  }
  if (duplicates.length) {
    pushInstallCheckItem_(items, 'NG', label + 'が重複しています: ' + Array.from(new Set(duplicates)).join(', '));
  } else {
    pushInstallCheckItem_(items, 'OK', label + 'の重複はありません');
  }
  if (missingCount) pushInstallCheckItem_(items, 'WARN', label + 'が空欄のデータ行が ' + missingCount + '件あります');
  if (invalidCount) pushInstallCheckItem_(items, 'WARN', label + 'の形式が想定外の行が ' + invalidCount + '件あります');
}

function checkMasterIdIntegrity_(ss, items) {
  const clinicSheet = ss.getSheetByName(SHEET_NAMES.CLINIC);
  const masterSheet = ss.getSheetByName(SHEET_NAMES.MASTER);
  const photoSheet = ss.getSheetByName(SHEET_NAMES.PHOTO);

  if (clinicSheet) {
    const columns = getClinicColumns_(clinicSheet);
    checkUniqueIds_(clinicSheet, columns.CLINIC_ID, columns.NAME, '医院ID', /^CLINIC\d+$/i, items);
  }
  if (masterSheet) {
    const columns = getMasterColumns_(masterSheet);
    // 求人IDは外部システムの形式を許容するため、形式チェックは行わない。
    checkUniqueIds_(masterSheet, columns.JOB_ID, columns.CLINIC, '求人ID', null, items);
  }
  if (photoSheet) {
    const columns = getPhotoColumns_(photoSheet);
    checkUniqueIds_(photoSheet, columns.PHOTO_ID, columns.CONTENT, '写真ID', /^PHOTO\d+$/i, items);
  }
}

function checkScriptProperties_(items) {
  const config = getAppConfig_();
  if (config.openaiApiKey) {
    pushInstallCheckItem_(items, 'OK', SCRIPT_PROP.OPENAI_API_KEY + ' が設定されています');
  } else {
    pushInstallCheckItem_(items, 'WARN', SCRIPT_PROP.OPENAI_API_KEY + ' が未設定です（API自動生成には必要）');
  }
  if (config.generatedImageFolderId) {
    pushInstallCheckItem_(items, 'OK', SCRIPT_PROP.GENERATED_IMAGE_FOLDER_ID + ' が設定されています');
  } else {
    pushInstallCheckItem_(items, 'WARN', SCRIPT_PROP.GENERATED_IMAGE_FOLDER_ID + ' が未設定です（初回画像保存時に自動作成されます）');
  }
  if (config.appMode) {
    pushInstallCheckItem_(items, 'OK', SCRIPT_PROP.APP_MODE + ' = ' + config.appMode);
  } else {
    pushInstallCheckItem_(items, 'WARN', SCRIPT_PROP.APP_MODE + ' が未設定です（既定: client）');
  }
  if (config.adminEmail) {
    pushInstallCheckItem_(items, 'OK', SCRIPT_PROP.ADMIN_EMAIL + ' が設定されています');
  } else {
    pushInstallCheckItem_(items, 'WARN', SCRIPT_PROP.ADMIN_EMAIL + ' が未設定です');
  }
}

function checkDriveFolderAccess_(items) {
  const folderId = getScriptProperty_(SCRIPT_PROP.GENERATED_IMAGE_FOLDER_ID);
  if (folderId) {
    try {
      const folder = DriveApp.getFolderById(folderId);
      pushInstallCheckItem_(items, 'OK', '画像保存先フォルダにアクセスできます（' + folder.getName() + '）');
      return;
    } catch (e) {
      pushInstallCheckItem_(items, 'NG', 'GENERATED_IMAGE_FOLDER_ID のフォルダにアクセスできません（ID: ' + folderId + '）');
      return;
    }
  }
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const ssFile = DriveApp.getFileById(ss.getId());
    const parents = ssFile.getParents();
    if (!parents.hasNext()) {
      pushInstallCheckItem_(items, 'WARN', '画像保存先フォルダIDが未設定で、スプレッドシートの親フォルダを特定できません');
      return;
    }
    parents.next().getName();
    pushInstallCheckItem_(items, 'WARN', '画像保存先フォルダIDが未設定です（初回保存時に「' + GENERATED_IMAGE_FOLDER_NAME + '」を自動作成します）');
  } catch (e) {
    pushInstallCheckItem_(items, 'NG', 'Drive保存先の確認に失敗しました: ' + e.message);
  }
}

function getFirstPhotoFromMaster_(ss) {
  const sheet = ss.getSheetByName(SHEET_NAMES.PHOTO);
  if (!sheet) return null;
  const values = sheet.getDataRange().getValues();
  const columns = getPhotoColumns_(sheet);
  for (let i = 1; i < values.length; i++) {
    const photoId = String(values[i][columns.PHOTO_ID - 1] || '').trim();
    if (!photoId) continue;
    return {
      photoId: photoId,
      imageUrl: String(values[i][columns.IMAGE_URL - 1] || '').trim()
    };
  }
  return null;
}

function checkPhotoUrlAccess_(ss, items) {
  const photo = getFirstPhotoFromMaster_(ss);
  if (!photo) {
    pushInstallCheckItem_(items, 'WARN', '写真マスターにデータ行がありません（画像URLの確認をスキップ）');
    return;
  }
  if (!photo.imageUrl) {
    pushInstallCheckItem_(items, 'WARN', '写真マスター先頭行（' + photo.photoId + '）の画像URLが空です');
    return;
  }
  const fetchUrl = normalizeImageUrl_(photo.imageUrl);
  if (!fetchUrl) {
    pushInstallCheckItem_(items, 'NG', '写真マスター先頭行（' + photo.photoId + '）の画像URL形式が不正です');
    return;
  }
  try {
    const response = UrlFetchApp.fetch(fetchUrl, {
      muteHttpExceptions: true,
      followRedirects: true
    });
    const code = response.getResponseCode();
    if (code >= 200 && code < 300) {
      const bytes = response.getBlob().getBytes();
      if (bytes && bytes.length > 0) {
        const driveId = extractDriveFileId_(photo.imageUrl);
        const kind = driveId ? 'Drive URL' : '外部URL';
        pushInstallCheckItem_(items, 'OK', '写真マスター先頭行（' + photo.photoId + '）の画像URLを取得できました（' + kind + '）');
      } else {
        pushInstallCheckItem_(items, 'NG', '写真マスター先頭行（' + photo.photoId + '）から空の画像が返されました');
      }
    } else {
      pushInstallCheckItem_(items, 'NG', '写真マスター先頭行（' + photo.photoId + '）の画像URL取得に失敗しました（HTTP ' + code + '）');
    }
  } catch (e) {
    pushInstallCheckItem_(items, 'NG', '写真マスター先頭行（' + photo.photoId + '）の画像URL取得に失敗しました: ' + e.message);
  }
}

function checkWebAppReadiness_(ss, items) {
  try {
    const name = ss.getName();
    pushInstallCheckItem_(items, 'OK', 'スプレッドシート「' + name + '」にバインドされています');
  } catch (e) {
    pushInstallCheckItem_(items, 'NG', 'スプレッドシートへのアクセスに失敗しました: ' + e.message);
    return;
  }
  try {
    const jobs = getJobOptionsForWeb();
    if (jobs.length > 0) {
      pushInstallCheckItem_(items, 'OK', '求人マスターに ' + jobs.length + ' 件の求人IDがあります');
    } else {
      pushInstallCheckItem_(items, 'WARN', '求人マスターに求人IDが登録されていません');
    }
  } catch (e) {
    pushInstallCheckItem_(items, 'NG', 'Webアプリ用求人一覧の取得に失敗しました: ' + e.message);
  }
}

// 初期設定チェック（GASエディタから手動実行可）。Logger.log に結果を出力する。
function checkInstallStatus() {
  const items = [];
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  checkSpreadsheetSheets_(ss, items);
  checkMasterIdIntegrity_(ss, items);
  checkScriptProperties_(items);
  checkDriveFolderAccess_(items);
  checkPhotoUrlAccess_(ss, items);
  checkWebAppReadiness_(ss, items);
  const summary = summarizeInstallCheck_(items);
  const report = formatInstallCheckReport_(items, summary);
  Logger.log(report);
  return { items: items, summary: summary, report: report };
}

// スプレッドシートメニュー用（結果をダイアログ表示）
function checkInstallStatusWithAlert() {
  const result = checkInstallStatus();
  const ui = SpreadsheetApp.getUi();
  const text = result.report.length > 1800
    ? result.report.substring(0, 1800) + '\n...(続きは実行ログを確認してください)'
    : result.report;
  ui.alert('初期設定チェック', text, ui.ButtonSet.OK);
}

// Webアプリ開発者用エリアから呼び出す
function checkInstallStatusForWeb() {
  return checkInstallStatus();
}

// ============================================================
// GAS Webアプリ
// ------------------------------------------------------------
// doGet で Index.html を返す。HTML側からは google.script.run で
// 下記 *ForWeb 関数を呼び出す。いずれも UI(SpreadsheetApp.getUi) に
// 依存せず、戻り値 or 例外(throw)で結果を返す。例外メッセージは
// HTML側の withFailureHandler で画面に赤文字表示する。
// ============================================================

function doGet(e) {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('JobMedley 制作支援ツール')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// 求人マスターから求人ID選択肢を返す ([{ jobId, clinic, position, label }])
// label 例: CLINIC_A_DH｜〇〇歯科医院｜歯科衛生士
function getJobOptionsForWeb() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.MASTER);
  if (!sheet) throw new Error(`「${SHEET_NAMES.MASTER}」シートが見つかりません。`);
  const values = sheet.getDataRange().getValues();
  const columns = getMasterColumns_(sheet);
  const out = [];
  for (let i = 1; i < values.length; i++) {
    const jobId = String(values[i][columns.JOB_ID - 1] || '').trim();
    if (!jobId) continue;
    const clinicId = String(values[i][columns.CLINIC_ID - 1] || '').trim();
    const clinicMaster = clinicId ? lookupClinic_(ss, clinicId) : null;
    const clinic = clinicMaster && clinicMaster.name
      ? clinicMaster.name
      : String(values[i][columns.CLINIC - 1] || '').trim();
    const position = String(values[i][columns.POSITION - 1] || '').trim();
    out.push({
      jobId: jobId,
      clinic: clinic,
      position: position,
      label: [jobId, clinic, position].filter(function (v) { return v; }).join('｜')
    });
  }
  return out;
}

// 求人文生成「訴求軸」プルダウンの選択肢をWebアプリへ渡す
function getJobAxisOptionsForWeb() {
  return JOB_AXIS_OPTIONS.slice();
}

// 写真マスターの一覧をWebアプリへ渡す (使用写真プルダウン用)
// jobId を渡すと、医院名が一致する写真を優先的に返す(全件も含める)。
function getPhotoOptionsForWeb(jobId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.PHOTO);
  if (!sheet) return [];
  const master = jobId ? lookupMaster_(ss, jobId) : null;
  const targetClinic = master ? String(master.clinic || '').trim() : '';
  const targetClinicId = master ? String(master.clinicId || '').trim() : '';
  const values = sheet.getDataRange().getValues();
  const columns = getPhotoColumns_(sheet);
  const out = [];
  for (let i = 1; i < values.length; i++) {
    const photoId = String(values[i][columns.PHOTO_ID - 1] || '').trim();
    if (!photoId) continue;
    // 使用可否がFALSEの写真は候補から除外 (空欄/TRUEは使用可)
    const usable = String(values[i][columns.USABLE - 1] || '').trim().toUpperCase();
    if (usable === 'FALSE' || usable === '×' || usable === 'NG') continue;
    const content = String(values[i][columns.CONTENT - 1] || '').trim();
    const appeal = String(values[i][columns.APPEAL - 1] || '').trim();
    const clinic = String(values[i][columns.CLINIC - 1] || '').trim();
    const clinicId = String(values[i][columns.CLINIC_ID - 1] || '').trim();
    // 医院ID同士が揃っていればIDで一致判定、無ければ従来通り医院名で判定
    const sameClinic = (targetClinicId && clinicId)
      ? (clinicId === targetClinicId)
      : (targetClinic ? (clinic === targetClinic) : false);
    out.push({
      photoId: photoId,
      clinic: clinic,
      content: content,
      appeal: appeal,
      // 表示・保存用ラベル: 「PHOTO001｜笑顔のスタッフ集合写真｜働きやすさ」
      label: [photoId, content, appeal].filter(function (v) { return v; }).join('｜'),
      sameClinic: sameClinic
    });
  }
  // 医院一致を上に並べる
  out.sort(function (a, b) { return (b.sameClinic ? 1 : 0) - (a.sameClinic ? 1 : 0); });
  return out;
}

// 写真マスター1件の詳細をWeb表示用に返す（プレビュー・詳細情報）
function getPhotoDetailForWeb(photoId) {
  if (!photoId) return null;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const photoInfo = lookupPhoto_(ss, photoId);
  if (!photoInfo) return null;
  const imageUrl = String(photoInfo.imageUrl || '').trim();
  const openUrl = toPhotoOpenUrl_(imageUrl) || imageUrl;
  return {
    photoId: photoInfo.photoId,
    content: photoInfo.content || '',
    photoType: inferPhotoType_(photoInfo),
    impression: photoInfo.impression || '',
    appeal: photoInfo.appeal || '',
    note: photoInfo.note || '',
    imageUrl: imageUrl,
    previewUrl: toPhotoPreviewUrl_(imageUrl),
    openUrl: openUrl
  };
}

// 画像案3案を生成 (API)。input: { jobId, photo, axis, mood }
function generateThumbnailIdeasForWeb(input) {
  input = input || {};
  return generateThumbnailIdeasCore(input.jobId, {
    photo: input.photo || '',
    axis: input.axis || '',
    mood: input.mood || ''
  });
}

// 画像案3案のダミーを返す (API未接続テスト用)。求人ID/APIキー不要。
function createDummyIdeasForWeb(input) {
  return getDummyIdeas_();
}

// 画像案を効果記録へ保存。payload: { jobId, ideaNo, idea, generatedImageUrl?, imageGenPromptSummary? }
function adoptImageIdeaForWeb(payload) {
  payload = payload || {};
  const idea = normalizeIdea_(payload.idea || {});
  const master = adoptLookupMaster_(payload.jobId);
  const hasGeneratedImage = !!payload.generatedImageUrl;

  const memoParts = [
    `強調情報: ${idea.emphasis || ''}`,
    `デザイン指示: ${idea.design_instruction || ''}`,
    `狙い: ${idea.aim || ''}`
  ];
  if (hasGeneratedImage) {
    memoParts.push(`生成画像URL: ${payload.generatedImageUrl}`);
  }

  saveEffectRecord({
    kind: 'IMAGE',
    jobId: payload.jobId,
    clinic: master.clinic,
    position: master.position,
    ideaNo: payload.ideaNo ? `案${payload.ideaNo}` : '',
    axis: idea.axis || '',
    subject: '',
    mainCopy: idea.main_copy || '',
    subCopy: idea.sub_copy || '',
    body: hasGeneratedImage ? (payload.imageGenPromptSummary || '') : '',
    canva: hasGeneratedImage ? '【画像生成】' : (idea.design_instruction || ''),
    memo: memoParts.join(' ／ ')
  });
  return {
    ok: true,
    message: hasGeneratedImage
      ? '生成画像を効果記録に保存しました。'
      : '画像案を効果記録に保存しました。'
  };
}

// 手動画像生成用プロンプトを返す（ChatGPT貼り付け用）。payload: { jobId, photo, idea, ideaNo }
function generateManualImagePromptForWeb(payload) {
  payload = payload || {};
  if (!payload.jobId) throw new Error('求人IDが指定されていません。');
  if (!payload.idea) throw new Error('画像案が指定されていません。');
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const master = requireMaster_(ss, payload.jobId);
  const photoInfo = payload.photo ? lookupPhoto_(ss, payload.photo) : null;
  return buildManualImagePrompt_(master, photoInfo, payload.idea, payload.ideaNo, {
    selectedAxis: payload.selectedAxis || ''
  });
}

// 基本運用：API不要で画像生成用完成プロンプトを3本生成。input: { jobId, photo, axis, mood }
// 各要素に正規化済みの idea を添え、採用した案を効果記録へ保存できるようにする。
function generateManualImagePromptBundleForWeb(input) {
  input = input || {};
  if (!input.jobId) throw new Error('求人IDが指定されていません。');
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const master = requireMaster_(ss, input.jobId);
  const photoInfo = input.photo ? lookupPhoto_(ss, input.photo) : null;
  const ideas = normalizeIdeas_(
    buildManualImageIdeasWithoutApi_(master, photoInfo, {
      axis: input.axis || '',
      mood: input.mood || ''
    }),
    { master: master, photoInfo: photoInfo }
  );
  const items = buildManualImagePromptsForAllIdeas_(master, photoInfo, ideas, {
    selectedAxis: input.axis || ''
  });
  return items.map(function (item, i) {
    return { ideaNo: item.ideaNo, prompt: item.prompt, idea: ideas[i] };
  });
}

// 手動画像生成用プロンプトを3件まとめて返す。payload: { jobId, photo, ideas, selectedAxis? }
function generateManualImagePromptsForWeb(payload) {
  payload = payload || {};
  if (!payload.jobId) throw new Error('求人IDが指定されていません。');
  if (!payload.ideas || !payload.ideas.length) {
    throw new Error('表示中の画像案がありません。先に画像案を表示してください。');
  }
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const master = requireMaster_(ss, payload.jobId);
  const photoInfo = payload.photo ? lookupPhoto_(ss, payload.photo) : null;
  return buildManualImagePromptsForAllIdeas_(master, photoInfo, payload.ideas, {
    selectedAxis: payload.selectedAxis || ''
  });
}

// 画像生成前の確認画面用データを返す。payload: { jobId, photo, idea, ideaNo, axis? }
function getImageGenConfirmDataForWeb(payload) {
  payload = payload || {};
  if (!payload.jobId) throw new Error('求人IDが指定されていません。');
  if (!payload.photo) throw new Error('使用写真が指定されていません。');
  if (!payload.idea) throw new Error('画像案が指定されていません。');

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const master = requireMaster_(ss, payload.jobId);
  const photoInfo = lookupPhoto_(ss, payload.photo);
  if (!photoInfo) throw new Error('写真マスターに該当する写真が見つかりません。');

  const ideaNo = payload.ideaNo || 1;
  const ideaType = ideaTypeByIndex_(ideaNo - 1);
  const idea = normalizeIdea_(payload.idea, { master: master, photoInfo: photoInfo, ideaType: ideaType });
  const photoDetail = getPhotoDetailForWeb(payload.photo);

  return {
    ok: true,
    jobId: payload.jobId,
    clinic: master.clinic || '',
    position: master.position || '',
    photoId: payload.photo,
    axis: String(payload.axis || idea.axis || '').trim(),
    ideaNo: ideaNo,
    ideaAxis: idea.axis || '',
    mainCopy: idea.main_copy || '',
    subCopy: idea.sub_copy || '',
    emphasis: idea.emphasis || '',
    designInstruction: idea.design_instruction || '',
    photoPreviewUrl: photoDetail ? (photoDetail.previewUrl || '') : '',
    photoOpenUrl: photoDetail ? (photoDetail.openUrl || photoDetail.imageUrl || '') : ''
  };
}

// 選択案1件を画像生成 (Web)。payload: { jobId, photo, idea, ideaNo }
function generateJobThumbnailImageForWeb(payload) {
  payload = payload || {};
  if (!payload.jobId) return imageGenWebFailure_(new Error('求人IDが指定されていません。'));
  if (!payload.photo) return imageGenWebFailure_(imageGenError_('PHOTO_URL_FETCH_FAILED', '使用写真が指定されていません。'));
  if (!payload.idea) return imageGenWebFailure_(new Error('画像案が指定されていません。'));
  try {
    const data = generateJobThumbnailImageCore(payload.jobId, payload.photo, payload.idea, {
      ideaNo: payload.ideaNo
    });
    return { ok: true, data: data };
  } catch (e) {
    return imageGenWebFailure_(e);
  }
}

// 求人文を生成 (API)。input: { jobId, axis, currentText, note }
function generateJobTextForWeb(input) {
  input = input || {};
  return generateJobTextCore(input.jobId, {
    axis: input.axis || '',
    currentText: input.currentText || '',
    note: input.note || ''
  });
}

// 求人文(タイトル+本文)を効果記録へ保存。payload: { jobId, ideaNo, axis, title, body }
function adoptJobTextForWeb(payload) {
  payload = payload || {};
  const master = adoptLookupMaster_(payload.jobId);
  saveEffectRecord({
    kind: 'JOB_TEXT',
    jobId: payload.jobId,
    clinic: master.clinic,
    position: master.position,
    ideaNo: payload.ideaNo ? `求人案${payload.ideaNo}` : '求人案',
    axis: payload.axis || '',
    subject: '',
    mainCopy: payload.title || '',
    subCopy: '',
    body: payload.body || '',
    canva: '',
    memo: '求人タイトル+本文を採用'
  });
  return { ok: true, message: `求人案${payload.ideaNo || ''}(タイトル+本文)を効果記録に保存しました。` };
}

// スカウト文を効果記録へ保存。payload: { jobId, subject, body, appealPoint, usedStrength }
function adoptScoutTextForWeb(payload) {
  payload = payload || {};
  const master = adoptLookupMaster_(payload.jobId);
  const subject = String(payload.subject || '').trim();
  const body = String(payload.body || '').trim();
  if (!subject && !body) {
    throw new Error('保存できるスカウト文がありません。先にスカウト文を生成してください。');
  }
  const memo = [
    `注目ポイント: ${payload.appealPoint || ''}`,
    `訴求した強み: ${payload.usedStrength || ''}`
  ].join(' ／ ');
  saveEffectRecord({
    kind: 'SCOUT',
    jobId: payload.jobId,
    clinic: master.clinic,
    position: master.position,
    ideaNo: '',
    axis: '',
    subject: subject,
    mainCopy: '',
    subCopy: '',
    body: body,
    canva: '',
    memo: memo
  });
  return { ok: true, message: 'スカウト文を効果記録に保存しました。' };
}

// スカウト文を1案生成 (API)。input: { jobId, profile, candidatePoint, appeal }
function generateScoutTextForWeb(input) {
  input = input || {};
  return generateScoutTextCore(input.jobId, input.profile, {
    candidatePoint: input.candidatePoint || '',
    appeal: input.appeal || ''
  });
}

// 採用保存用の求人マスター取得 (Webから呼ぶ用・例外を投げる)
function adoptLookupMaster_(jobId) {
  if (!jobId) throw new Error('求人IDが指定されていません。');
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const master = lookupMaster_(ss, jobId);
  if (!master) throw new Error(`求人マスターに ID「${jobId}」が見つかりません。`);
  return master;
}


// ------------------------------------------------------------
// Webアプリ「プロンプト生成モード」(OpenAI API未接続時に利用)
// 既存の build*Prompt_ を再利用し、ChatGPTにそのまま貼れる文字列を返す。
// API接続版(generate*ForWeb)は残してあり、将来そちらに戻せる。
// ------------------------------------------------------------

// system/user プロンプトを、Web表示・コピー用の1つの文字列に結合する
function combinePromptForWeb_(prompt) {
  return [
    '----- SYSTEM（役割・前提） -----',
    prompt.system,
    '',
    '----- USER（指示・入力） -----',
    prompt.user
  ].join('\n');
}

// 画像案プロンプトを生成して返す。input: { jobId, photo, axis, mood }
function generateThumbnailPromptForWeb(input) {
  input = input || {};
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const master = requireMaster_(ss, input.jobId);
  const photoInfo = input.photo ? lookupPhoto_(ss, input.photo) : null;
  const prompt = buildThumbnailPrompt_(master, {
    photo: input.photo || '',
    axis: input.axis || '',
    mood: input.mood || '',
    photoInfo: photoInfo
  }, 'readable');
  return combinePromptForWeb_(prompt);
}

// 求人文プロンプトを生成して返す。input: { jobId, currentText, appeal, note }
function generateJobTextPromptForWeb(input) {
  input = input || {};
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const master = requireMaster_(ss, input.jobId);
  const prompt = buildJobTextPrompt_(master, {
    axis: input.axis || '',
    currentText: input.currentText || '',
    note: input.note || ''
  }, 'readable');
  return combinePromptForWeb_(prompt);
}

// スカウト文プロンプトを生成して返す。input: { jobId, profile, candidatePoint, appeal }
// 任意項目(candidatePoint/appeal)が空でも、build側でAI自動抽出・自動選定の指示が入る。
function generateScoutPromptForWeb(input) {
  input = input || {};
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!input.profile) throw new Error('候補者プロフィールが入力されていません。');
  const master = requireMaster_(ss, input.jobId);
  const prompt = buildScoutPrompt_(master, {
    candidateProfile: input.profile,
    candidatePoint: input.candidatePoint || '',
    appeal: input.appeal || ''
  }, 'readable');
  return combinePromptForWeb_(prompt);
}
