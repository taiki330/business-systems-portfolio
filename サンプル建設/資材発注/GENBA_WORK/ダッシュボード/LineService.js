/**
 * LINE Messaging API（Push）送信ユーティリティ
 *
 * Script Properties で管理するキー:
 * - LINE_CHANNEL_ACCESS_TOKEN: チャネルアクセストークン（長期）
 * - LINE_USER_IDS: 送信先 userId をカンマ区切りで（例: Uxxx,Uyyy）
 * - LINE_ALERT_STATE_JSON: 自動管理。前回実行時点の warning/danger スナップショット（差分検知用）
 */
var LineService = (function() {
  var PUSH_ENDPOINT = 'https://api.line.me/v2/bot/message/push';
  var MAX_TEXT_LEN = 4800; // 念のため少し余裕を持たせる
  var LINE_ALERT_STATE_JSON_KEY = 'LINE_ALERT_STATE_JSON';

  function getProps_() {
    return PropertiesService.getScriptProperties();
  }

  function getToken_() {
    var token = String(getProps_().getProperty('LINE_CHANNEL_ACCESS_TOKEN') || '').trim();
    return token;
  }

  function getUserIds_() {
    var raw = String(getProps_().getProperty('LINE_USER_IDS') || '').trim();
    if (!raw) return [];
    return raw
      .split(',')
      .map(function(x) {
        return String(x || '').trim();
      })
      .filter(function(x) {
        return !!x;
      });
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

  function pushText_(token, userId, text) {
    var payload = {
      to: userId,
      messages: [{ type: 'text', text: truncateText_(text) }]
    };
    var res = UrlFetchApp.fetch(PUSH_ENDPOINT, {
      method: 'post',
      headers: buildHeaders_(token),
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
   * テキストを userIds 全員へ push する（1人ずつ）
   * @returns {{sent:number, failed:number, errors:Array<{userId:string, error:string}>}}
   */
  function pushTextToMany(userIds, text) {
    var token = getToken_();
    if (!token) {
      throw new Error('Script Properties の LINE_CHANNEL_ACCESS_TOKEN が未設定です。');
    }
    var ids = userIds && userIds.length ? userIds : getUserIds_();
    if (!ids.length) {
      throw new Error('Script Properties の LINE_USER_IDS が未設定です。');
    }
    var sent = 0;
    var failed = 0;
    var errors = [];
    ids.forEach(function(id) {
      try {
        pushText_(token, id, text);
        sent += 1;
      } catch (e) {
        failed += 1;
        errors.push({ userId: id, error: String(e && e.message ? e.message : e) });
      }
    });
    return { sent: sent, failed: failed, errors: errors };
  }

  function alertItemKey_(item) {
    return String(item.siteName || '') + '::' + String(item.type || '');
  }

  function normalizedLevel_(item) {
    return item.level === 'danger' ? 'danger' : 'warning';
  }

  function loadAlertState_() {
    var raw = String(getProps_().getProperty(LINE_ALERT_STATE_JSON_KEY) || '').trim();
    if (!raw) {
      return { hasBaseline: false, keys: {} };
    }
    try {
      var o = JSON.parse(raw);
      if (!o || typeof o !== 'object') {
        return { hasBaseline: false, keys: {} };
      }
      var keys = o.keys && typeof o.keys === 'object' ? o.keys : {};
      return { hasBaseline: true, keys: keys };
    } catch (ignore) {
      return { hasBaseline: false, keys: {} };
    }
  }

  function saveAlertState_(items) {
    var keys = {};
    (items || []).forEach(function(item) {
      keys[alertItemKey_(item)] = normalizedLevel_(item);
    });
    getProps_().setProperty(
      LINE_ALERT_STATE_JSON_KEY,
      JSON.stringify({ v: 1, keys: keys })
    );
  }

  /**
   * 前回スナップショットと比較し、新規に warning/danger になった行、または warning→danger に悪化した行だけ返す。
   */
  function diffNewOrEscalated_(currentItems, lastKeys) {
    var out = [];
    (currentItems || []).forEach(function(item) {
      var key = alertItemKey_(item);
      var cur = normalizedLevel_(item);
      var prev = lastKeys[key];
      if (prev === undefined || prev === null || prev === '') {
        out.push(item);
      } else if (prev === 'warning' && cur === 'danger') {
        out.push(item);
      }
    });
    return out;
  }

  function buildNewAlertsPlainText_(items) {
    if (!items.length) return '';
    var sorted = items.slice().sort(function(a, b) {
      var ra = a.level === 'danger' ? 0 : 1;
      var rb = b.level === 'danger' ? 0 : 1;
      if (ra !== rb) return ra - rb;
      return 0;
    });
    var lines = sorted.map(function(x) {
      var tag = x.level === 'danger' ? '【danger】' : '【warning】';
      return tag + x.line;
    });
    return '【ダッシュボード】新規・悪化アラート ' + items.length + '件\n' + lines.join('\n');
  }

  /**
   * 日次トリガー想定: 前回保存状態と比較し、新規・悪化分だけ LINE 送信。
   * - 初回（LINE_ALERT_STATE_JSON 未設定）: 現在状態を保存するだけ（LINEは送らない）
   * - 新規・悪化が0件: LINE 送らず、スナップショットだけ更新（解消反映）
   * - 送信後、全 userId 成功時のみスナップショット更新（一部失敗時は次回再試行で重複しうる）
   */
  function sendDashboardWarningsDigestToConfiguredUsers() {
    var currentItems = AlertService.getLineNotificationItems();
    var state = loadAlertState_();

    if (!state.hasBaseline) {
      saveAlertState_(currentItems);
      return {
        skipped: true,
        reason: 'baseline_initialized',
        message:
          '初回です。現在のアラート状態を基準として保存しました（LINEは送っていません）。次回から新規・悪化のみ通知します。',
        newCount: 0,
        currentCount: currentItems.length,
        sent: 0,
        failed: 0,
        errors: []
      };
    }

    var newItems = diffNewOrEscalated_(currentItems, state.keys);
    if (!newItems.length) {
      saveAlertState_(currentItems);
      return {
        skipped: true,
        reason: 'no_new_or_escalated_alerts',
        newCount: 0,
        currentCount: currentItems.length,
        sent: 0,
        failed: 0,
        errors: []
      };
    }

    var text = buildNewAlertsPlainText_(newItems);
    var result = pushTextToMany(null, text);
    result.skipped = false;
    result.reason = '';
    result.newCount = newItems.length;
    result.currentCount = currentItems.length;
    if (result.failed === 0) {
      saveAlertState_(currentItems);
    } else {
      result.stateNotUpdated = true;
    }
    return result;
  }

  /**
   * 差分基準を消去。次の sendDashboardWarningsToLine は再ベースライン（LINE送信なし）になる。
   */
  function resetLineAlertNotificationBaseline() {
    getProps_().deleteProperty(LINE_ALERT_STATE_JSON_KEY);
    return {
      ok: true,
      message:
        'LINE_ALERT_STATE_JSON を削除しました。次の実行で初回ベースライン（LINE送信なし）になります。'
    };
  }

  /**
   * 手動テスト用：設定済みの先頭 userId に送る
   */
  function sendTestToFirstUser(text) {
    var ids = getUserIds_();
    if (!ids.length) {
      throw new Error('Script Properties の LINE_USER_IDS が未設定です。');
    }
    var token = getToken_();
    if (!token) {
      throw new Error('Script Properties の LINE_CHANNEL_ACCESS_TOKEN が未設定です。');
    }
    return pushText_(token, ids[0], String(text || 'LINE送信テスト'));
  }

  return {
    pushTextToMany: pushTextToMany,
    sendDashboardWarningsDigestToConfiguredUsers: sendDashboardWarningsDigestToConfiguredUsers,
    resetLineAlertNotificationBaseline: resetLineAlertNotificationBaseline,
    sendTestToFirstUser: sendTestToFirstUser
  };
})();

