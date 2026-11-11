/**
 * LINE Messaging API（Push）送信ユーティリティ
 *
 * Script Properties:
 * - LINE_CHANNEL_ACCESS_TOKEN
 * - LINE_USER_IDS（カンマ区切り userId）
 * - LINE_NOTIFY_ENABLED（'true' のときのみ送信）
 */
var LineNotifyService = (function() {
  var PUSH_ENDPOINT = 'https://api.line.me/v2/bot/message/push';
  var MAX_TEXT_LEN = 4800;

  var PROP_TOKEN = 'LINE_CHANNEL_ACCESS_TOKEN';
  var PROP_USER_IDS = 'LINE_USER_IDS';
  var PROP_ENABLED = 'LINE_NOTIFY_ENABLED';

  function getProps_() {
    return PropertiesService.getScriptProperties();
  }

  /**
   * @returns {{ enabled: boolean, token: string, userIds: string[] }}
   */
  function getLineConfig() {
    var props = getProps_();
    var enabled = String(props.getProperty(PROP_ENABLED) || '').trim().toLowerCase() === 'true';
    var token = String(props.getProperty(PROP_TOKEN) || '').trim();
    var rawIds = String(props.getProperty(PROP_USER_IDS) || '').trim();
    var userIds = rawIds
      ? rawIds.split(',').map(function(x) { return String(x || '').trim(); }).filter(function(x) { return !!x; })
      : [];
    return { enabled: enabled, token: token, userIds: userIds };
  }

  function buildHeaders_(token) {
    return {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json'
    };
  }

  function truncateText_(text) {
    var s = String(text == null ? '' : text);
    if (s.length <= MAX_TEXT_LEN) return s;
    return s.slice(0, MAX_TEXT_LEN - 20) + '\n…（以下省略）';
  }

  /**
   * @param {string} to userId / groupId / roomId
   * @param {string} text
   * @returns {{ ok: boolean, code: number, body: string }}
   */
  function pushText(to, text) {
    var cfg = getLineConfig();
    if (!cfg.enabled) {
      return { ok: false, skipped: true, reason: 'disabled' };
    }
    if (!cfg.token) {
      throw new Error('Script Properties の LINE_CHANNEL_ACCESS_TOKEN が未設定です。');
    }
    var target = String(to || '').trim();
    if (!target) {
      throw new Error('送信先 userId が空です。');
    }
    var payload = {
      to: target,
      messages: [{ type: 'text', text: truncateText_(text) }]
    };
    var res = UrlFetchApp.fetch(PUSH_ENDPOINT, {
      method: 'post',
      headers: buildHeaders_(cfg.token),
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    var code = res.getResponseCode();
    var body = res.getContentText();
    if (code < 200 || code >= 300) {
      throw new Error('LINE push failed: ' + code + ' / ' + body);
    }
    return { ok: true, code: code, body: body };
  }

  /**
   * @param {string} text
   * @param {string[]} [userIdsOpt]
   * @returns {{ sent: number, failed: number, skipped: boolean, errors: Array<{userId: string, error: string}> }}
   */
  function pushTextToMany(text, userIdsOpt) {
    var cfg = getLineConfig();
    if (!cfg.enabled) {
      return { sent: 0, failed: 0, skipped: true, errors: [] };
    }
    if (!cfg.token) {
      throw new Error('Script Properties の LINE_CHANNEL_ACCESS_TOKEN が未設定です。');
    }
    var ids = userIdsOpt && userIdsOpt.length ? userIdsOpt : cfg.userIds;
    if (!ids.length) {
      throw new Error('Script Properties の LINE_USER_IDS が未設定です。');
    }
    var sent = 0;
    var failed = 0;
    var errors = [];
    ids.forEach(function(id) {
      try {
        pushText(id, text);
        sent += 1;
      } catch (e) {
        failed += 1;
        errors.push({ userId: id, error: String(e && e.message ? e.message : e) });
      }
    });
    return { sent: sent, failed: failed, skipped: false, errors: errors };
  }

  return {
    getLineConfig: getLineConfig,
    pushText: pushText,
    pushTextToMany: pushTextToMany
  };
})();
