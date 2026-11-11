/**
 * Service to sync all form headers to the spreadsheet immediately.
 */
const HeaderSyncService = (() => {
    const syncAllHeaders = () => {
        // 1. Get Form Configurations
        const configs = FormConfigService.getFormConfigs();
        const configByType = configs.reduce((acc, c) => {
            if (!acc[c.reportType]) acc[c.reportType] = [];
            acc[c.reportType].push(c);
            return acc;
        }, {});

        const baseHeaders = ['送信日時', '現場ID', '工事現場名', '棟名', '請負業者名', '施工業者名', '報告者ID', '報告者名', '報告種別'];
        const tailHeaders = ['ImagesJSON', 'DriveFolderId', 'MetaJSON'];

        // 2. Iterate each report type
        Object.keys(configByType).forEach(type => {
            const sheetName = APP_CONFIG.getLogSheetName(type);
            const sheet = SheetRepository.ensureSheet(sheetName);
            let headers = [];

            if (sheet.getLastRow() > 0) {
                headers = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0];
            }

            // 3. Initialize if empty
            if (headers.length === 0 || !headers[0]) {
                const answerLabels = configByType[type].map(c => c.label);
                const fullHeaders = [...baseHeaders, ...answerLabels, ...tailHeaders];
                sheet.getRange(1, 1, 1, fullHeaders.length).setValues([fullHeaders]);
                console.log(`Initialized headers for ${sheetName}`);
            } else {
                // 3.5 Migrate Legacy Headers (English -> Japanese)
                const headerMap = {
                    'Timestamp': '送信日時',
                    'SiteId': '現場ID',
                    'SiteName': '工事現場名',
                    'BuildingName': '棟名',
                    'TeamName': '請負業者名',
                    'CompanyName': '施工業者名',
                    'ReporterId': '報告者ID',
                    'ReporterName': '報告者名',
                    'ReportType': '報告種別'
                };

                let headersChanged = false;
                headers.forEach((h, i) => {
                    if (headerMap[h]) {
                        sheet.getRange(1, i + 1).setValue(headerMap[h]);
                        console.log(`Renamed header ${h} to ${headerMap[h]}`);
                        headers[i] = headerMap[h]; // Update local array
                        headersChanged = true;
                    }
                });

                let updatedHeaders = [...headers];

                // 4. Update existing headers (Check for missing Japanese headers)
                // 4a. Add BuildingName (棟名) if missing
                if (!updatedHeaders.includes('棟名')) {
                    const siteNameIdx = updatedHeaders.indexOf('工事現場名');
                    const targetCol = siteNameIdx !== -1 ? siteNameIdx + 1 : 2;
                    sheet.insertColumnAfter(targetCol);
                    sheet.getRange(1, targetCol + 1).setValue('棟名');
                    console.log(`Added 棟名 to ${sheetName}`);
                    updatedHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
                }

                // 4b. Add TeamName (請負業者名) if missing
                if (!updatedHeaders.includes('請負業者名')) {
                    const buildNameIdx = updatedHeaders.indexOf('棟名');
                    const targetCol = buildNameIdx !== -1 ? buildNameIdx + 1 : 3;
                    sheet.insertColumnAfter(targetCol);
                    sheet.getRange(1, targetCol + 1).setValue('請負業者名');
                    console.log(`Added 請負業者名 to ${sheetName}`);
                    updatedHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
                }

                // 4c. Add CompanyName (施工業者名) if missing
                if (!updatedHeaders.includes('施工業者名')) {
                    const teamNameIdx = updatedHeaders.indexOf('請負業者名');
                    const targetCol = teamNameIdx !== -1 ? teamNameIdx + 1 : 4;
                    sheet.insertColumnAfter(targetCol);
                    sheet.getRange(1, targetCol + 1).setValue('施工業者名');
                    console.log(`Added 施工業者名 to ${sheetName}`);
                    updatedHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
                }

                // 4b. Add missing question columns
                const currentLabels = updatedHeaders;
                const questions = configByType[type];
                const missingLabels = questions
                    .map(q => q.label)
                    .filter(label => label && !currentLabels.includes(label));

                if (missingLabels.length > 0) {
                    let insertIndex = updatedHeaders.findIndex(h => tailHeaders.includes(h));
                    if (insertIndex === -1) insertIndex = updatedHeaders.length;

                    sheet.insertColumnsAfter(insertIndex, missingLabels.length);
                    sheet.getRange(1, insertIndex + 1, 1, missingLabels.length).setValues([missingLabels]);
                    console.log(`Added ${missingLabels.length} columns to ${sheetName}: ${missingLabels.join(', ')}`);
                } else {
                    console.log(`No new columns for ${sheetName}`);
                }
            }
        });

        return { success: true, message: 'All headers synced successfully.' };
    };

    return {
        syncAllHeaders
    };
})();
