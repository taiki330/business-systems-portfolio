/**
 * 現場確認プロジェクト共通ユーティリティ。
 * 大本DB・職人進捗管理の normalizeSiteName と同一ロジックを維持すること。
 *
 * 注意: GAS 組み込みの Utilities（formatDate 等）と名前が衝突しないよう、
 * オブジェクト名は SiteNameUtils とする。
 */
var SiteNameUtils = (function () {
  var SITE_ID_SUFFIX_PATTERN = /\s+__(SITE-\d+)\s*$/i;

  /**
   * 現場名のマスタ照合・重複判定用に正規化する。
   * - 全角英数字（０-９Ａ-Ｚａ-ｚ）→ 半角
   * - 前後の空白削除、途中の連続空白は半角スペース1つに
   * - ㈱・（株）・(株) および括弧の混在を "(株)" に統一
   *
   * @param {*} value
   * @returns {string}
   */
  function normalizeSiteName(value) {
    if (value === null || value === undefined) return '';
    var s = String(value);
    s = s.replace(/\u337F/g, '(株)');
    s = s.replace(/\uFF08\u682A\uFF09/g, '(株)');
    s = s.replace(/\uFF08\u682A\)/g, '(株)');
    s = s.replace(/\(\u682A\uFF09/g, '(株)');
    s = s.replace(/[０-９Ａ-Ｚａ-ｚ]/g, function (ch) {
      return String.fromCharCode(ch.charCodeAt(0) - 0xfee0);
    });
    s = s.replace(/\u3000/g, ' ');
    s = s.trim();
    s = s.replace(/\s+/g, ' ');
    return s;
  }

  function normalizeName(value) {
    return normalizeSiteName(value);
  }

  function sanitizeName(name) {
    return String(name || '')
      .replace(/[\\/#$%*?:<>|"]/g, '-')
      .trim() || 'untitled';
  }

  function folderKeyFromSiteName(displayName) {
    return sanitizeName(normalizeSiteName(displayName));
  }

  function stripSiteIdSuffix(name) {
    return String(name || '').replace(SITE_ID_SUFFIX_PATTERN, '').trim();
  }

  function extractSiteIdFromFolderName(folderName) {
    var m = String(folderName || '').match(SITE_ID_SUFFIX_PATTERN);
    return m ? m[1].toUpperCase() : '';
  }

  return {
    normalizeSiteName: normalizeSiteName,
    normalizeName: normalizeName,
    sanitizeName: sanitizeName,
    folderKeyFromSiteName: folderKeyFromSiteName,
    stripSiteIdSuffix: stripSiteIdSuffix,
    extractSiteIdFromFolderName: extractSiteIdFromFolderName
  };
})();
