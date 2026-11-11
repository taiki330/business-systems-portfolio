/**
 * フォーム回答データを扱うユーティリティ集。
 */
var FormUtils = (function() {
  function getFirstValue(namedValues, key) {
    if (!namedValues || !key) return '';
    var value = namedValues[key];
    if (!value || value.length === 0) return '';
    return value[0];
  }

  function getFileUrls(namedValues, key) {
    var raw = getFirstValue(namedValues, key);
    if (!raw) return [];
    return raw.split(',').map(function(item) {
      return item.trim();
    }).filter(function(item) {
      return item;
    });
  }

  function parseDate(value) {
    if (!value) return null;

    // 既にDateオブジェクトなら返す
    if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
      return value;
    }

    // 数値の場合：Excelシリアル値として処理（25569以上なら日付、それ以下はタイムスタンプ扱い）
    if (typeof value === 'number') {
      if (value > 25569 && value < 100000) {
        // Excelシリアル値: 1899/12/30を基準とした日数
        var excelEpoch = new Date(1899, 11, 30);
        return new Date(excelEpoch.getTime() + value * 24 * 60 * 60 * 1000);
      }
      // それ以外の数値はUnixタイムスタンプとして試す
      var fromTimestamp = new Date(value);
      if (!isNaN(fromTimestamp.getTime())) return fromTimestamp;
    }

    // 文字列の場合：通常のDate解析
    var date = new Date(value);
    if (isNaN(date.getTime())) return null;
    return date;
  }

  function addDays(date, days) {
    if (!date) return null;
    var result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
  }

  function formatDate(date, format) {
    if (!date) return '';
    return Utilities.formatDate(date, Session.getScriptTimeZone(), format || 'yyyy/MM/dd');
  }

  function composeMessage(title, siteName, namedValues, fieldNames) {
    var lines = [];
    if (title || siteName) {
      lines.push('【' + (title || '') + '】' + (siteName || ''));
    }
    (fieldNames || []).forEach(function(field) {
      var value = getFirstValue(namedValues, field);
      if (value) {
        lines.push(field + ': ' + value);
      }
    });
    return lines.join('\n');
  }

  function getFlexibleValue(namedValues, key) {
    if (!namedValues || !key) return '';
    var direct = getFirstValue(namedValues, key);
    if (direct) return direct;
    var matchedKey = findKeyByLooseMatch(namedValues, key);
    return matchedKey ? getFirstValue(namedValues, matchedKey) : '';
  }

  function findKeyByLooseMatch(namedValues, targetKey) {
    var keys = namedValues ? Object.keys(namedValues) : [];
    if (!keys.length || !targetKey) return '';
    var normalizedTarget = normalizeQuestionTitle(targetKey);
    for (var i = 0; i < keys.length; i++) {
      if (normalizeQuestionTitle(keys[i]) === normalizedTarget) {
        return keys[i];
      }
    }
    for (var j = 0; j < keys.length; j++) {
      if (keys[j].indexOf(targetKey) !== -1) {
        return keys[j];
      }
    }
    return '';
  }

  function normalizeQuestionTitle(title) {
    if (!title) return '';
    var withoutPrefix = title.replace(/^[\s\u2460-\u2473\u3251-\u325f\u32b1-\u32bf\d一二三四五六七八九十〇]+[\.．:：、\-\)\(\uFF09\uFF08\s]*/g, '');
    return withoutPrefix.replace(/\s+/g, '').toLowerCase();
  }

  /**
   * ハイブリッド方式で現場名を取得する。
   * 既存現場選択 → 新規現場入力 → ハンドラー内定数 → config設定の順で探す。
   * 新規現場の場合は自動的に稼働現場リストに登録する。
   * @param {Object} namedValues フォームの回答データ
   * @param {string} existingSiteField 既存現場選択の質問タイトル
   * @param {string} newSiteField 新規現場入力の質問タイトル
   * @param {string} fallbackField フォールバック用の質問タイトル
   * @param {Object} phaseConfig フェーズ設定
   * @return {string} 現場名
   */
  function getSiteName(namedValues, existingSiteField, newSiteField, fallbackField, phaseConfig) {
    // Use getFlexibleValue to handle potential whitespace differences in headers
    var existingSite = getFlexibleValue(namedValues, existingSiteField);
    var newSite = getFlexibleValue(namedValues, newSiteField);
    
    var siteName = '';
    if (existingSite && existingSite !== '新規現場を入力') {
      siteName = existingSite;
    } else if (newSite) {
      // マスタ更新を無効化: フォーム送信時に現場名マスタを更新しない
      // if (typeof MasterSync !== 'undefined' && MasterSync.registerSiteIfNew) {
      //   MasterSync.registerSiteIfNew(newSite);
      // }
      siteName = newSite;
    } else if (fallbackField) {
      siteName = getFlexibleValue(namedValues, fallbackField);
    } else if (phaseConfig && phaseConfig.siteQuestionTitle) {
      siteName = getFlexibleValue(namedValues, phaseConfig.siteQuestionTitle);
    }
    
    // [NEW] Broad Match Fallback
    if (!siteName) {
      var broadKey = findKeyByBroadMatch(namedValues, ['現場', '工事名', '案件名', '工事名称']);
      if (broadKey) {
        siteName = getFirstValue(namedValues, broadKey);
        Logger.log('FormUtils: Found site name via broad match using key: ' + broadKey);
      }
    }
    
    return siteName ? siteName.toString().trim() : '';
  }

  function findKeyByBroadMatch(namedValues, keywords) {
    var keys = namedValues ? Object.keys(namedValues) : [];
    if (!keys.length || !keywords || !keywords.length) return '';
    
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      for (var j = 0; j < keywords.length; j++) {
        if (key.indexOf(keywords[j]) !== -1) {
          return key;
        }
      }
    }
    return '';
  }

  function applyQuarantineToUpdates_(updates, folderContext, memoFieldKey) {
    if (!folderContext || !folderContext.isQuarantine) {
      return updates;
    }
    var note =
      '【要確認】保存先不整合のため隔離保存 (' +
      (folderContext.quarantineReason || '') +
      '): ' +
      (folderContext.quarantineFolderUrl || '');
    updates['現場フォルダURL'] = folderContext.quarantineFolderUrl || updates['現場フォルダURL'];
    if (memoFieldKey) {
      var existing = updates[memoFieldKey] ? String(updates[memoFieldKey]) : '';
      updates[memoFieldKey] = existing ? note + '\n' + existing : note;
    }
    return updates;
  }

  return {
    getFirstValue: getFirstValue,
    getFileUrls: getFileUrls,
    parseDate: parseDate,
    addDays: addDays,
    formatDate: formatDate,
    composeMessage: composeMessage,
    getSiteName: getSiteName,
    applyQuarantineToUpdates_: applyQuarantineToUpdates_
  };
})();
