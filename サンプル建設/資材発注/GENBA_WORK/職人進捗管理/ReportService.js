/**
 * Handles report submission + logging.
 */
const ReportService = (() => {
  const validatePayload = payload => {
    if (!payload) {
      throw new Error('データが空です。');
    }
  };

  const SHEET_APPEND_MAX_ATTEMPTS = 3;
  const APPEND_RETRY_BASE_MS = 400;
  const SHEET_TIMEZONE = 'Asia/Tokyo';
  const SHEET_TIMESTAMP_FORMAT = 'yyyy/MM/dd HH:mm:ss';

  /** setValues 向けに null/undefined を空文字にそろえる */
  const normalizeRowForSheet = row =>
    row.map(cell => (cell === undefined || cell === null ? '' : cell));

  /** 報告データの「最終行」を判定するための基準列（1始まり）。右端の無関係セルで getLastRow が膨らんでもずれにくい */
  const pickKeyColumn1Based = headers => {
    const list = (headers || []).map(h => String(h || '').trim());
    let idx = list.findIndex(h => h === '送信日時' || h === 'Timestamp');
    if (idx >= 0) return idx + 1;
    idx = list.findIndex(h => h === 'MetaJSON');
    if (idx >= 0) return idx + 1;
    idx = list.findIndex(h => h === '現場ID' || h === 'SiteId');
    if (idx >= 0) return idx + 1;
    idx = list.findIndex(h => h === '報告種別' || h === 'ReportType');
    if (idx >= 0) return idx + 1;
    return 1;
  };

  /**
   * 2〜maxRow 行のうち、キー列に値がある最も下の行（1始まり）。データなしなら 1（ヘッダーのみ）
   * ※ Sheet.getRange(row, col, numRows, numColumns) の 3・4 目は「終了座標」ではなく行数・列数
   */
  const computeLastDataRowForKeyCol = (sheet, keyCol1Based, maxRow) => {
    if (maxRow < 2) return 1;
    const numRows = maxRow - 2 + 1;
    const colVals = sheet.getRange(2, keyCol1Based, numRows, 1).getValues();
    let lastDataRow = 1;
    for (let i = 0; i < colVals.length; i += 1) {
      const v = colVals[i][0];
      if (v !== '' && v != null) lastDataRow = i + 2;
    }
    return lastDataRow;
  };

  /**
   * 新規報告行として使える「未使用行」か。
   * 全列を見ると、回答列に下まで入った数式や 0 表示などで「空でない」扱いになり、
   * 実データは上なのに末尾付近へ追記されることがある（稀に午後報告などで顕在化）。
   */
  const rowIsUnusedForReport = (rowValues, headers) => {
    const h = headers || [];
    const tsIdx = h.findIndex(
      x => x === '送信日時' || x === 'Timestamp' || x === 'タイムスタンプ'
    );
    const metaIdx = h.findIndex(x => x === 'MetaJSON');
    let checked = false;
    let usable = true;
    if (tsIdx >= 0 && tsIdx < rowValues.length) {
      checked = true;
      const v = rowValues[tsIdx];
      if (v !== '' && v != null) usable = false;
    }
    if (metaIdx >= 0 && metaIdx < rowValues.length) {
      checked = true;
      const v = rowValues[metaIdx];
      if (v !== '' && v != null) usable = false;
    }
    if (checked) return usable;
    const k = pickKeyColumn1Based(h) - 1;
    if (k < 0 || k >= rowValues.length) return true;
    const v = rowValues[k];
    return v === '' || v == null;
  };

  const findFirstWritableRow = (sheet, maxRow, numCols, headers) => {
    if (maxRow < 2) return 2;
    const scanCols = Math.max(numCols || 1, sheet.getLastColumn(), 1);
    const numRows = maxRow - 2 + 1;
    const rows = sheet.getRange(2, 1, numRows, scanCols).getValues();
    const useKeyCols = headers && headers.length > 0;
    for (let i = 0; i < rows.length; i += 1) {
      const isEmptyRow = useKeyCols
        ? rowIsUnusedForReport(rows[i], headers)
        : rows[i].every(cell => cell === '' || cell === null);
      if (isEmptyRow) return i + 2;
    }
    return maxRow + 1;
  };

  const formatSheetTimestamp = value =>
    Utilities.formatDate(new Date(value || new Date()), SHEET_TIMEZONE, SHEET_TIMESTAMP_FORMAT);

  const mergeImageSaveQuarantineInfo_ = (imageSaveResult, payload, site) => {
    const fromPayload = payload && payload.isQuarantine;
    const fromDrive = imageSaveResult && imageSaveResult.isQuarantine;
    if (!fromPayload && !fromDrive) {
      return imageSaveResult;
    }
    return Object.assign({}, imageSaveResult, {
      isQuarantine: true,
      quarantineReason:
        (imageSaveResult && imageSaveResult.quarantineReason) ||
        (payload && payload.quarantineReason) ||
        '',
      quarantineFolderUrl:
        (imageSaveResult && imageSaveResult.quarantineFolderUrl) ||
        (payload && payload.quarantineFolderUrl) ||
        '',
      quarantineCaseFolderId:
        (imageSaveResult && imageSaveResult.quarantineCaseFolderId) ||
        (payload && payload.quarantineCaseFolderId) ||
        '',
      intendedPath:
        (imageSaveResult && imageSaveResult.intendedPath) || (payload && payload.intendedPath) || '',
      driveFolderIdFromMaster:
        (imageSaveResult && imageSaveResult.driveFolderIdFromMaster) ||
        (payload && payload.driveFolderIdFromMaster) ||
        String((site && site.driveFolderId) || ''),
      actualFolderName:
        (imageSaveResult && imageSaveResult.actualFolderName) ||
        (payload && payload.actualFolderName) ||
        ''
    });
  };

  const buildQuarantineCtxForFinalize_ = (imageSaveResult, payload, site, reportType, submittedAt) => ({
    isQuarantine: true,
    quarantineFolderUrl: imageSaveResult.quarantineFolderUrl,
    quarantineCaseFolderId: imageSaveResult.quarantineCaseFolderId,
    _quarantineCaseFolderId: imageSaveResult.quarantineCaseFolderId,
    _quarantineMeta: {
      system: 'shokunin',
      errorCode: imageSaveResult.quarantineReason || '',
      reason: imageSaveResult.quarantineReason || '',
      siteId: (site && site.id) || '',
      reportSiteName: (payload && payload.siteName) || (site && site.name) || '',
      masterSiteName: (site && site.masterSiteName) || (site && site.name) || '',
      driveFolderId: imageSaveResult.driveFolderIdFromMaster || (site && site.driveFolderId) || '',
      actualFolderName: imageSaveResult.actualFolderName || '',
      reportType: reportType || '',
      buildingName: (payload && payload.buildingName) || '',
      workerName: (payload && payload.reporterName) || '',
      submittedAt: submittedAt || '',
      intendedPath: imageSaveResult.intendedPath || '',
      quarantineFolderUrl: imageSaveResult.quarantineFolderUrl || '',
      originalMode: APP_CONFIG.DRIVE_GUARD_FAILURE_MODE || 'quarantine'
    }
  });

  const finalizeQuarantineIfNeeded_ = (imageSaveResult, payload, site, reportType, submittedAt) => {
    if (!imageSaveResult || !imageSaveResult.isQuarantine) {
      return;
    }
    try {
      const ctx =
        imageSaveResult._quarantineCtx ||
        buildQuarantineCtxForFinalize_(imageSaveResult, payload, site, reportType, submittedAt);
      SiteDriveQuarantine.finalizeQuarantineSave_(ctx, (imageSaveResult.files || []).length);
    } catch (e) {
      Logger.log(
        'ReportService.finalizeQuarantineIfNeeded_ failed (ignored): %s',
        e && e.message ? e.message : e
      );
    }
  };

  const normalizeSheetDateKey = value => {
    if (!value) return '';
    if (value instanceof Date) {
      return Utilities.formatDate(value, SHEET_TIMEZONE, 'yyyy-MM-dd');
    }
    const raw = String(value).trim();
    if (!raw) return '';
    const match = raw.match(/^(\d{4})[\/-](\d{2})[\/-](\d{2})/);
    return match ? `${match[1]}-${match[2]}-${match[3]}` : raw.substring(0, 10).replace(/\//g, '-');
  };

  /**
   * 1行目＝ヘッダー。キー列で「最後のデータ行」を求め、その次の行（空いている連続位置）に setValues。
   * 全行シフトしないためタイムアウトしにくく、別列のゴミで getLastRow が 700 でも報告は 2,3,4… と積み上がる。
   */
  const appendReportRowSequentialWithRetry = (sheet, row, headers) => {
    const safeRow = normalizeRowForSheet(row);
    const numCols = safeRow.length;
    if (numCols < 1) {
      return { ok: false, error: new Error('行データの列数が0です') };
    }
    let lastError;
    for (let a = 1; a <= SHEET_APPEND_MAX_ATTEMPTS; a += 1) {
      try {
        const maxRow = sheet.getLastRow();
        const nextRow = findFirstWritableRow(sheet, maxRow, numCols, headers);
        const maxRows = sheet.getMaxRows();
        if (nextRow > maxRows) {
          sheet.insertRowsAfter(maxRows, nextRow - maxRows);
        }
        sheet.getRange(nextRow, 1, 1, numCols).setValues([safeRow]);
        return { ok: true, fallbackAppend: false, writtenRow: nextRow };
      } catch (e) {
        lastError = e;
        Logger.log(
          'ReportService.appendReportRowSequential attempt %s/%s: %s',
          a,
          SHEET_APPEND_MAX_ATTEMPTS,
          e && e.message ? e.message : e
        );
        if (a < SHEET_APPEND_MAX_ATTEMPTS) {
          Utilities.sleep(APPEND_RETRY_BASE_MS * a);
        }
      }
    }
    try {
      sheet.appendRow(safeRow);
      Logger.log(
        'appendReportRowSequential: 連続追記に失敗したため appendRow に切替 (%s)',
        lastError && lastError.message ? lastError.message : lastError
      );
      return { ok: true, fallbackAppend: true, writtenRow: sheet.getLastRow() };
    } catch (e2) {
      Logger.log(
        'appendReportRowSequential: appendRow も失敗 %s',
        e2 && e2.message ? e2.message : e2
      );
      return { ok: false, error: e2 || lastError };
    }
  };

  const queueFailedSheetWrite = (kind, details) => {
    try {
      const name = APP_CONFIG.reportWriteQueueSheetName;
      if (!name) return;
      const q = SheetRepository.ensureSheet(name);
      if (q.getLastRow() === 0 || !q.getRange(1, 1).getValue()) {
        q.getRange(1, 1, 1, 9).setValues([
          [
            '記録日時',
            '区分',
            'ログシート',
            '現場ID',
            '報告種別',
            'submittedAt',
            'DriveFolderId',
            'エラー',
            'メモ'
          ]
        ]);
      }
      q.appendRow([
        formatSheetTimestamp(new Date()),
        kind,
        String(details.logSheet || ''),
        String(details.siteId || ''),
        String(details.reportType || ''),
        String(details.submittedAt || ''),
        String(details.driveFolderId || ''),
        String(details.error || '').substring(0, 500),
        String(details.memo || '').substring(0, 4500)
      ]);
    } catch (e) {
      Logger.log('ReportService.queueFailedSheetWrite failed: ' + e);
    }
  };

  /** 実ブックではタブ名が「Log_午後報告」のように Log_ 接頭辞付きのことが多い */
  const logSheetTabMatchesReportType = (tabName, reportType) => {
    const t = String(reportType || '').trim();
    const n = String(tabName || '').trim();
    if (!t || !n) return false;
    if (n === t) return true;
    if (n === 'Log_' + t) return true;
    return false;
  };

  const findLogSheetByReportTypeName = type => {
    const t = String(type || '').trim();
    if (!t) return null;
    return (
      SheetRepository.getSheetByNameIfExists(t) ||
      SheetRepository.getSheetByNameIfExists('Log_' + t) ||
      null
    );
  };

  /**
   * AppConfig の GID がブック内タブとずれていると、別タブに append され「午後報告だけ空」のように見える。
   * GID で開いたタブが報告種別と一致しないときは、「午後報告」または「Log_午後報告」など名前で解決できるタブへ切り替える。
   */
  const resolveReportLogSheet = reportType => {
    const type = String(reportType || '').trim();
    if (!type) {
      throw new Error('報告種別が空です。');
    }
    let logSheetTarget = APP_CONFIG.getLogSheetName(type);
    let sheet;
    try {
      sheet = SheetRepository.ensureSheet(logSheetTarget);
    } catch (primaryErr) {
      const manualFb =
        APP_CONFIG.logSheetFallbackByType && APP_CONFIG.logSheetFallbackByType[type];
      if (manualFb) {
        Logger.log(
          'resolveReportLogSheet: ensureSheet(%s) 失敗 → logSheetFallbackByType「%s」: %s',
          logSheetTarget,
          manualFb,
          primaryErr
        );
        logSheetTarget = manualFb;
        sheet = SheetRepository.ensureSheet(manualFb);
      } else {
        const numericTarget =
          typeof logSheetTarget === 'number' || /^\d+$/.test(String(logSheetTarget));
        if (numericTarget) {
          const byName = findLogSheetByReportTypeName(type);
          if (byName) {
            Logger.log(
              'resolveReportLogSheet: GID %s が無効のためタブ「%s」でオープン: %s',
              logSheetTarget,
              byName.getName(),
              primaryErr
            );
            logSheetTarget = byName.getName();
            sheet = byName;
          } else {
            Logger.log(
              'resolveReportLogSheet: ensureSheet 失敗 type=%s target=%s err=%s',
              type,
              logSheetTarget,
              primaryErr
            );
            throw primaryErr;
          }
        } else {
          Logger.log(
            'resolveReportLogSheet: ensureSheet 失敗 type=%s target=%s err=%s',
            type,
            logSheetTarget,
            primaryErr
          );
          throw primaryErr;
        }
      }
    }

    const numericTarget =
      typeof logSheetTarget === 'number' || /^\d+$/.test(String(logSheetTarget));
    if (numericTarget) {
      const actualName = sheet.getName();
      if (!logSheetTabMatchesReportType(actualName, type)) {
        const byName = findLogSheetByReportTypeName(type);
        if (byName && byName.getSheetId() !== sheet.getSheetId()) {
          Logger.log(
            'resolveReportLogSheet: GID(%s)が実タブ「%s」を指しています。報告種別「%s」用タブ「%s」へ切替します。',
            logSheetTarget,
            actualName,
            type,
            byName.getName()
          );
          return { sheet: byName, logSheetTarget: byName.getName() };
        }
        if (!byName) {
          Logger.log(
            'resolveReportLogSheet: 警告 GID(%s)→実タブ「%s」。「%s」/「Log_%s」のタブは別に無いためこのまま書込みます。',
            logSheetTarget,
            actualName,
            type,
            type
          );
        }
      }
    }
    return { sheet, logSheetTarget };
  };

  const saveReport = payload => {
    validatePayload(payload);
    const rt = String(payload.reportType || '').trim();
    if (APP_CONFIG.mockMode) {
      return {
        success: true,
        imageCount: (payload.images || []).length
      };
    }
    // === 【重要】重い処理（Driveへの写真保存など）を順番待ちロックの「外」に移動 ===
    // この変更により、何十人が同時に写真を送っても、それぞれが並行してDriveへ写真をアップロードできます。
    const site = MasterDataService.resolveSiteForReport({
      siteId: payload.siteId,
      siteName: payload.siteName || ''
    });
    const submittedAt = (payload.meta && payload.meta.submittedAt) || new Date().toISOString();
    const questionLabels = (payload.answers || []).reduce((acc, answer) => {
      if (answer && answer.questionId) {
        acc[answer.questionId] = answer.label || '';
      }
      return acc;
    }, {});

    const imgs = payload.images || [];
    const usePreUploaded =
      imgs.length === 0 &&
      Array.isArray(payload.preUploadedFiles) &&
      payload.preUploadedFiles.length > 0;

    let imageSaveResult;
    if (usePreUploaded) {
      imageSaveResult = mergeImageSaveQuarantineInfo_(
        {
          files: payload.preUploadedFiles,
          folderId: String(payload.preUploadedFolderId || '').trim()
        },
        payload,
        site
      );
    } else {
      // 写真のGoogle Drive保存（クライアント分割アップロード時は preUploaded 経由でスキップ）
      imageSaveResult = mergeImageSaveQuarantineInfo_(
        DriveService.saveReportImages({
          site,
          masterDriveFolderId: String(site.driveFolderId || '').trim(),
          reportType: rt,
          workerName: payload.reporterName,
          submittedAt,
          files: imgs,
          questionLabels,
          buildingName: payload.buildingName || '',
          isResend: false
        }),
        payload,
        site
      );
    }

    finalizeQuarantineIfNeeded_(imageSaveResult, payload, site, rt, submittedAt);

    // === ここから下が「シートへの行追加」のみを行う瞬間的な排他処理エリア ===
    const resolvedLog = resolveReportLogSheet(rt);
    let logSheetTarget = resolvedLog.logSheetTarget;
    let sheet = resolvedLog.sheet;
    try {
      const parent = sheet.getParent();
      Logger.log(
        'saveReport: 書込先 spreadsheetId=%s sheetName=%s sheetGid=%s reportType=%s',
        parent.getId(),
        sheet.getName(),
        sheet.getSheetId(),
        rt
      );
    } catch (logErr) {
      Logger.log('saveReport: 診断ログ出力失敗: ' + logErr);
    }
    
    // シートへの読み書きだけロック（順番待ち）をかけます。処理は一瞬(0.1秒等)で終わるので渋滞しません。
    const lock = LockService.getScriptLock();
    lock.waitLock(20 * 1000);
    try {
      // --- Dynamic Header Management ---
      let headers = [];
      if (sheet.getLastRow() > 0) {
        headers = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0];
      }
      
      const baseHeaders = [
        '送信日時', '現場ID', '棟名', '請負業者名', '施工業者名', '工事現場名',
        '報告者ID', '報告者名', '報告種別',
        '承認ステータス', '承認者', '承認日時', '差し戻しコメント'
      ];
      const tailHeaders = ['ImagesJSON', 'DriveFolderId', 'MetaJSON'];
      
      if (headers.length === 0 || !headers[0]) {
        const answerLabels = payload.answers.map(a => a.label);
        headers = [...baseHeaders, ...answerLabels, ...tailHeaders];
        sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      } else {
        const newLabels = payload.answers
          .map(a => a.label)
          .filter(label => label && !headers.includes(label));

        if (newLabels.length > 0) {
          // _備考列は親列の直後に挿入し、それ以外は tailHeaders の手前に挿入
          for (const label of newLabels) {
            if (label.endsWith('_備考')) {
              const parentLabel = label.replace(/_備考$/, '');
              const parentIdx = headers.indexOf(parentLabel);
              if (parentIdx >= 0) {
                const insertAt = parentIdx + 1;
                sheet.insertColumnsAfter(insertAt, 1);
                sheet.getRange(1, insertAt + 1, 1, 1).setValues([[label]]);
                headers.splice(insertAt, 0, label);
                continue;
              }
            }
            let tailIdx = headers.findIndex(h => tailHeaders.includes(h));
            if (tailIdx === -1) tailIdx = headers.length;
            sheet.insertColumnsAfter(tailIdx, 1);
            sheet.getRange(1, tailIdx + 1, 1, 1).setValues([[label]]);
            headers.splice(tailIdx, 0, label);
          }
          headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
        }
      }

      // 重複チェック: キー列で見た「データ最終行」付近の MetaJSON を見る（連続追記では新しい行は末尾側）
      if (payload.meta && payload.meta.submittedAt) {
        const metaColIdx = headers.findIndex(h => h === 'MetaJSON');
        if (metaColIdx >= 0) {
          const keyCol = pickKeyColumn1Based(headers);
          const maxRow = sheet.getLastRow();
          const lastDataRow = computeLastDataRowForKeyCol(sheet, keyCol, maxRow);
          if (lastDataRow >= 2) {
            const start = Math.max(2, lastDataRow - 19);
            const numRows = lastDataRow - start + 1;
            const metaValues = sheet
              .getRange(start, metaColIdx + 1, numRows, 1)
              .getValues();
            const alreadyWritten = metaValues.some(([cell]) => {
              try {
                return JSON.parse(String(cell)).submittedAt === submittedAt;
              } catch (_) {
                return false;
              }
            });
            if (alreadyWritten) {
              Logger.log(
                'saveReport: 重複送信のため行追加スキップ submittedAt=%s sheet=%s',
                submittedAt,
                sheet.getName()
              );
              return {
                success: true,
                imageCount: (payload.preUploadedFiles || payload.images || []).length,
                skipped: true
              };
            }
          }
        }
      }

      const metaJson = UtilitiesEx.safeJsonStringify(
        Object.assign(
          {
            formVersion: payload.formVersion,
            submittedAt
          },
          payload.meta || {},
          imageSaveResult.isQuarantine
            ? {
                isQuarantine: true,
                quarantineReason: imageSaveResult.quarantineReason || '',
                quarantineFolderUrl: imageSaveResult.quarantineFolderUrl || '',
                quarantineCaseFolderId: imageSaveResult.quarantineCaseFolderId || '',
                driveFolderIdFromMaster: imageSaveResult.driveFolderIdFromMaster || '',
                actualFolderName: imageSaveResult.actualFolderName || '',
                intendedPath: imageSaveResult.intendedPath || ''
              }
            : {}
        )
      );
      const imageJson = UtilitiesEx.safeJsonStringify(imageSaveResult.files);
      
      const answerMap = payload.answers.reduce((acc, a) => {
        acc[a.label] = a.value;
        return acc;
      }, {});

      // 画像項目の値をフォルダへの HYPERLINK に置き換え
      if (imageSaveResult.folderId) {
        const folderUrl = 'https://drive.google.com/drive/folders/' + imageSaveResult.folderId;
        (payload.answers || []).forEach(a => {
          if (a.value && a.value.match(/^\[\d+枚の画像\]$/)) {
            answerMap[a.label] = '=HYPERLINK("' + folderUrl + '","' + a.value + '")';
          }
        });
      }

      const row = headers.map(header => {
        if (header === 'Timestamp' || header === '送信日時') return formatSheetTimestamp(submittedAt);
        if (header === 'SiteId' || header === '現場ID') return site.id;
        if (header === 'SiteName' || header === '工事現場名') return site.name;
        if (header === 'BuildingName' || header === '棟名') return payload.buildingName || '';
        if (header === 'TeamName' || header === '請負業者名') return payload.teamName || '';
        if (header === 'CompanyName' || header === '施工業者名') return payload.companyName || '';
        if (header === 'ReporterId' || header === '報告者ID') return payload.reporterId || '';
        if (header === 'ReporterName' || header === '報告者名') return payload.reporterName || '';
        if (header === 'ReportType' || header === '報告種別') return rt;
        if (header === 'ImagesJSON') return imageJson;
        if (header === 'DriveFolderId') return imageSaveResult.folderId;
        if (header === 'MetaJSON') return metaJson;
        return answerMap[header] || '';
      });

      const appendResult = appendReportRowSequentialWithRetry(sheet, row, headers);
      if (appendResult.ok) {
        Logger.log(
          appendResult.fallbackAppend
            ? 'saveReport: appendRow フォールバック成功 sheet=%s writtenRow=%s cols=%s reportType=%s'
            : 'saveReport: 連続追記成功 sheet=%s writtenRow=%s cols=%s reportType=%s',
          sheet.getName(),
          appendResult.writtenRow,
          row.length,
          rt
        );
      }
      if (!appendResult.ok) {
        const errMsg =
          appendResult.error && appendResult.error.message
            ? String(appendResult.error.message)
            : appendResult.error
              ? String(appendResult.error)
              : 'unknown';
        queueFailedSheetWrite('main_report', {
          logSheet: String(logSheetTarget),
          siteId: site.id,
          reportType: rt,
          submittedAt,
          driveFolderId: imageSaveResult.folderId || '',
          error: errMsg,
          memo:
            '写真はDrive保存済みの可能性あり。ログシートへ手動追記してください。'
        });
        return {
          success: false,
          error:
            'スプレッドシートへの書き込みに失敗しました（キューに記録済み）。管理者に連絡してください。',
          sheetWriteFailed: true,
          driveFolderId: imageSaveResult.folderId,
          imageCount: imageSaveResult.files.length
        };
      }

      // 終業前報告の進捗率から資材管理の節目を判定する。
      // ここでは送信せずキューへ保存するだけなので、外部通信障害で職人報告を失敗させない。
      if (rt === '終業前報告') {
        try {
          MaterialProgressSyncService.captureReport(payload, site, submittedAt);
        } catch (materialSyncError) {
          Logger.log(
            'saveReport: 資材管理進捗キュー登録失敗（元報告は保存済み）: %s',
            materialSyncError && materialSyncError.message ? materialSyncError.message : materialSyncError
          );
        }
      }

      // 午後報告のログ保存が完了した直後だけ、当日分の一覧を再生成する。
      // 一覧更新の失敗で元の報告保存を失敗扱いにしない。
      if (rt === '午後報告') {
        try {
          DailyAfternoonReportService.refreshForSourceSheet(sheet);
        } catch (dailyRefreshError) {
          Logger.log(
            'saveReport: 本日の午後報告の更新に失敗（ログ保存は成功）: %s',
            dailyRefreshError && dailyRefreshError.message
              ? dailyRefreshError.message
              : dailyRefreshError
          );
        }
      }

      return {
        success: true,
        imageCount: imageSaveResult.files.length,
        sheetWriteFallbackAppend: !!appendResult.fallbackAppend,
        quarantine: imageSaveResult.isQuarantine === true
      };
    } finally {
      lock.releaseLock();
    }
  };

  /**
   * ログシートから差し戻し中の元報告を検索する。
   * 承認ステータス='差し戻し' のうち、現場・棟名・報告者名等が一致する最新行を特定。
   */
  const APPROVAL_STATUS_RETURNED = '差し戻し';

  const normalizeSiteIdKey_ = id => {
    const t = String(id || '').trim().toUpperCase();
    return /^SITE-\d+$/.test(t) ? t : String(id || '').trim();
  };

  const normalizeBuildingKey_ = value => String(value == null ? '' : value).trim();

  const findHeaderCol_ = (headers, names) => {
    for (let i = 0; i < names.length; i += 1) {
      const idx = headers.findIndex(h => h === names[i]);
      if (idx >= 0) return idx;
    }
    return -1;
  };

  /**
   * @param {Object} [filters] - buildingName, reporterName, teamName, companyName
   * @return {{report:Object|null, reason:string, detail:string}}
   */
  const findReturnedReportDetailed = (sheetOrId, siteId, siteNameOpt, filters) => {
    let sheet;
    if (sheetOrId && typeof sheetOrId.getRange === 'function') {
      sheet = sheetOrId;
    } else {
      try {
        sheet = SheetRepository.getSheet(sheetOrId);
      } catch (err) {
        return {
          report: null,
          reason: 'sheet_not_found',
          detail: String(err && err.message ? err.message : err)
        };
      }
    }

    const lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      return { report: null, reason: 'sheet_empty', detail: sheet.getName() };
    }

    const rawHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const headers = rawHeaders.map(h => String(h || '').trim());
    const siteIdCol = findHeaderCol_(headers, ['現場ID', 'SiteId']);
    const statusCol = findHeaderCol_(headers, ['承認ステータス']);
    const imagesCol = findHeaderCol_(headers, ['ImagesJSON']);
    const folderCol = findHeaderCol_(headers, ['DriveFolderId']);
    const siteNameCol = findHeaderCol_(headers, ['工事現場名', 'SiteName']);
    const buildingCol = findHeaderCol_(headers, ['棟名', 'BuildingName']);
    const reporterCol = findHeaderCol_(headers, ['報告者名', 'ReporterName']);
    const teamCol = findHeaderCol_(headers, ['請負業者名', 'TeamName']);
    const companyCol = findHeaderCol_(headers, ['施工業者名', 'CompanyName']);

    if (siteIdCol < 0 || statusCol < 0 || imagesCol < 0 || folderCol < 0) {
      Logger.log(
        'ReportService.findReturnedReport: 必須列が不足 siteIdCol=%s statusCol=%s imagesCol=%s folderCol=%s sheet=%s',
        siteIdCol,
        statusCol,
        imagesCol,
        folderCol,
        sheet.getName()
      );
      return {
        report: null,
        reason: 'missing_columns',
        detail: sheet.getName()
      };
    }

    const resolvedSite = MasterDataService.resolveSiteForReport({
      siteId: siteId,
      siteName: siteNameOpt || ''
    });
    const lookupSiteId = normalizeSiteIdKey_(resolvedSite && resolvedSite.id);
    const payloadSiteId = normalizeSiteIdKey_(siteId);
    const targetSiteId = lookupSiteId || payloadSiteId;
    const normTarget =
      siteNameOpt && String(siteNameOpt).trim()
        ? UtilitiesEx.normalizeSiteName(siteNameOpt)
        : resolvedSite && resolvedSite.name
          ? UtilitiesEx.normalizeSiteName(resolvedSite.name)
          : '';

    const f = filters || {};
    const filterBuilding = normalizeBuildingKey_(f.buildingName);
    const filterReporter = normalizeBuildingKey_(f.reporterName);
    const filterTeam = normalizeBuildingKey_(f.teamName);
    const filterCompany = normalizeBuildingKey_(f.companyName);

    const rowMatchesFilter_ = row => {
      if (filterBuilding && buildingCol >= 0) {
        if (normalizeBuildingKey_(row[buildingCol]) !== filterBuilding) return false;
      }
      if (filterReporter && reporterCol >= 0) {
        if (normalizeBuildingKey_(row[reporterCol]) !== filterReporter) return false;
      }
      if (filterTeam && teamCol >= 0) {
        if (normalizeBuildingKey_(row[teamCol]) !== filterTeam) return false;
      }
      if (filterCompany && companyCol >= 0) {
        if (normalizeBuildingKey_(row[companyCol]) !== filterCompany) return false;
      }
      return true;
    };

    const rowMatchesSite_ = row => {
      const rowSiteId = normalizeSiteIdKey_(row[siteIdCol]);
      if (targetSiteId && rowSiteId && rowSiteId === targetSiteId) return true;
      if (payloadSiteId && rowSiteId && rowSiteId === payloadSiteId) return true;
      if (normTarget && siteNameCol >= 0) {
        const rowName = String(row[siteNameCol] || '');
        return UtilitiesEx.normalizeSiteName(rowName) === normTarget;
      }
      return false;
    };

    const data = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
    let rejectedWithoutFolder = false;

    for (let i = data.length - 1; i >= 0; i--) {
      const rowStatus = String(data[i][statusCol] || '').trim();
      if (rowStatus !== APPROVAL_STATUS_RETURNED) continue;
      if (!rowMatchesSite_(data[i])) continue;
      if (!rowMatchesFilter_(data[i])) continue;

      const driveFolderId = String(data[i][folderCol] || '').trim();
      if (!driveFolderId) {
        rejectedWithoutFolder = true;
        continue;
      }

      return {
        report: {
          rowIndex: i + 2,
          imagesJson: String(data[i][imagesCol] || ''),
          driveFolderId,
          headers,
          imagesColIndex: imagesCol,
          sheet
        },
        reason: '',
        detail: ''
      };
    }

    if (rejectedWithoutFolder) {
      return {
        report: null,
        reason: 'missing_drive_folder',
        detail: sheet.getName()
      };
    }
    return {
      report: null,
      reason: 'not_found',
      detail: sheet.getName()
    };
  };

  const findReturnedReport = (sheetOrId, siteId, siteNameOpt, filters) =>
    findReturnedReportDetailed(sheetOrId, siteId, siteNameOpt, filters).report;

  const buildResendLookupError_ = (resendType, lookup) => {
    const typeLabel = resendType || '（未指定）';
    if (lookup.reason === 'missing_columns') {
      return (
        '差し戻し中の報告を検索できません（ログシート「' +
        lookup.detail +
        '」に承認ステータス等の列がありません）。管理者に連絡してください。'
      );
    }
    if (lookup.reason === 'missing_drive_folder') {
      return (
        '差し戻し中の報告は見つかりましたが、写真フォルダ情報がありません。管理者に連絡してください。'
      );
    }
    if (lookup.reason === 'sheet_empty' || lookup.reason === 'sheet_not_found') {
      return (
        '報告ログ（' +
        typeLabel +
        '）が見つかりません。報告種別が正しいか管理者に確認してください。'
      );
    }
    return (
      '差し戻し中の報告が見つかりません。\n\n' +
      '・再送画面で選んだ報告種別: ' +
      typeLabel +
      '\n' +
      '・現場名・棟名・報告者名・請負業者名・施工業者名が、差し戻された報告と同じか確認してください\n' +
      '・承認画面で「差し戻し」になっているか確認してください'
    );
  };

  /**
   * 差し戻し写真再送: 元報告の画像を同名で差し替える。
   * 元フォルダ内で同じファイル名で画像を入れ替え、ImagesJSON を更新。
   * 監査証跡として差し戻し写真再送シートにもログ記録。
   */
  const saveResendReport = payload => {
    validatePayload(payload);
    if (APP_CONFIG.mockMode) {
      return {
        success: true,
        imageCount: (payload.images || []).length
      };
    }

    const resendType = String(
      (payload.resendTargetType || payload.reportType || '').trim()
    );
    if (!resendType) {
      return {
        success: false,
        error:
          '再送する報告種別が指定されていません。「差し戻し写真再送」から始業前報告などを選び直してください。'
      };
    }
    const { sheet: logSheet } = resolveReportLogSheet(resendType);

    const lookupFilters = {
      buildingName: payload.buildingName || '',
      reporterName: payload.reporterName || '',
      teamName: payload.teamName || '',
      companyName: payload.companyName || ''
    };

    const previewLookup = findReturnedReportDetailed(
      logSheet,
      payload.siteId,
      payload.siteName || '',
      lookupFilters
    );
    const reportPreview = previewLookup.report;
    if (!reportPreview || !reportPreview.driveFolderId) {
      return {
        success: false,
        error: buildResendLookupError_(resendType, previewLookup)
      };
    }

    const originalImages = UtilitiesEx.safeJsonParse(reportPreview.imagesJson, []);
    const questionLabels = (payload.answers || []).reduce((acc, answer) => {
      if (answer && answer.questionId) acc[answer.questionId] = answer.label || '';
      return acc;
    }, {});

    // 元画像を同名で差し替え（Google Driveとの通信のため時間がかかる処理）
    const replaceResult = DriveService.replaceReportImages({
      originalImages,
      driveFolderId: reportPreview.driveFolderId,
      newFiles: payload.images || [],
      questionLabels
    });

    // === STEP2: ロック内でシート操作。ロック待機中に別プロセスが処理した可能性があるため再確認 ===
    const lock = LockService.getScriptLock();
    lock.waitLock(20 * 1000);
    try {
      // ロック内で元報告を再検索（ロック待機中に別プロセスが処理済みかを確認）
      const originalReport = findReturnedReport(
        logSheet,
        payload.siteId,
        payload.siteName || '',
        lookupFilters
      );
      if (!originalReport) {
        // 別プロセスが先に処理済み → 正常終了扱い
        return { success: true, imageCount: 0 };
      }

      // 元報告行の ImagesJSON を更新
      const updatedImagesJson = UtilitiesEx.safeJsonStringify(replaceResult.files);
      originalReport.sheet.getRange(
        originalReport.rowIndex,
        originalReport.imagesColIndex + 1
      ).setValue(updatedImagesJson);

      // --- 差し戻し写真再送シートに監査ログ記録 ---
      const site = MasterDataService.resolveSiteForReport({
        siteId: payload.siteId,
        siteName: payload.siteName || ''
      });
      const resendSheet = SheetRepository.ensureSheet(APP_CONFIG.sheetNames.resend);
      const resendBaseHeaders = APP_CONFIG.resendBaseHeaders;
      const maxPhotoCols = APP_CONFIG.resendMaxPhotoCols;

      // ヘッダー確保
      if (resendSheet.getLastRow() === 0 || !resendSheet.getRange(1, 1).getValue()) {
        const photoHeaders = [];
        for (let i = 1; i <= maxPhotoCols; i++) {
          photoHeaders.push(`再送写真${i}`);
        }
        const allHeaders = [...resendBaseHeaders, ...photoHeaders];
        resendSheet.getRange(1, 1, 1, allHeaders.length).setValues([allHeaders]);
      }

      // 監査ログ行データ
      const baseRow = [
        formatSheetTimestamp(new Date()),
        site.name,
        payload.buildingName || '',
        payload.teamName || '',
        payload.companyName || '',
        resendType,
        payload.reporterName || ''
      ];

      // 差し替え後のファイルから再送対象のみ抽出してHYPERLINK作成
      const resendedQids = new Set((payload.images || []).map(f => f.questionId));
      const resendedFiles = replaceResult.files.filter(f => resendedQids.has(f.questionId));
      const photoFormulas = resendedFiles.map(file => {
        const label = file.name.replace(/\.jpg$/i, '');
        return `=HYPERLINK("${file.url}","${label}")`;
      });

      while (photoFormulas.length < maxPhotoCols) {
        photoFormulas.push('');
      }

      const auditHeaders = resendSheet.getRange(1, 1, 1, resendSheet.getLastColumn()).getValues()[0];
      let auditOk = false;
      let auditErr = null;
      for (let a = 1; a <= SHEET_APPEND_MAX_ATTEMPTS; a += 1) {
        try {
          const nextRow = findFirstWritableRow(
            resendSheet,
            resendSheet.getLastRow(),
            auditHeaders.length,
            auditHeaders
          );
          const maxRows = resendSheet.getMaxRows();
          if (nextRow > maxRows) {
            resendSheet.insertRowsAfter(maxRows, nextRow - maxRows);
          }
          resendSheet.getRange(nextRow, 1, 1, baseRow.length).setValues([baseRow]);
          photoFormulas.forEach((formula, idx) => {
            const col = baseRow.length + idx + 1;
            if (formula) {
              resendSheet.getRange(nextRow, col).setFormula(formula);
            }
          });
          auditOk = true;
          break;
        } catch (e) {
          auditErr = e;
          Logger.log(
            `ReportService resend audit write attempt ${a}/${SHEET_APPEND_MAX_ATTEMPTS}: ${e}`
          );
          if (a < SHEET_APPEND_MAX_ATTEMPTS) {
            Utilities.sleep(APPEND_RETRY_BASE_MS * a);
          }
        }
      }

      if (!auditOk) {
        queueFailedSheetWrite('resend_audit', {
          logSheet: String(APP_CONFIG.sheetNames.resend),
          siteId: payload.siteId,
          reportType: resendType,
          submittedAt: '',
          driveFolderId: reportPreview.driveFolderId || '',
          error: auditErr ? String(auditErr) : 'unknown',
          memo:
            'ImagesJSONは更新済み。差し戻し再送シートへの監査行のみ失敗。手動で追記してください。'
        });
      }

      return {
        success: true,
        imageCount: resendedFiles.length,
        resendAuditQueued: !auditOk
      };
    } finally {
      lock.releaseLock();
    }
  };

  /**
   * 指定された現場の今日の始業前報告ログから「詰所使用」の値を検索する。
   * 午後報告・終業前報告で詰所フィールドの表示/非表示を判定するために使用。
   * @param {string} siteId
   * @param {string} [buildingNameOpt] 棟名。指定時は同一現場内でも棟が一致する行のみ採用（複数棟現場の取り違え防止）
   */
  const getTsumeshoStatus = (siteId, buildingNameOpt) => {
    if (!siteId) return { found: false, value: null };
    if (APP_CONFIG.mockMode) return { found: false, value: null };

    const sheetId = APP_CONFIG.getLogSheetName('始業前報告');
    let sheet;
    try {
      sheet = SheetRepository.getSheet(sheetId);
    } catch (_) {
      return { found: false, value: null };
    }

    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return { found: false, value: null };

    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const siteIdCol = headers.findIndex(h => h === '現場ID' || h === 'SiteId');
    const timestampCol = headers.findIndex(h => h === '送信日時' || h === 'Timestamp');
    const tsumeshoCol = headers.findIndex(h => String(h).includes('詰所使用'));
    const buildingCol = headers.findIndex(
      h => h === '棟名' || h === 'BuildingName' || String(h).trim() === '棟'
    );

    if (siteIdCol < 0 || timestampCol < 0 || tsumeshoCol < 0) {
      return { found: false, value: null };
    }

    const wantBuildingRaw = String(buildingNameOpt || '').trim();
    const filterByBuilding = buildingCol >= 0 && !!wantBuildingRaw;
    const wantBuildingNorm = filterByBuilding
      ? UtilitiesEx.normalizeName(wantBuildingRaw)
      : '';

    // 今日の日付（JST）
    const todayStr = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');

    // 最新100行を逆順スキャンしてパフォーマンスを最適化
    const SCAN_LIMIT = 100;
    const startRow = Math.max(2, lastRow - SCAN_LIMIT + 1);
    const numRows = lastRow - startRow + 1;
    const data = sheet.getRange(startRow, 1, numRows, headers.length).getValues();

    for (let i = data.length - 1; i >= 0; i--) {
      const rowSiteId = String(data[i][siteIdCol] || '').trim();
      if (rowSiteId !== String(siteId).trim()) continue;

      const rowDate = data[i][timestampCol];
      const rowDateStr = normalizeSheetDateKey(rowDate);
      if (rowDateStr !== todayStr) continue;

      if (filterByBuilding) {
        const rowB = UtilitiesEx.normalizeName(data[i][buildingCol]);
        if (rowB !== wantBuildingNorm) continue;
      }

      // 今日の該当現場（＋棟一致時は該当棟）の始業前報告を発見
      const value = String(data[i][tsumeshoCol] || '').trim();
      return { found: true, value: value || null };
    }

    return { found: false, value: null };
  };

  return {
    saveReport,
    saveResendReport,
    getTsumeshoStatus,
    getLogSheetForReportType: reportType => resolveReportLogSheet(reportType).sheet
  };
})();
