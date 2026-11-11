/**
 * フォームの回答を各フェーズ専用シートに整理して転記する。
 * 
 * 各フェーズごとに固定のヘッダーを持つシートを作成し、
 * 該当する質問項目のみを抽出して転記します。
 */

// 各フェーズに必要な質問項目の定義
var PHASE_QUESTIONS = {
  '現場調査': [
    'タイムスタンプ',
    '提出者氏名',
    '既存現場から入力',
    '新規現場を入力',
    '会社名　',
    '担当者名',
    '元請け',
    '一次',
    '③ 依頼趣旨',
    '④ 着工予定日',
    '⑤ 現場名',
    '階高',
    '平米数',
    '棟数',
    '⑦ 施工予定足場種類',
    '⑧ 昇降の設置場所',
    '⑨ 朝顔養生',
    '⑩ 資材置き場の予定地',
    '⑪ 敷地外、越境など',
    '⑫ 道路使用、道路占有',
    '⑬ 高圧線、電線養生',
    '⑭ 道路規制',
    '⑮ 搬入車両',
    ' 施工案・コメント',
    '⑯ 要注意事項',
    '【重要】記録・アップロード',
    '現調時写真'
  ],
  
  '仮設計画打合わせ': [
    'タイムスタンプ',
    '提出者氏名',
    '既存現場から入力',
    '新規現場を入力',
    '元請け',
    '一次',
    'ニ次',
    '三次',
    '② 現場名',
    '③ 着工日',
    '④ 施工班',
    '階高',
    '平米数',
    '棟数',
    '⑥ 施工予定足場種類',
    '⑦ 昇降の設置場所',
    '⑧ 朝顔養生',
    '⑨ 資材置き場の予定地',
    '⑩ 敷地外、越境など',
    '⑪ 道路使用、道路占有',
    '⑫ 高圧線、電線養生',
    '⑬ 道路規制',
    '⑭ 搬入車両',
    '⑮ 要注意事項',
    '⑯ 打合わせ内容',
    '⑰ 現地調査時の引継ぎがなされているか',
    '⑱ 最終発注者とすり合わせ議事録作成',
    '【重要】記録・アップロード'
  ],
  
  '送り出し教育': [
    'タイムスタンプ',
    '提出者氏名',
    '既存現場から入力',
    '新規現場を入力',
    '① 送り出し教育実施報告書の内容に対して○（良・否）がついているかどうか',
    '② 送り出し教育実施報告書の裏面に一人一人サインが記載されているか',
    '③ 仮設計画図（確認）',
    '④ 災害・事故を防ぐサンプル建設ルール',
    '⑤ 進捗状況報告LINE　注意事項',
    '⑥ ペナルティ動画撮影内容説明',
    '⑦ 足場組立・揚重機使用時の作業手順',
    '⑧ 足場組立・解体作業に基く追加手順',
    '⑨ ウィンチ作業手順マニュアル',
    '⑩ ロープ玉掛けマニュアル',
    '⑪ 次世代シートアサガオのハピネスの取り付け・取り外し手順',
    '⑫ 当現場における重要ポイント（上席の確認済みか）',
    '⑬ ウェラブルカメラで撮影、議事録作成',
    '【重要】記録・アップロード'
  ],
  
  '解体前教育': [
    'タイムスタンプ',
    '提出者氏名',
    '既存現場から入力',
    '新規現場を入力',
    '① 元請業者名',
    '② 現場名',
    '③ 着工日',
    '④ 施工班',
    '⑤ 平米数',
    '⑥ 使用部材・仕様',
    '⑦ 施工内容',
    '⑧ 打合わせ内容',
    '⑨ 注意・重要ポイント',
    '⑩ ウェラブルカメラで撮影、議事録作成',
    '【重要】記録・アップロード'
  ],
  
  '足場工区点検': [
    'タイムスタンプ',
    '提出者氏名',
    '既存現場から入力',
    '新規現場を入力',
    '① 点検実施日',
    '② 点検者氏名',
    '③ 元方事業者',
    '④ 工事名称',
    '会社名',
    '職長名',
    '⑥ 点検チェックシート記入',
    '⑦ チェックシートを現場事務所へ提出',
    '⑧ 指摘事項の資料作成',
    '⑨ 指摘事項の資料を施工業者へ伝達、指示',
    '⑩ 是正した箇所の写真を施工業者から受け取り指摘事項資料に添付',
    '⑪ 添付写真が揃い次第、元請け業者へ資料を共有',
    '⑫ ウェラブルカメラで撮影、議事録作成',
    '【重要】記録・アップロード'
  ],
  
  '稼働現場巡回': [
    'タイムスタンプ',
    '提出者氏名',
    '既存現場から入力',
    '新規現場を入力',
    '① 点検実施日',
    '② 点検者氏名',
    '③ 元方事業者',
    '④ 工事名称',
    '会社名',
    '職長名',
    '⑥ 現場送り出し教育チェック欄',
    '⑦ サンプル建設送り出し教育チェック欄',
    '⑧ サンプル建設足場講習チェック欄',
    '⑨ サンプル建設ルールチェック欄',
    '⑩ 点検内容の判定欄に○がついてるかどうか',
    '⑪ 裏面に是正内容・注意事項が記載されているか',
    '⑫ 担当者が工区点検に不備がないか確認',
    '⑬ 安全書類・名簿確認',
    '⑭ ウェラブルカメラで撮影、議事録作成',
    '【重要】記録・アップロード'
  ],
  
  '安全衛生協議会': [
    'タイムスタンプ',
    '提出者氏名',
    '既存現場から入力',
    '新規現場を入力',
    '① 安全衛生協議会実施日',
    '② 現場名',
    '③ 元方事業者',
    '④ 施工班',
    '⑤ 現場安全巡回',
    '⑥ 協議会資料の確認',
    '⑦ 工程表の確認',
    '⑧ その他、伝達事項',
    '【重要】記録・アップロード'
  ]
};

/**
 * フォーム送信時に実行される関数
 */
function separateSheetByBusiness_Fixed(e) {
  if (!e || !e.namedValues) {
    Logger.log('separateSheetByBusiness_Fixed: No event or namedValues');
    return;
  }
  
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var srcSheet = e.range.getSheet();
  
  // 業務名を取得
  var phaseAnswer = e.namedValues['実施する業務を選択してください'];
  if (!phaseAnswer || !phaseAnswer[0]) {
    Logger.log('separateSheetByBusiness_Fixed: 実施する業務を選択してください が見つかりません');
    return;
  }
  
  var phaseName = phaseAnswer[0];
  Logger.log('separateSheetByBusiness_Fixed: フェーズ = ' + phaseName);
  
  // このフェーズに必要な質問項目を取得
  var requiredQuestions = PHASE_QUESTIONS[phaseName];
  if (!requiredQuestions) {
    Logger.log('separateSheetByBusiness_Fixed: ' + phaseName + 'の質問項目が定義されていません');
    return;
  }
  
  // 元シートのヘッダーを取得
  var allHeaders = srcSheet.getRange(1, 1, 1, srcSheet.getLastColumn()).getValues()[0];
  
  // ヘッダーと列インデックスのマッピングを作成
  var headerMap = {};
  for (var i = 0; i < allHeaders.length; i++) {
    headerMap[allHeaders[i]] = i;
  }
  
  // フェーズ専用シートを取得または作成
  var config = getConfig();
  var phaseConfig = config.FORMS.find(function(f) { return f.phaseIndicatorValue === phaseName; });
  var targetSheetName = phaseConfig ? phaseConfig.name : phaseName;
  
  var targetSheet = ss.getSheetByName(targetSheetName);
  if (!targetSheet) {
    targetSheet = ss.insertSheet(targetSheetName);
    // ヘッダー行を作成
    targetSheet.appendRow(requiredQuestions);
    
    // プロフェッショナルなデザインを適用
    var lastCol = requiredQuestions.length;
    targetSheet.getRange(1, 1, 1, lastCol)
      .setBackground('#1a237e')
      .setFontColor('#ffffff')
      .setFontWeight('bold')
      .setHorizontalAlignment('center')
      .setFontFamily('Meiryo');
    
    targetSheet.setFrozenRows(1);
  }
  
  // データ行を作成
  var newRow = [];
  var namedValues = e.namedValues;
  
  for (var j = 0; j < requiredQuestions.length; j++) {
    var questionTitle = requiredQuestions[j];
    var values = namedValues[questionTitle];
    
    if (values && values.length > 0) {
      // 配列の中から空でない値を探す（複数ある場合は最初の空でない値）
      var foundValue = '';
      for (var k = 0; k < values.length; k++) {
        if (values[k] && values[k].toString().trim() !== '') {
          foundValue = values[k];
          break;
        }
      }
      newRow.push(foundValue);
    } else {
      // 値が見つからない場合は空白
      newRow.push('');
      // タイムスタンプなどの共通項目は headerMap から取得を試みる（念のため）
      // ただし今回は namedValues に全て含まれているはず
    }
  }
  
  // データを追加
  targetSheet.appendRow(newRow);
  
  // 縞模様（ゼブラ）の適用
  var lastRow = targetSheet.getLastRow();
  if (lastRow > 1 && lastRow % 2 === 0) {
    targetSheet.getRange(lastRow, 1, 1, targetSheet.getLastColumn()).setBackground('#f8f9fa');
  }
  
  Logger.log('separateSheetByBusiness_Fixed: ' + targetSheetName + 'シートにデータを追加しました');
}
