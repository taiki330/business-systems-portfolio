/**
 * スプレッドシート操作ラッパー（職人管理の SheetRepository.js を是正報告書向けに調整）
 */
const SheetRepository = (() => {
    const cache = {};

    const getSpreadsheet = () => {
        if (cache.__spreadsheet) return cache.__spreadsheet;

        let spreadsheet = null;
        const configuredId = (APP_CONFIG.spreadsheetId || '').trim();
        if (!configuredId) {
            throw new Error('AppConfig.js の spreadsheetId が未設定です。');
        }
        spreadsheet = SpreadsheetApp.openById(configuredId);
        cache.__spreadsheet = spreadsheet;
        return spreadsheet;
    };


    const getMasterSpreadsheet = () => {
        if (cache.__masterSpreadsheet) return cache.__masterSpreadsheet;
        const id = (APP_CONFIG.masterSpreadsheetId || '').trim();
        if (!id) throw new Error('AppConfig.js の masterSpreadsheetId が未設定です。');
        cache.__masterSpreadsheet = SpreadsheetApp.openById(id);
        return cache.__masterSpreadsheet;
    };

    const getSheetById = (ss, id) => {
        const sheets = ss.getSheets();
        for (let i = 0; i < sheets.length; i++) {
            if (sheets[i].getSheetId() == id) return sheets[i];
        }
        return null;
    };

    const getSheet = (identifier, useMaster) => {
        const cacheKey = `${useMaster ? 'master_' : ''}${identifier}`;
        if (!cache[cacheKey]) {
            const ss = useMaster ? getMasterSpreadsheet() : getSpreadsheet();
            let sheet = null;
            if (typeof identifier === 'number' || /^\d+$/.test(String(identifier))) {
                sheet = getSheetById(ss, identifier);
            } else {
                sheet = ss.getSheetByName(identifier);
            }
            if (!sheet) throw new Error(`シート "${identifier}" が見つかりません。`);
            cache[cacheKey] = sheet;
        }
        return cache[cacheKey];
    };

    /**
     * シートを確保する。存在しなければ作成してヘッダーを設定する。
     * @param {string} identifier  シート名
     * @param {string[]} [headers] 初回作成時に設定するヘッダー行
     */
    const ensureSheet = (identifier, headers) => {
        const ss = getSpreadsheet();
        let sheet = ss.getSheetByName(identifier);
        if (!sheet) {
            sheet = ss.insertSheet(identifier);
            if (headers && headers.length) {
                const headerRange = sheet.getRange(1, 1, 1, headers.length);
                headerRange.setValues([headers]).setFontWeight('bold').setBackground('#e2e8f0');
                sheet.setFrozenRows(1);
            }
            cache[identifier] = sheet;
        }
        return sheet;
    };

    const readTable = (sheetName, useMaster) => {
        // マスタ参照はエラーをそのまま投げる。内部シートはなければ空を返す。
        let sheet = getSheet(sheetName, !!useMaster);
        const values = sheet.getDataRange().getValues();
        if (!values.length) return { headers: [], rows: [] };

        const [headers, ...rawRows] = values;
        const rows = rawRows
            .filter(row => row.some(cell => cell !== ''))
            .map(row => {
                const obj = {};
                headers.forEach((header, i) => {
                    if (!header) return;
                    obj[String(header).trim()] = row[i];
                });
                return obj;
            });
        // 指摘明細: 表示用に「案件ID」列を結合していると、2行目以降が空扱いになり GAS 上は
        // 行ごとに案件IDが欠落する。前方行のIDを補完しないと明細照会が欠けて帳票に1件しか出ない等の不具合になる。
        if (String(sheetName) === String(APP_CONFIG.sheetNames.details) && !useMaster) {
            let lastCaseId = '';
            for (var ri = 0; ri < rows.length; ri++) {
                const raw = rows[ri]['案件ID'];
                if (raw != null && String(raw).trim() !== '') {
                    lastCaseId = String(raw).trim();
                }
                rows[ri]['案件ID'] = lastCaseId;
            }
        }
        return { headers, rows };
    };

    /**
     * 行を追記する。シートが存在しなければ headers を使って作成する。
     * @param {string}   sheetName
     * @param {Array}    rowValues
     * @param {string[]} [headers] シート初回作成時に設定するヘッダー行
     */
    const appendRow = (sheetName, rowValues, headers) => {
        const sheet = ensureSheet(sheetName, headers);
        sheet.appendRow(rowValues);
    };

    /**
     * 対象シートの特定行を更新する（案件ID or 明細IDで検索）
     * @param {string} sheetName
     * @param {string} idColumnHeader - 検索キーのヘッダー名
     * @param {string} idValue        - 検索する値
     * @param {Object} updateData     - { ヘッダー名: 値 } 形式の更新データ
     */
    const updateRow = (sheetName, idColumnHeader, idValue, updateData) => {
        const sheet = ensureSheet(sheetName);
        const values = sheet.getDataRange().getValues();
        if (values.length < 2) return false;

        const headers = values[0].map(h => String(h).trim());
        const idColIndex = headers.indexOf(idColumnHeader);
        if (idColIndex < 0) throw new Error(`ヘッダー "${idColumnHeader}" が見つかりません。`);

        for (let rowIndex = 1; rowIndex < values.length; rowIndex++) {
            if (String(values[rowIndex][idColIndex]) === String(idValue)) {
                Object.entries(updateData).forEach(([header, value]) => {
                    const colIndex = headers.indexOf(header);
                    if (colIndex >= 0) {
                        sheet.getRange(rowIndex + 1, colIndex + 1).setValue(value);
                    }
                });
                return true;
            }
        }
        return false;
    };

    /**
     * 複数IDの同一項目をまとめて更新する。
     * シートの読込は1回、書込は項目ごとの RangeList 1回に抑える。
     * @returns {string[]} 更新できたID
     */
    const updateRowsByIds = (sheetName, idColumnHeader, idValues, updateData) => {
        const sheet = ensureSheet(sheetName);
        const values = sheet.getDataRange().getValues();
        if (values.length < 2) return [];

        const headers = values[0].map(h => String(h).trim());
        const idColIndex = headers.indexOf(idColumnHeader);
        if (idColIndex < 0) throw new Error(`ヘッダー "${idColumnHeader}" が見つかりません。`);

        const wanted = {};
        (idValues || []).forEach(id => {
            const key = String(id == null ? '' : id).trim();
            if (key) wanted[key] = true;
        });
        const rowNumbers = [];
        const updatedIds = [];
        for (let rowIndex = 1; rowIndex < values.length; rowIndex++) {
            const key = String(values[rowIndex][idColIndex] == null ? '' : values[rowIndex][idColIndex]).trim();
            if (wanted[key]) {
                rowNumbers.push(rowIndex + 1);
                updatedIds.push(key);
            }
        }

        Object.entries(updateData || {}).forEach(([header, value]) => {
            const colIndex = headers.indexOf(header);
            if (colIndex < 0 || !rowNumbers.length) return;
            const a1 = rowNumbers.map(rowNumber => sheet.getRange(rowNumber, colIndex + 1).getA1Notation());
            sheet.getRangeList(a1).setValue(value);
        });
        return updatedIds;
    };

    /**
     * 指定した条件で行を検索して返す
     */
    const findRows = (sheetName, filterFn) => {
        const { rows } = readTable(sheetName);
        return rows.filter(filterFn);
    };

    /**
     * 案件シートの2次元配列を生で返す（行の列ズレ正規化は CaseService 側で行う）
     */
    const getCaseTableValues = () => {
        const sheet = getSheet(APP_CONFIG.sheetNames.cases, false);
        return sheet.getDataRange().getValues();
    };

    /**
     * ID列で行を検索して物理削除する
     * @param {string} sheetName
     * @param {string} idColumnHeader
     * @param {string} idValue
     * @returns {boolean}
     */
    const deleteRowById = (sheetName, idColumnHeader, idValue) => {
        const sheet = ensureSheet(sheetName);
        const values = sheet.getDataRange().getValues();
        if (values.length < 2) return false;

        const headers = values[0].map(h => String(h).trim());
        const idColIndex = headers.indexOf(idColumnHeader);
        if (idColIndex < 0) throw new Error(`ヘッダー "${idColumnHeader}" が見つかりません。`);

        for (let rowIndex = 1; rowIndex < values.length; rowIndex++) {
            if (String(values[rowIndex][idColIndex]) === String(idValue)) {
                sheet.deleteRow(rowIndex + 1);
                return true;
            }
        }
        return false;
    };

    return {
        getSheet,
        ensureSheet,
        readTable,
        appendRow,
        updateRow,
        updateRowsByIds,
        findRows,
        getCaseTableValues,
        deleteRowById
    };
})();
