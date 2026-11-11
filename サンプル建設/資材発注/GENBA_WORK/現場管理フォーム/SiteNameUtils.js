/**
 * 現場名の正規化・folderKey（大本DB / 職人進捗管理と同一ロジック）
 */
var SiteNameUtils = (function() {
  var SITE_ID_SUFFIX_PATTERN = /\s+__(SITE-\d+)\s*$/i;

  function normalizeSiteName(value) {
    if (value === null || value === undefined) return '';
    var s = String(value);
    s = s.replace(/\u337F/g, '(株)');
    s = s.replace(/\uFF08\u682A\uFF09/g, '(株)');
    s = s.replace(/\uFF08\u682A\)/g, '(株)');
    s = s.replace(/\(\u682A\uFF09/g, '(株)');
    s = s.replace(/[０-９Ａ-Ｚａ-ｚ]/g, function(ch) {
      return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0);
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
