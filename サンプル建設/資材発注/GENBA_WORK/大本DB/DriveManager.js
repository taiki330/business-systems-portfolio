/**
 * Drive フォルダ名の正規化（大本DBマスタ同期用）
 * 現場表示名 → normalizeName → パス用サニタイズ
 */

function DriveManager_sanitizeFolderSegment(name) {
  return String(name || '')
    .replace(/[\\/#$%*?:<>|"]/g, '-')
    .trim() || 'untitled';
}

/**
 * Drive 上のフォルダ名キー（名寄せ＋禁止文字除去）
 * normalizeName と同じく Utilities.normalizeSiteName を使用（読込順に依存しないため）
 * @param {string} siteDisplayName
 * @returns {string}
 */
function DriveManager_folderKeyFromSiteName(siteDisplayName) {
  return DriveManager_sanitizeFolderSegment(normalizeSiteName(siteDisplayName));
}
