/**
 * Google Drive フォルダ管理・写真アップロードサービス
 *
 * フォルダ構造（新規・推奨）:
 *   [rootDriveFolderId]/
 *   └── {現場名の要約} [案件ID]/
 *       ├── 是正前/
 *       └── 是正後/
 *
 * 旧版（互換用に参照のみ。新規は上記へ一本化）:
 *   {現場名}/ {案件ID} / 是正前|是正後
 *
 * 原因: 同じ表示の現場名でフォルダが1つにまとまり、別案件の写真が同じ階層に入る。
 * また ensureFolder 同時実行で同名サブフォルダが重複し得る。
 * 案件IDをフォルダ名に含め一意化し、ScriptLock で作成を直列化する。
 */
const DriveService = (() => {
  const MIME_JPEG = 'image/jpeg';
  const FOLDER_BEFORE = '是正前';
  const FOLDER_AFTER = '是正後';
  const MAX_SITE_IN_FOLDER_NAME = 80;

  /**
   * ルート直下の「案件1件分の親フォルダ」名（案件ID付きで一意）
   * @param {string} siteName
   * @param {string} caseId
   * @returns {string}
   */
  const buildCaseRootFolderName = (siteName, caseId) => {
    const cid = String(caseId || '').trim() || 'unknown-case';
    let s = Utilities_.sanitizeName(siteName) || 'untitled';
    if (s.length > MAX_SITE_IN_FOLDER_NAME) {
      s = s.slice(0, MAX_SITE_IN_FOLDER_NAME) + '…';
    }
    return s + ' [' + cid + ']';
  };

  /**
   * 親の直下に同名が無ければ1つ作る。呼び出し側で必要なら ScriptLock 済み。
   * @param {Folder} parentFolder
   * @param {string} name
   * @returns {Folder}
   */
  const getOrCreateChildFolder_ = (parentFolder, name) => {
    const sanitized = Utilities_.sanitizeName(name);
    const iterator = parentFolder.getFoldersByName(sanitized);
    if (iterator.hasNext()) {
      return iterator.next();
    }
    return parentFolder.createFolder(sanitized);
  };

  /**
   * 旧構造 {root}/{現場}/{案件ID}/ を辿る。見つかればその案件フォルダを返す。
   * 複数の同名「現場」があっても、直下に {caseId} がある方を採用。
   * @param {Folder} root
   * @param {string} caseId
   * @param {string} siteName
   * @returns {Folder|null}
   */
  const findLegacyCaseFolder_ = (root, caseId, siteName) => {
    const siteLabel = Utilities_.sanitizeName(siteName) || 'untitled';
    const id = String(caseId || '').trim();
    if (!id) {
      return null;
    }
    const siteIter = root.getFoldersByName(siteLabel);
    while (siteIter.hasNext()) {
      const siteF = siteIter.next();
      const under = siteF.getFoldersByName(id);
      if (under.hasNext()) {
        return under.next();
      }
    }
    return null;
  };

  /**
   * 案件ルート（是正前/是正後の親）を取得または作成
   * @param {Folder} root
   * @param {string} caseId
   * @param {string} siteName
   * @param {boolean} [locked] 外側で Lock 取得済みなら true
   * @returns {Folder}
   */
  const getOrCreateCaseRootFolder_ = (root, caseId, siteName) => {
    const newName = buildCaseRootFolderName(siteName, caseId);
    const foundNew = root.getFoldersByName(newName);
    if (foundNew.hasNext()) {
      return foundNew.next();
    }
    const legacy = findLegacyCaseFolder_(root, caseId, siteName);
    if (legacy) {
      return legacy;
    }
    return root.createFolder(newName);
  };

  /**
   * 案件フォルダを準備（現場＋案件IDで一意。是正前/是正後 作成は同時実行を防ぐ）
   * @param {string} caseId - 案件ID
   * @param {string} siteName - 現場名
   * @returns {{ caseFolder: Folder, beforeFolder: Folder, afterFolder: Folder, caseFolderId: string }}
   */
  const prepareCaseFolder = (caseId, siteName) => {
    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      const root = getRootFolder();
      const caseRoot = getOrCreateCaseRootFolder_(root, caseId, siteName);
      const beforeFolder = getOrCreateChildFolder_(caseRoot, FOLDER_BEFORE);
      const afterFolder = getOrCreateChildFolder_(caseRoot, FOLDER_AFTER);

      return {
        caseFolder: caseRoot,
        beforeFolder: beforeFolder,
        afterFolder: afterFolder,
        caseFolderId: caseRoot.getId()
      };
    } finally {
      lock.releaseLock();
    }
  };

  /**
   * ルートフォルダを取得する
   * @returns {Folder}
   */
  const getRootFolder = () => {
    const rootId = APP_CONFIG.rootDriveFolderId;
    return rootId ? DriveApp.getFolderById(rootId) : DriveApp.getRootFolder();
  };

  /**
   * Base64文字列をデコードしてBlobを生成する
   * @param {string} base64 - Base64エンコード文字列（data URI可）
   * @param {string} fileName - ファイル名
   * @returns {Blob}
   */
  const decodeToBlob = (base64, fileName) => {
    const payload = base64.includes(',') ? base64.split(',')[1] : base64;
    const decoded = Utilities.base64Decode(payload);
    return Utilities.newBlob(decoded, MIME_JPEG, fileName);
  };

  /**
   * ファイルを共有設定（リンクを知っている全員が閲覧可能）にする
   * @param {File} driveFile - Google Driveファイル
   */
  const setPublicViewAccess = (driveFile) => {
    driveFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  };

  /**
   * 是正前写真をバッチアップロードする（案件新規作成時）
   * @param {{ caseId: string, siteName: string, photos: Array<{ base64: string, filename: string, detailOrder: number }> }} params
   * @returns {Array<{ detailOrder: number, url: string, fileId: string }>}
   */
  const uploadBeforePhotos = ({ caseId, siteName, photos }) => {
    if (!photos || photos.length === 0) return [];

    const { beforeFolder } = prepareCaseFolder(caseId, siteName);

    return photos.map(photo => {
      const fileName = `${String(photo.detailOrder).padStart(3, '0')}_是正前.jpg`;
      const blob = decodeToBlob(photo.base64, fileName);
      const file = beforeFolder.createFile(blob);
      setPublicViewAccess(file);

      return {
        detailOrder: photo.detailOrder,
        url: file.getUrl(),
        fileId: file.getId()
      };
    });
  };

  /**
   * 案件フォルダを事前準備する（フロントからのバッチアップロード用）
   * @param {string} caseId - 案件ID
   * @param {string} siteName - 現場名
   * @returns {{ caseFolderId: string, beforeFolderId: string, afterFolderId: string }}
   */
  const prepareCaseFolderForBatch = (caseId, siteName) => {
    const { caseFolder, beforeFolder, afterFolder } = prepareCaseFolder(caseId, siteName);

    return {
      caseFolderId: caseFolder.getId(),
      beforeFolderId: beforeFolder.getId(),
      afterFolderId: afterFolder.getId()
    };
  };

  /**
   * 写真をバッチアップロードする（フロントからの並列呼び出し用）
   * @param {{ files: Array<{ base64: string, originalName: string, order: number }>, folderId: string, subfolder: string, namePrefix: string }} params
   * @returns {Array<{ order: number, url: string, fileId: string }>}
   */
  const uploadPhotoBatch = ({ files, folderId, subfolder, namePrefix }) => {
    if (!files || files.length === 0) return [];

    let targetFolder = DriveApp.getFolderById(folderId);
    if (subfolder) {
      const lock = LockService.getScriptLock();
      lock.waitLock(20000);
      try {
        targetFolder = getOrCreateChildFolder_(targetFolder, subfolder);
      } finally {
        lock.releaseLock();
      }
    }

    const prefix = namePrefix || '';

    return files.map(file => {
      const fileName = `${prefix}${String(file.order).padStart(3, '0')}.jpg`;
      const blob = decodeToBlob(file.base64, fileName);
      const created = targetFolder.createFile(blob);
      setPublicViewAccess(created);

      return {
        order: file.order,
        url: created.getUrl(),
        fileId: created.getId()
      };
    });
  };

  /**
   * 是正後写真をアップロードする（現場からのアップロード）
   * @param {{ caseId: string, siteName: string, detailId: string, detailOrder: number, base64: string }} params
   * @returns {{ url: string, fileId: string }}
   */
  const uploadAfterPhoto = ({ caseId, siteName, detailId, detailOrder, base64 }) => {
    const { afterFolder } = prepareCaseFolder(caseId, siteName);
    const fileName = `${String(detailOrder).padStart(3, '0')}_是正後.jpg`;
    const blob = decodeToBlob(base64, fileName);
    const file = afterFolder.createFile(blob);
    setPublicViewAccess(file);

    return {
      url: file.getUrl(),
      fileId: file.getId()
    };
  };

  return {
    prepareCaseFolder,
    uploadBeforePhotos,
    prepareCaseFolderForBatch,
    uploadPhotoBatch,
    uploadAfterPhoto
  };
})();
