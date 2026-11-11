/**
 * 1. 設定・同義語辞書セクション
 */
const CONFIG = {
  timezone: 'Asia/Tokyo',
  masterSheetName: '発注先リスト【合計】',
  templateSheetName: '原本',
  historyStatus: { NEW: '新規', EXISTING: '継続' },
  // ▼ LINEへの返信機能を使う場合は、LINE Developersのチャネルアクセストークンを入れます
  lineAccessToken: '7wMyIkRLyTOJI9NUTSMnksIpK7R6moo4xZfmwYabLlccE9HhXhN8571gstpKcORI9EsiZgubAbjd1JUxd4way3f6BJoGWjtXFdD3BWGiV3ZrxXXjnCNPrUu8MNUFKJ6ANS3iql7jXx4b5CwqQT3+ygdB04t89/1O/w1cDnyilFU=',
  /**
   * Googleフォーム回答 → LINE にプッシュ送信するときの送信先
   * userId / groupId / roomId のいずれか（Messaging API の push の "to"）
   * 秘密にしたい場合はスクリプトプロパティ LINE_PUSH_TARGET_ID に設定してもOK
   */
  linePushTargetId: 'SAMPLE_ID_013'
};

// 職人の打ち間違いを吸収する辞書
const PRODUCT_SYNONYMS = {
  '脚立': ['脚立', 'きゃたつ', '脚たつ', '4尺脚立', '6尺脚立'],
  'ジャッキベース': ['ジャッキベース', 'ジャッキ', 'ベース'],
  'ダイバキング': ['ダイバキング', 'ダイバーキング', '立馬', '立ち馬'],
  'メッシュシート': ['メッシュシート', 'メッシュ', 'v300']
};

const COLUMN_INDEX = {
  NO: 1, REQUEST_DATE: 2, VENDOR: 4, ORDERER: 5, DELIVERY_DATE: 6,
  PRODUCT_NAME: 7, QUANTITY: 8, SITE_NAME: 9, NOTES: 10,
  HISTORY_STATUS: 15, ORDERED: 16
};

/**
 * Googleフォーム→LINEプッシュしたテキストが、何らかの理由でWebhookに届いたときに
 * シートへ二重転記しないための「画面上ほぼ見えない」末尾マーカー（ZWNJ+ZWJ）
 * ※手入力の【発注】には付かないので、通常のトークはこれまで通り転記される
 */
const LINE_FORM_PUSH_INVISIBLE_MARK_ = '\u200c\u200d';

/**
 * 2. LINE受信 (doPost)
 * 🌟 ポイント：通信が来たら、裏で処理をする予約だけして、LINEには爆速で「200 OK」を返す
 */
function doPost(e) {
  // GASエディタから手動実行した場合の保護
  if (!e || !e.postData) {
    console.log('doPost: eが未定義です（LINEからのWebhookリクエストが必要です）');
    return ContentService.createTextOutput('TEST_MODE');
  }
  try {
    const json = JSON.parse(e.postData.contents);
    const event = json.events && json.events[0];
    const scriptProperties = PropertiesService.getScriptProperties();
    const src = (event && event.source) || {};
    if (src.groupId) scriptProperties.setProperty('LAST_GROUP_ID', src.groupId);
    if (src.userId) scriptProperties.setProperty('LAST_USER_ID', src.userId);
    if (src.roomId) scriptProperties.setProperty('LAST_ROOM_ID', src.roomId);

    // ─── 重複防止①: LINEの再送（リトライ）を検知してスキップ ───
    if (event && event.deliveryContext && event.deliveryContext.isRedelivery) {
      console.log('doPost: リトライ検知 → スキップ');
      return ContentService.createTextOutput('SKIP_REDELIVERY');
    }

    // ─── 重複防止②: メッセージIDで重複チェック ───
    const messageId = event && event.message ? event.message.id : '';
    if (messageId) {
      const dedupKey = 'DEDUP_' + messageId;
      if (scriptProperties.getProperty(dedupKey)) {
        console.log('doPost: 同一メッセージID検知 → スキップ (id=' + messageId + ')');
        return ContentService.createTextOutput('SKIP_DUPLICATE');
      }
      // 処理済みとしてマーク（24時間後にcleanupで消える想定）
      scriptProperties.setProperty(dedupKey, String(Date.now()));
    }

    // スプレッドシートの「プロパティ」という見えない場所にきたメッセージを一時保存する
    const key = 'LINE_' + new Date().getTime() + '_' + (messageId || Math.random());
    scriptProperties.setProperty(key, e.postData.contents);
    
    // 既存のprocessQueueトリガーがなければ新規作成（重複防止）
    const existingTriggers = ScriptApp.getProjectTriggers();
    const alreadyQueued = existingTriggers.some(t => t.getHandlerFunction() === 'processQueue');
    if (!alreadyQueued) {
      ScriptApp.newTrigger('processQueue')
        .timeBased()
        .after(1 * 1000) // 1秒後（GASの仕様上、最短でも約1分後に実行されます）
        .create();
    }

    // LINEには「受け取りました（200 OK）」だけを爆速で返す
    return ContentService.createTextOutput('SUCCESS');
  } catch (err) {
    console.error('doPostエラー: ' + err.message);
    return ContentService.createTextOutput('ERROR'); 
  }
}

/**
 * 3. 裏側で実行される本体処理（processQueue）
 */
function processQueue() {
  console.log('processQueue: 開始');

  // 同時実行防止：ロックが取れなければ別インスタンスが処理中なのでスキップ
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(0)) {
    console.log('processQueue: 別インスタンスが実行中のためスキップ');
    // ─── 重複防止③: ロック失敗時もトリガーを再作成して未処理データを救済 ───
    const retryTriggers = ScriptApp.getProjectTriggers();
    const hasRetry = retryTriggers.some(t => t.getHandlerFunction() === 'processQueue');
    if (!hasRetry) {
      ScriptApp.newTrigger('processQueue').timeBased().after(5 * 1000).create();
      console.log('processQueue: リトライトリガー作成');
    }
    return;
  }

  try {

  const scriptProperties = PropertiesService.getScriptProperties();
  const properties = scriptProperties.getProperties();

  // 処理済みメッセージIDを追跡（processQueue内での二重処理防止）
  const processedMessageIds = new Set();
  const lineKeys = Object.keys(properties).filter(k => k.startsWith('LINE_'));
  console.log('processQueue: LINE_キー件数 =', lineKeys.length);

  // 保存したログの中で「LINE_」から始まるものを探す
  for (let key in properties) {
    if (key.startsWith('LINE_')) {
      console.log('processQueue: 処理中 key =', key);
      try {
        const json = JSON.parse(properties[key]);
        const event = json.events[0];

        // 処理済みとしてプロパティから削除（2回実行されるのを防ぐ）
        scriptProperties.deleteProperty(key);
        console.log('processQueue: ScriptProperty削除完了');

        if (event && event.type === 'message' && event.message.type === 'text') {
          // ─── processQueue内でもメッセージID重複チェック ───
          const msgId = event.message.id || '';
          if (msgId && processedMessageIds.has(msgId)) {
            console.log('processQueue: 同一メッセージID重複スキップ (id=' + msgId + ')');
            continue;
          }
          if (msgId) processedMessageIds.add(msgId);

          handleMessage(event);
          console.log('processQueue: handleMessage完了');
        }
      } catch (e) {
        console.error('processQueue処理中エラー: ' + e);
        scriptProperties.deleteProperty(key);
      }
    }
  }

  console.log('processQueue: 完了');

  } finally {
    // エラーが起きても必ずトリガーを削除してロックを解放する
    const triggers = ScriptApp.getProjectTriggers();
    for (let i = 0; i < triggers.length; i++) {
      if (triggers[i].getHandlerFunction() === 'processQueue') {
        ScriptApp.deleteTrigger(triggers[i]);
      }
    }
    lock.releaseLock();
  }
}

function handleMessage(event) {
  const userText = event.message.text;
  console.log('handleMessage: テキスト =', userText ? userText.substring(0, 50) : 'null');

  // フォーム送信→Push 経由（末尾に不可視マーカー付与）なら転記しない
  if (userText && userText.endsWith(LINE_FORM_PUSH_INVISIBLE_MARK_)) {
    console.log('handleMessage: フォーム経由プッシュと判定 → シート転記スキップ');
    return;
  }

  if (!userText.startsWith('【発注】')) {
    console.log('handleMessage: 【発注】で始まらないためスキップ');
    return;
  }

  const parseResult = parseOrderText(userText);
  console.log('handleMessage: parseResult.ok =', parseResult.ok, parseResult.ok ? '' : '| reason: ' + parseResult.message);

  if (parseResult.ok) {
    recordOrder(parseResult.data, new Date(event.timestamp || Date.now()));
    replyToLine(event.replyToken, '受注をシートに記録しました！');
  } else {
    replyToLine(event.replyToken, '【エラー】形式が違います：\n' + parseResult.message);
  }
}

function replyToLine(replyToken, text) {
  if (!CONFIG.lineAccessToken || CONFIG.lineAccessToken.includes('ここにLINEの')) {
    console.log('replyToLine: lineAccessToken 未設定のためスキップ');
    return;
  }
  const url = 'https://api.line.me/v2/bot/message/reply';
  try {
    const res = UrlFetchApp.fetch(url, {
      method: 'post',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + CONFIG.lineAccessToken
      },
      payload: JSON.stringify({
        replyToken: replyToken,
        messages: [{ type: 'text', text: text }]
      }),
      // エラーでも例外にせずレスポンス内容をログに出せるようにする
      muteHttpExceptions: true
    });

    const status = res.getResponseCode();
    const bodySnippet = res.getContentText().substring(0, 300);
    console.log('replyToLine: response', { status, bodySnippet });

    if (status >= 400) {
      throw new Error('replyToLine: HTTP ' + status + ' ' + bodySnippet);
    }
  } catch (err) {
    console.error('replyToLineエラー: ' + (err && err.message ? err.message : err));
  }
}

/**
 * 4. 解析ロジック
 */
function parseOrderText(text) {
  if (!text || typeof text !== 'string') return { ok: false, message: 'テキストが無効です' };

  let normalized = text.replace(/：/g, ':').replace(/　/g, ' ');
  const lines = normalized.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0);

  var fields = {};
  var lastKey = null;
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      lastKey = line.substring(0, colonIdx).trim();
      fields[lastKey] = line.substring(colonIdx + 1).trim();
    } else if (lastKey && line !== '【発注】') {
      // 複数行にまたがる商品名などに対応
      fields[lastKey] += '\n' + line;
    }
  }

  var siteName = fields['現場名'] || fields['現場'] || '';
  var productName = fields['商品名'] || fields['商品'] || fields['品名'] || '';
  var quantityStr = fields['数量'] || '';
  var deliveryDateStr = fields['搬入日'] || fields['搬入予定日'] || fields['納品日'] || fields['希望日'] || '';

  if (!siteName || !productName || !quantityStr) return { ok: false, message: '必須項目が不定です' };

  var quantity = parseQuantity(quantityStr);
  if (quantity === null || quantity <= 0) return { ok: false, message: '数量が無効です' };

  var deliveryDate = parseDeliveryDate(deliveryDateStr);
  var normalizedProductName = normalizeProductName(productName);

  return {
    ok: true,
    data: { siteName, productName: normalizedProductName, quantity, deliveryDate }
  };
}

function parseQuantity(str) {
  if (!str) return null;
  var half = str.replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  var numStr = half.replace(/[^0-9.\-]/g, '');
  var num = parseFloat(numStr);
  return isNaN(num) ? null : num;
}

function parseDeliveryDate(str) {
  if (!str || str === '最短' || str === 'なるはや' || str === 'ASAP') return '最短';
  var half = str.replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  var slashMatch = half.match(/(\d{1,2})[\/月](\d{1,2})/);
  if (slashMatch) return ('0' + slashMatch[1]).slice(-2) + '/' + ('0' + slashMatch[2]).slice(-2);
  var fullMatch = half.match(/\d{4}[\-\/](\d{1,2})[\-\/](\d{1,2})/);
  if (fullMatch) return ('0' + fullMatch[1]).slice(-2) + '/' + ('0' + fullMatch[2]).slice(-2);
  return str;
}

function normalizeProductName(rawName) {
  if (!rawName) return '';
  var lower = rawName.toLowerCase().trim();
  var keys = Object.keys(PRODUCT_SYNONYMS);
  for (var i = 0; i < keys.length; i++) {
    var canonical = keys[i];
    if (PRODUCT_SYNONYMS[canonical].some(s => s.toLowerCase() === lower)) return canonical;
  }
  for (var i = 0; i < keys.length; i++) {
    var canonical = keys[i];
    if (PRODUCT_SYNONYMS[canonical].some(s => lower.includes(s.toLowerCase()))) return canonical;
  }
  return rawName;
}

/**
 * 5. 転記ロジック
 */
function lookupVendor(site, product) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) return { vendor: '', status: CONFIG.historyStatus.NEW };
    
    // スペース（全角半角）を排除して比較するための文字列
    const firstLineProduct = product.split('\n')[0].trim().replace(/[\s　]+/g, '');
    if (!firstLineProduct) return { vendor: '', status: CONFIG.historyStatus.NEW };

    // 最新の月別シート（一番左）から順に検索
    const sheets = ss.getSheets();
    for (let s = 0; s < sheets.length; s++) {
      const sheet = sheets[s];
      // 「原本」シートは検索対象外
      if (sheet.getName() === CONFIG.templateSheetName) continue;
      
      const data = sheet.getDataRange().getValues();
      // 下の行（新しい登録）から順にさかのぼる
      for (let i = data.length - 1; i >= 1; i--) {
        const pastProduct = String(data[i][COLUMN_INDEX.PRODUCT_NAME - 1] || '').split('\n')[0].trim().replace(/[\s　]+/g, '');
        const vendorName = String(data[i][COLUMN_INDEX.VENDOR - 1] || '').trim();
        
        // 過去行に商品名が存在し、かつ「発注先」がちゃんと入力されている場合のみ採用
        if (pastProduct === firstLineProduct && vendorName !== '') {
          return { vendor: vendorName, status: CONFIG.historyStatus.EXISTING };
        }
      }
    }
  } catch(e) {
    console.error('lookupVendorエラー: ' + e.message);
  }
  return { vendor: '', status: CONFIG.historyStatus.NEW };
}

function recordOrder(payload, requestDate) {
  console.log('recordOrder: 開始 siteName=' + payload.siteName + ' product=' + payload.productName);
  const vendorResult = lookupVendor(payload.siteName, payload.productName);
  const sheet = ensureMonthlySheetForDate(requestDate);
  console.log('recordOrder: 書き込み先シート =', sheet.getName());
  const rowData = new Array(COLUMN_INDEX.ORDERED).fill('');

  rowData[COLUMN_INDEX.REQUEST_DATE - 1]   = Utilities.formatDate(requestDate, CONFIG.timezone, 'MM/dd');
  rowData[COLUMN_INDEX.VENDOR - 1]         = vendorResult.vendor;
  rowData[COLUMN_INDEX.DELIVERY_DATE - 1]  = payload.deliveryDate;
  rowData[COLUMN_INDEX.PRODUCT_NAME - 1]   = payload.productName;
  rowData[COLUMN_INDEX.QUANTITY - 1]       = payload.quantity;
  rowData[COLUMN_INDEX.SITE_NAME - 1]      = payload.siteName;
  rowData[COLUMN_INDEX.HISTORY_STATUS - 1] = vendorResult.status;

  // ──────────────────────────────────────────────────────
  // ロックで排他制御：複数のフォーム送信が同時に来ても
  // 同じ行に上書きしないようにする
  // ──────────────────────────────────────────────────────
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000); // 最大30秒待つ

    // ロック取得後、キャッシュを強制リフレッシュして最新のシート状態を読む
    SpreadsheetApp.flush();

    // ──────────────────────────────────────────────────────
    // 「上から見て最初の完全に空の行」を書き込み先にする
    // ヘッダー行（1行目）は飛ばして2行目から検索
    // ──────────────────────────────────────────────────────
    var targetRow = 2; // デフォルトは2行目
    var lastRow = sheet.getLastRow();

    if (lastRow >= 2) {
      var allValues = sheet.getRange(2, 1, lastRow - 1, COLUMN_INDEX.ORDERED).getValues();
      var foundEmpty = false;
      for (var r = 0; r < allValues.length; r++) {
        var isRowEmpty = allValues[r].every(function(cell) {
          return cell === '' || cell === null || cell === false;
        });
        if (isRowEmpty) {
          targetRow = r + 2; // +2 = 1始まり座標 + ヘッダー分
          foundEmpty = true;
          break;
        }
      }
      if (!foundEmpty) {
        // 全行に何かデータがあれば、最終行の次に追加
        targetRow = lastRow + 1;
      }
    }

    sheet.getRange(targetRow, 1, 1, rowData.length).setValues([rowData]);
    sheet.getRange(targetRow, COLUMN_INDEX.ORDERED).insertCheckboxes().setValue(false);
    applyRowFormatting(sheet, targetRow, vendorResult.status);

    // 書き込みを即座に確定（次の実行が読む前に反映させる）
    SpreadsheetApp.flush();
    console.log('recordOrder: 完了 row =', targetRow);

  } catch (e) {
    console.error('recordOrder: ロックまたは書き込みエラー: ' + e.message);
  } finally {
    lock.releaseLock();
  }
}


function ensureMonthlySheetForDate(date) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const name = Utilities.formatDate(date, CONFIG.timezone, 'yyyy年MM月');
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    const template = ss.getSheetByName(CONFIG.templateSheetName);
    if (!template) throw new Error('「原本」シートが見つかりません');
    sheet = template.copyTo(ss).setName(name);
    ss.setActiveSheet(sheet);
    ss.moveActiveSheet(1);
  }
  return sheet;
}

function onEdit(e) {
  if (!e || !e.range) return;
  const sheet = e.range.getSheet();
  if (sheet.getName() === CONFIG.masterSheetName || sheet.getName() === CONFIG.templateSheetName) return;
  if (e.range.getColumn() !== COLUMN_INDEX.ORDERED || String(e.value).toUpperCase() !== 'TRUE') return;

  const row = e.range.getRow();
  if (row <= 1) return; 

  const data = sheet.getRange(row, 1, 1, COLUMN_INDEX.ORDERED).getValues()[0];
  const master = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.masterSheetName);
  
  if (master) {
    master.appendRow(data);
    applyRowFormatting(sheet, row, 'ordered');
  }
}

function applyRowFormatting(sheet, row, status) {
  const range = sheet.getRange(row, 1, 1, COLUMN_INDEX.ORDERED);
  switch (status) {
    case CONFIG.historyStatus.NEW:
      range.setBackground('#FF9999');
      break;
    case CONFIG.historyStatus.EXISTING:
      range.setBackground('#9FC5E8');
      break;
    case 'ordered':
      range.setBackground('#FFFFFF');
      break;
  }
}

/**
 * デバッグ用: doPost のテスト実行（GASエディタから直接実行可能）
 * 実際のLINEリクエストをモックして動作確認するための関数
 */
function listLineProperties() {
  const props = PropertiesService.getScriptProperties().getProperties();
  const lineKeys = Object.keys(props).filter(k => k.startsWith('LINE_'));
  console.log('キュー件数:', lineKeys.length);
  lineKeys.forEach(k => {
    try {
      const event = JSON.parse(props[k]).events[0];
      console.log(k, '|', event && event.message ? event.message.text.substring(0, 60) : '不明');
    } catch(e) {
      console.log(k, '| 解析エラー');
    }
  });
}

function clearAllLineProperties() {
  const props = PropertiesService.getScriptProperties();
  const all = props.getProperties();
  const lineKeys = Object.keys(all).filter(k => k.startsWith('LINE_'));
  const dedupKeys = Object.keys(all).filter(k => k.startsWith('DEDUP_'));
  console.log('削除するLINE_キー数:', lineKeys.length, ' DEDUP_キー数:', dedupKeys.length);
  lineKeys.forEach(k => props.deleteProperty(k));
  dedupKeys.forEach(k => props.deleteProperty(k));
  console.log('クリア完了');
}

/**
 * 古いDEDUP_キーを掃除する関数（24時間以上前のものを削除）
 * GASの時間ベーストリガーで1日1回実行するのがおすすめ
 */
function cleanupDedupKeys() {
  const props = PropertiesService.getScriptProperties();
  const all = props.getProperties();
  const now = Date.now();
  const ONE_DAY = 24 * 60 * 60 * 1000;
  let deleted = 0;

  Object.keys(all).filter(k => k.startsWith('DEDUP_')).forEach(k => {
    const ts = parseInt(all[k], 10);
    if (!isNaN(ts) && (now - ts) > ONE_DAY) {
      props.deleteProperty(k);
      deleted++;
    }
  });

  console.log('cleanupDedupKeys: ' + deleted + '件のDEDUP_キーを削除');
}

function debug_doPost() {
  const mockEvent = {
    postData: {
      contents: JSON.stringify({
        events: [{
          type: 'message',
          replyToken: 'dummy_reply_token',
          timestamp: Date.now(),
          message: {
            type: 'text',
            text: '【発注】\n現場名:テスト現場\n商品名:脚立\n数量:2\n搬入日:最短'
          }
        }]
      })
    }
  };

  console.log('=== debug_doPost 開始 ===');
  const result = doPost(mockEvent);
  console.log('doPost戻り値:', result ? result.getContent() : 'null');
  console.log('=== debug_doPost 完了 ===');
}

// =============================================================================
// Googleフォーム → 公式LINEへテンプレ文面を自動プッシュ送信
// -----------------------------------------------------------------------------
// 送信されるメッセージ形式（コロン後は半角スペース・改行は \n）:
//
//   【発注】
//   現場名: （回答）
//   商品名: （回答）
//   数量: （回答）
//   搬入日: （回答／未入力は「最短」）
//   発注者: （回答）
//
// （末尾に不可視マーカーが付き、Webhook側でシート二重転記をしません）
//
// 【おすすめセットアップ】フォームの編集画面でスクリプトを開き、1回だけ実行:
//   runSetupGoogleFormLine_()
//
// 【フォームの設問タイトル（この文言が確実）】
//   現場名 / 商品名 / 数量 / 搬入日 / 名前 / 電話番号
//   ※多少の別名（氏名・品名など）にも対応していますが、上記がおすすめです。
//
// 【シート連携あり】回答スプレッドシートを開いて installFormSubmitTrigger_()
// 【シート連携なし】フォーム編集画面で installFormSubmitTriggerOnForm_()
//
// LINE: CONFIG またはスクリプトプロパティ
//   LINE_CHANNEL_ACCESS_TOKEN / LINE_PUSH_TARGET_ID
// =============================================================================

/** @returns {string} */
function getLineChannelAccessToken_() {
  const p = PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN');
  if (p && String(p).trim()) return String(p).trim();
  return CONFIG.lineAccessToken && !String(CONFIG.lineAccessToken).includes('ここにLINEの')
    ? String(CONFIG.lineAccessToken).trim()
    : '';
}

/** @returns {string} */
function getLinePushTargetId_() {
  const p = PropertiesService.getScriptProperties().getProperty('LINE_PUSH_TARGET_ID');
  if (p && String(p).trim()) return String(p).trim();
  return CONFIG.linePushTargetId ? String(CONFIG.linePushTargetId).trim() : '';
}

/**
 * Googleフォーム単体トリガー用（e.response から設問タイトル→回答を組み立てる）
 * @param {GoogleAppsScript.Forms.FormResponse} response
 */
function extractFormAnswersFromFormResponse_(response) {
  const items = [];
  const itemResponses = response.getItemResponses();
  const tz = Session.getScriptTimeZone() || CONFIG.timezone;
  for (let i = 0; i < itemResponses.length; i++) {
    const ir = itemResponses[i];
    const title = ir.getItem().getTitle();
    let val = ir.getResponse();
    if (val === null || val === undefined) {
      val = '';
    } else if (Array.isArray(val)) {
      val = val.join(', ');
    } else if (Object.prototype.toString.call(val) === '[object Date]' || val instanceof Date) {
      // 日付型の設問 → 搬入日などに使いやすい MM/dd 表記
      val = Utilities.formatDate(val, tz, 'M/d');
    } else if (typeof val === 'number') {
      // 数量などが数値型で返るとき "5" のように見やすく
      val = val % 1 === 0 ? String(Math.round(val)) : String(val);
    } else {
      val = String(val);
    }
    items.push({ title: title, value: val });
  }
  return extractFormAnswers_(items);
}

/**
 * テンプレ作成
 * @param {{site:string,product:string,quantity:string,delivery:string,name:string,phone:string}} a
 * @param {{appendFormPushMark?: boolean}} [opt] true のとき末尾に不可視マーカー（Webhook二重転記防止）
 */
function buildOrderLineMessage_(a, opt) {
  opt = opt || {};
  const qtyStr = formatQuantityForLine_(a.quantity);
  const body =
    '【発注】\n' +
    '現場名: ' + String(a.site || '').trim() + '\n' +
    '商品名: ' + String(a.product || '').trim() + '\n' +
    '数量: ' + qtyStr + '\n' +
    '搬入日: ' + String(a.delivery || '最短').trim() + '\n' +
    '発注者: ' + String(a.name || '').trim() + '\n' +
    '電話番号: ' + String(a.phone || '').trim();
  return opt.appendFormPushMark ? body + LINE_FORM_PUSH_INVISIBLE_MARK_ : body;
}

/** 純粋な数値文字列（例: 5.0）だけ整数表示にそろえる。単位付きはそのまま */
function formatQuantityForLine_(q) {
  if (q === null || q === undefined) return '';
  const s = String(q).trim();
  if (!s) return '';
  const normalized = s.replace(/,/g, '').replace(/\s/g, '').replace(/　/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return s;
  const n = parseFloat(normalized);
  if (isNaN(n) || !isFinite(n)) return s;
  return Math.abs(n - Math.round(n)) < 1e-9 ? String(Math.round(n)) : String(n);
}

/**
 * Messaging API: Push メッセージ（テキスト）
 * @param {string} to userId | groupId | roomId
 * @param {string} text
 */
function lineMessagingPushText_(to, text, actionUrls) {
  const token = getLineChannelAccessToken_();
  if (!token) {
    throw new Error('LINE のチャネルアクセストークンが未設定です（CONFIG または LINE_CHANNEL_ACCESS_TOKEN）');
  }
  if (!to) {
    throw new Error('プッシュ先IDが未設定です（CONFIG.linePushTargetId または LINE_PUSH_TARGET_ID）');
  }

  let messages = [{ type: 'text', text: text }];

  // 改善：長いURLを隠して綺麗なボタン（Template Message）にする
  if (actionUrls && actionUrls.length > 0) {
    messages.push({
      type: 'template',
      altText: '【追加発注用リンク】', // PC版LINEなど非対応端末用のテキスト
      template: {
        type: 'buttons',
        text: 'この現場でそのまま追加発注しますか？',
        actions: actionUrls.map(function(u) {
          return {
            type: 'uri',
            label: u.label,
            uri: u.uri.substring(0, 1000)
          };
        })
      }
    });
  }

  const url = 'https://api.line.me/v2/bot/message/push';
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({
      to: to,
      messages: messages
    }),
    muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  const body = res.getContentText();
  if (code >= 400) {
    throw new Error('line push failed HTTP ' + code + ' ' + body.substring(0, 400));
  }
  console.log('lineMessagingPushText_: OK', code);
}

/**
 * フォーム送信時（スプレッドシート連携 or フォーム単体のどちらのトリガーでも可）
 * @param {GoogleAppsScript.Events.SheetsOnFormSubmit|GoogleAppsScript.Events.FormsOnFormSubmit} e
 */
function onFormSubmit(e) {
  try {
    let answers;
    if (e && e.range && e.values) {
      // シート連携の場合、e.namedValues のオブジェクトキー順序は保証されない（列順と異なる場合がある）ため
      // e.values（列順の配列）とシート1行目のヘッダー値から、正しい列順（＝フォームの設問順）で namedValues を再構築します
      const sheet = e.range.getSheet();
      const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      const items = [];
      for (let i = 0; i < headers.length; i++) {
        if (headers[i]) {
          items.push({ title: String(headers[i]), value: String(e.values[i]) });
        }
      }
      answers = extractFormAnswers_(items);
    } else if (e && e.response) {
      answers = extractFormAnswersFromFormResponse_(e.response);
    } else if (e && e.namedValues) {
      answers = extractFormAnswers_(e.namedValues);
    } else {
      return;
    }

    // 1) LINE通知用とシート記録用で分ける
    let lineText = buildOrderLineMessage_(answers, { appendFormPushMark: true });
    
    // ▼▼▼【基本材フォーム】のURLと固有ID▼▼▼
    const basicBaseUrl = "https://docs.google.com/forms/d/e/SAMPLE_ID_014/viewform?usp=pp_url";
    const basicNextUrl = basicBaseUrl + 
      "&entry.2051222364=" + encodeURIComponent(answers.site) +     // 基本材の「現場名」のID
      "&entry.422566798=" + encodeURIComponent(answers.delivery) + // 基本材の「搬入日」のID
      "&entry.2001487780=" + encodeURIComponent(answers.name) +     // 基本材の「名前」のID
      "&entry.704495318=" + encodeURIComponent(answers.phone);     // 基本材の「電話番号」のID

    // ▼▼▼【特殊材フォーム】のURLと固有ID▼▼▼
    const specialBaseUrl = "https://docs.google.com/forms/d/e/SAMPLE_ID_015/viewform?usp=pp_url";
    const specialNextUrl = specialBaseUrl + 
      "&entry.2051222364=" + encodeURIComponent(answers.site) +     // 特殊材の「現場名」のID
      "&entry.422566798=" + encodeURIComponent(answers.delivery) + // 特殊材の「搬入日」のID
      "&entry.2001487780=" + encodeURIComponent(answers.name) +     // 特殊材の「名前」のID
      "&entry.704495318=" + encodeURIComponent(answers.phone);     // 特殊材の「電話番号」のID

    // ▼▼▼【TS材フォーム】のURLと固有ID▼▼▼
    const tsBaseUrl = "https://docs.google.com/forms/d/e/SAMPLE_ID_016/viewform?usp=pp_url";
    const tsNextUrl = tsBaseUrl + 
      "&entry.814404640=" + encodeURIComponent(answers.site) +     // TS材の「現場名」のID
      "&entry.2125561892=" + encodeURIComponent(answers.delivery) + // TS材の「搬入日」のID
      "&entry.1052682946=" + encodeURIComponent(answers.name) +     // TS材の「名前」のID
      "&entry.1541680921=" + encodeURIComponent(answers.phone);     // TS材の「電話番号」のID

    const actionUrls = [
      { label: '基本材を追加', uri: basicNextUrl },
      { label: '特殊材を追加', uri: specialNextUrl },
      { label: 'TS材を追加', uri: tsNextUrl }
    ];

    const to = getLinePushTargetId_();
    lineMessagingPushText_(to, lineText, actionUrls);

    // 2) シート転記（URLの無い、純粋なメッセージテキストをパースさせる）
    // ※ recordOrder 内部でロック＆フラッシュ済みなので、ここでは単純に呼ぶだけでOK
    const recordText = buildOrderLineMessage_(answers, { appendFormPushMark: false });
    const parseResult = parseOrderText(recordText);
    if (parseResult.ok) {
      parseResult.data.productName = answers.product; 
      recordOrder(parseResult.data, new Date());
    }

  } catch (err) {
    console.error('エラー: ' + err);
  }
}

/**
 * 送られないとき用チェックリスト（この関数だけ実行してログを読む）
 * エディタで実行 → 表示（Ctrl+Enter）または「実行数」→ ログを確認
 */
function debug_diagnoseFormToLine_() {
  function L(s) {
    console.log(s);
  }
  L('========== debug_diagnoseFormToLine_ ==========');
  try {
    const f = FormApp.getActiveForm();
    L(
      f
        ? 'OK: スクリプトはフォームにバインドされています（「' + f.getTitle() + '」）'
        : 'NG: FormApp.getActiveForm が null → スクリプトが「フォーム」ではなく別コンテナ（例: 単体プロジェクト）の可能性大'
    );
  } catch (e) {
    L('FormApp エラー: ' + e.message);
  }
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    L(ss ? '開いているスプレッドシート: ' + ss.getName() : 'スプレッドシートは未オープン（フォーム単体運用なら問題なし）');
  } catch (e2) {
    L('SpreadsheetApp: ' + e2.message);
  }

  const tok = getLineChannelAccessToken_();
  const to = getLinePushTargetId_();
  L('LINE チャネルアクセストークン: ' + (tok ? '設定あり（長さ ' + tok.length + '）' : '未設定（CONFIG / LINE_CHANNEL_ACCESS_TOKEN）'));
  L('LINE プッシュ先 ID: ' + (to ? '設定あり（先頭 ' + to.substring(0, Math.min(6, to.length)) + '…）' : '未設定（CONFIG.linePushTargetId / LINE_PUSH_TARGET_ID）'));

  const triggers = ScriptApp.getProjectTriggers();
  L('このプロジェクトのトリガー数: ' + triggers.length);
  let hasFormTrigger = false;
  let hasSheetTrigger = false;
  for (let i = 0; i < triggers.length; i++) {
    const t = triggers[i];
    const line =
      '  [' +
      i +
      '] ' +
      t.getHandlerFunction() +
      ' | ' +
      t.getEventType() +
      ' | source=' +
      t.getTriggerSource();
    L(line);
    if (
      t.getHandlerFunction() === 'onFormSubmit' &&
      t.getEventType() === ScriptApp.EventType.ON_FORM_SUBMIT
    ) {
      if (t.getTriggerSource() === ScriptApp.TriggerSource.FORMS) hasFormTrigger = true;
      if (t.getTriggerSource() === ScriptApp.TriggerSource.SPREADSHEETS) hasSheetTrigger = true;
    }
  }
  L('→ フォーム送信トリガー（onFormSubmit + FORMS）: ' + (hasFormTrigger ? 'あり' : 'なし'));
  L('→ シート送信トリガー（onFormSubmit + SPREADSHEETS）: ' + (hasSheetTrigger ? 'あり' : 'なし'));

  if (!hasFormTrigger && !hasSheetTrigger) {
    L('【原因候補1】インストール可能な「フォーム送信時」トリガーが付いていません。');
    L('  ・フォームにバインドしたスクリプトで installFormSubmitTriggerOnForm_() を実行');
    L('  ・または回答スプレッドシートで installFormSubmitTrigger_() を実行（シート連携している場合）');
  }
  if (hasSheetTrigger && !hasFormTrigger) {
    L('【原因候補2】シート連携を切ったのに、フォーム用トリガーが無い → 送信は動きません。');
    L('  フォームのスクリプトで installFormSubmitTriggerOnForm_() を実行してください。');
  }
  if (!tok || !to) {
    L('【原因候補3】LINE のトークンまたはプッシュ先 ID が、このスクリプトプロジェクトに入っていません。');
    L('  Webhook 用の別プロジェクトだけ設定していると、フォーム用プロジェクトでは送れません。');
  }
  L('========== ここまで ==========');
}

/**
 * 直近のフォーム回答をもう一度 LINE に送る（プッシュのテスト用）
 * フォーム編集画面でスクリプトがフォームにバインドされているときだけ動きます
 */
function debug_replayLastFormResponseToLine_() {
  const form = FormApp.getActiveForm();
  if (!form) {
    console.log('debug_replayLastFormResponseToLine_: フォームを開いてから実行してください');
    return;
  }
  const list = form.getResponses();
  if (!list.length) {
    console.log('debug_replayLastFormResponseToLine_: まだ回答がありません');
    return;
  }
  const last = list[list.length - 1];
  console.log('debug_replayLastFormResponseToLine_: 直近回答を再送します');
  onFormSubmit({ response: last });
}

/**
 * 初回セットアップ用（Googleフォームの編集画面で実行）
 * ・フォーム送信時トリガー作成
 * ・LINE トークン / プッシュ先ID の有無をログ表示
 */
function runSetupGoogleFormLine_() {
  const tokenOk = !!getLineChannelAccessToken_();
  const targetOk = !!getLinePushTargetId_();
  console.log('runSetupGoogleFormLine_: LINE_CHANNEL_ACCESS_TOKEN OK=' + tokenOk + ' / LINE_PUSH_TARGET_ID OK=' + targetOk);
  if (!tokenOk) {
    console.log('→ CONFIG.lineAccessToken またはスクリプトプロパティ LINE_CHANNEL_ACCESS_TOKEN を設定してください');
  }
  if (!targetOk) {
    console.log('→ CONFIG.linePushTargetId またはスクリプトプロパティ LINE_PUSH_TARGET_ID を設定してください');
  }
  try {
    installFormSubmitTriggerOnForm_();
  } catch (err) {
    console.log('installFormSubmitTriggerOnForm_: ' + (err && err.message ? err.message : err));
    console.log('（フォームにバインドしていない場合は、回答シートで installFormSubmitTrigger_ を使ってください）');
  }
  console.log('完了後、テスト送信でログに「onFormSubmit:」が出るか確認してください。');
}

/**
 * 回答先スプレッドシートを開いた状態で1回実行 → フォーム送信時トリガーを作成
 */
function installFormSubmitTrigger_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw new Error('スプレッドシートを開いてから実行してください（フォームの回答シート）');
  }
  const triggers = ScriptApp.getProjectTriggers();
  const exists = triggers.some(function (t) {
    return (
      t.getHandlerFunction() === 'onFormSubmit' &&
      t.getEventType() === ScriptApp.EventType.ON_FORM_SUBMIT &&
      t.getTriggerSource() === ScriptApp.TriggerSource.SPREADSHEETS
    );
  });
  if (exists) {
    console.log('installFormSubmitTrigger_: 既にスプレッドシート用 onFormSubmit トリガーがあります');
    return;
  }
  ScriptApp.newTrigger('onFormSubmit').forSpreadsheet(ss).onFormSubmit().create();
  console.log('installFormSubmitTrigger_: onFormSubmit トリガーを作成しました');
}

/**
 * スプレッドシートに回答を保存しない運用向け：
 * Googleフォームの編集画面を開いた状態で1回実行 → フォームの「送信時」トリガーを作成
 */
function installFormSubmitTriggerOnForm_() {
  const form = FormApp.getActiveForm();
  if (!form) {
    throw new Error('Googleフォームの編集画面を開いてから実行してください');
  }
  const triggers = ScriptApp.getProjectTriggers();
  const exists = triggers.some(function (t) {
    return (
      t.getHandlerFunction() === 'onFormSubmit' &&
      t.getEventType() === ScriptApp.EventType.ON_FORM_SUBMIT &&
      t.getTriggerSource() === ScriptApp.TriggerSource.FORMS
    );
  });
  if (exists) {
    console.log('installFormSubmitTriggerOnForm_: 既にフォーム用 onFormSubmit トリガーがあります');
    return;
  }
  ScriptApp.newTrigger('onFormSubmit').forForm(form).onFormSubmit().create();
  console.log('installFormSubmitTriggerOnForm_: フォーム用 onFormSubmit トリガーを作成しました');
}

/**
 * 手動テスト用（実際にはLINEに1通送ります）
 */
function debug_pushSampleOrderToLine() {
  const text = buildOrderLineMessage_(
    {
      site: 'ダイアパレス高松西',
      product: '脚立 6尺',
      quantity: '5',
      delivery: '最短',
      name: '山田 太一',
      phone: '080-1234-5678'
    },
    { appendFormPushMark: true }
  );
  lineMessagingPushText_(getLinePushTargetId_(), text);
}

// LIFF画面を表示するための「窓口」
function doGet() {
  return HtmlService.createHtmlOutputFromFile('index') // index.htmlを読み込む
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setTitle('注文フォーム');
}

/**
 * フォームの回答から除外項目を除き、商品名→規格→サイズなどを順序通りに結合し、
 * 重複を排除して返す。
 */
function extractFormAnswers_(inputData) {
  // inputData が配列（{title, value} のリスト）か、従来の namedValues オブジェクトかを判定して吸収
  let items = [];
  if (Array.isArray(inputData)) {
    items = inputData;
  } else {
    const nv = inputData || {};
    const keys = Object.keys(nv);
    for (let i = 0; i < keys.length; i++) {
      const title = keys[i];
      const valArr = nv[title];
      const val = (valArr && valArr.length > 0) ? String(valArr[0]) : "";
      items.push({ title: title, value: val });
    }
  }
  
  // 1. 除外したい項目（これらは商品名として合体させない）
  const ignoreTitles = ['現場名', '現場', '種類', '数量', '個数', '単位', '搬入日', '納品日', '名前', '氏名', '電話番号', '電話', 'タイムスタンプ', '発注タイプ', 'カテゴリ', '備考'];

  let productLines = [];
  let currentWords = [];

  // 2. フォームの全ての回答を順番にチェック
  for (let i = 0; i < items.length; i++) {
    const title = items[i].title;
    const val = items[i].value ? items[i].value.trim() : "";

    // 空欄や「次へ」は無視
    if (!val || val === "次へ" || val === "確定") continue;

    // 除外リストにあるものは無視
    const isIgnore = ignoreTitles.some(ignore => title.includes(ignore));
    if (isIgnore) continue;

    // 「商品」「品名」「資材」等のキーワードが含まれる設問が来たら
    // 新しい資材ブロックが始まったとみなして改行で区切る
    if ((title.includes("商品") || title.includes("品名") || title.includes("資材") || title.includes("材")) && currentWords.length > 0) {
      // 直前が同じ商品の質問グループかもしれないが、念の為ここで区切る
      // ただし「基本材」「特殊材」は弾かれた後なので純粋な資材名項目である可能性が高い
      productLines.push(currentWords.join(' '));
      currentWords = [];
    }

    // 「スパン数」の設問だけ、値に「スパン」を自動付与（例: "3" → "3スパン"）
    let processVal = val;
    if (title.includes('スパン数')) {
      processVal = val.replace(/[^0-9.０-９]/g, '') + 'スパン';
    }

    // 回答テキストを半角スペースで単語に分割し、重複チェックして追加
    const words = processVal.split(/[\s　]+/);
    for (let w = 0; w < words.length; w++) {
      const word = words[w];
      if (!word) continue;
      // 改善：「その他」という単語は邪魔になるので無視
      if (word === "その他") continue;
      
      // 包含関係をチェック（例：「ボックスクランプ」と「100角ボックスクランプ」の重複を防ぐ）
      let shouldAdd = true;
      for (let j = currentWords.length - 1; j >= 0; j--) {
        const existingWord = currentWords[j];
        if (existingWord.includes(word)) {
          // 既存の単語が「100角ボックスクランプ」で、新しい単語が「ボックスクランプ」の場合
          shouldAdd = false;
          break;
        } else if (word.includes(existingWord)) {
          // 新しい単語が「100角ボックスクランプ」で、既存の単語が「ボックスクランプ」の場合
          currentWords.splice(j, 1);
        }
      }
      
      if (shouldAdd) {
        currentWords.push(word);
      }
    }
  }

  // 最後のブロックを追加
  if (currentWords.length > 0) {
    productLines.push(currentWords.join(' '));
  }

  const fullProduct = productLines.join('\n').trim();

  // 4. その他の項目を抽出
  function pick_(aliases) {
    for (let a = 0; a < aliases.length; a++) {
      const alias = aliases[a];
      for (let j = 0; j < items.length; j++) {
        if (items[j].title.includes(alias)) return String(items[j].value).trim();
      }
    }
    return '';
  }

  return {
    site: pick_(['現場名', '現場']),
    product: fullProduct,
    quantity: pick_(['数量', '個数']),
    delivery: pick_(['搬入日', '納品日']) || '最短',
    name: pick_(['名前', '氏名']),
    phone: pick_(['電話番号', '電話'])
  };
}
