/**
 * トビ丸テスト - バックエンドシステム(GAS)
 */

// --- 設定 ---
const DB_SPREADSHEET_ID = 'SAMPLE_ID_022';

// --- シート名 ---
const SHEET_MST_QUIZ    = '問題マスタ';
const SHEET_MEMBERS     = '社員名簿';
const SHEET_LOG_DAILY   = '回答ログ';
const SHEET_LOG_DETAIL  = '回答詳細ログ';
const SHEET_SCORE_MONTHLY = '月次スコア';
const SHEET_HOLIDAYS    = '祝日リスト';
const SHEET_SUMMARY     = '集計一覧';
const SHEET_REVIEW_CLEAR = '復習クリアログ';

// --- クイズロジック定数 ---
const FRIDAY_TIME_LIMIT_SEC    = 120;
const FRIDAY_TIMEOUT_MARGIN_SEC = 15;
const FRIDAY_QUIZ_COUNT        = 10;
const LEADERBOARD_CACHE_SEC    = 600;
const ADMIN_ID                 = 'admin';
const MS_PER_DAY               = 1000 * 60 * 60 * 24;

// --- 曜日定数 ---
const WEEKDAY_MONDAY    = 1;
const WEEKDAY_TUESDAY   = 2;
const WEEKDAY_THURSDAY  = 4;
const WEEKDAY_FRIDAY    = 5;
const DAYS_MON_TO_FRI   = 4;

// -------------------------------------------------------------------
// 1. Webアプリ エントリーポイント
// -------------------------------------------------------------------

function doGet(e) {
  const html = HtmlService.createTemplateFromFile('index');
  return html.evaluate()
    .setTitle('トビ丸テスト')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, minimal-ui');
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// -------------------------------------------------------------------
// 2. 認証・ログイン
// -------------------------------------------------------------------

function apiLogin(employeeId, password) {
  try {
    const ss = SpreadsheetApp.openById(DB_SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_MEMBERS);
    const data = sheet.getDataRange().getValues();

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const dbId   = String(row[0]);
      const dbName = row[1];
      const dbPass = String(row[2]);

      if (dbId === String(employeeId)) {
        if (dbPass === String(password)) {
          const quizSelectors = isAdmin(dbId)
            ? { availableDates: [], playedDates: [], availableFridays: [] }
            : buildAvailableDates(ss, dbId);
          return {
            success: true,
            message: 'ログインに成功しました。',
            data: {
              employeeId: dbId,
              name: dbName,
              totalScore: Number(row[4]) || 0,
              isAdmin: isAdmin(dbId),
              availableDates: quizSelectors.availableDates,
              playedDates: quizSelectors.playedDates,
              availableFridays: quizSelectors.availableFridays
            }
          };
        }
        return { success: false, message: 'パスワードが間違っています。' };
      }
    }
    return { success: false, message: '社員IDが見つかりません。' };

  } catch (e) {
    console.error('Login Error:', e);
    return { success: false, message: 'サーバーエラー: ' + e.message };
  }
}

// -------------------------------------------------------------------
// 3. ユーティリティ
// -------------------------------------------------------------------

function formatDate(date) {
  return Utilities.formatDate(new Date(date), 'Asia/Tokyo', 'yyyy/MM/dd');
}

function getDiffDays(date1Str, date2Str) {
  const d1 = new Date(date1Str);
  const d2 = new Date(date2Str);
  d1.setHours(0, 0, 0, 0);
  d2.setHours(0, 0, 0, 0);
  return Math.round((d2 - d1) / MS_PER_DAY);
}

function getSheetOrThrow(ss, sheetName) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error('シート "' + sheetName + '" が見つかりません');
  return sheet;
}

function isAdmin(employeeId) {
  return String(employeeId).toLowerCase() === ADMIN_ID;
}

/**
 * 回答ログから特定社員・特定日付が回答済みかチェック
 */
function isAlreadyAnswered(logData, employeeId, dateStr) {
  return logData.some((row, i) => {
    if (i === 0) return false;
    if (String(row[1]) !== String(employeeId)) return false;
    const d = row[2];
    const dStr = (d instanceof Date) ? formatDate(d) : String(d);
    return dStr === dateStr;
  });
}

/**
 * 回答ログから社員の最終回答対象日を取得（ログが信頼できる唯一の情報源）
 */
function getLastPlayedDateFromLog(logData, employeeId) {
  let maxDate = '';
  for (let i = 1; i < logData.length; i++) {
    if (String(logData[i][1]) !== String(employeeId)) continue;
    const d = logData[i][2];
    const dStr = (d instanceof Date) ? formatDate(d) : String(d);
    if (!maxDate || dStr > maxDate) maxDate = dStr;
  }
  return maxDate;
}

/**
 * 問題マスタから指定日付の問題を抽出（筆記問題は除外）
 */
function getQuizzesByDate(quizData, dateStr) {
  const quizzes = [];
  for (let i = 1; i < quizData.length; i++) {
    const row = quizData[i];
    if (formatDate(row[0]) === dateStr && !String(row[1]).includes('筆記')) {
      quizzes.push(createQuizObj(row));
    }
  }
  return quizzes;
}

/**
 * 問題マスタに指定日付のデータが存在するかチェック
 */
function hasQuizDataForDate(quizData, dateStr) {
  return quizData.some((row, i) => i > 0 && formatDate(row[0]) === dateStr);
}

/**
 * 祝日リストから祝日の日付セットを取得
 */
function getHolidayDates(ss) {
  const sheet = ss.getSheetByName(SHEET_HOLIDAYS);
  if (!sheet) return new Set();
  const data = sheet.getDataRange().getValues();
  const holidays = new Set();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0]) holidays.add(formatDate(data[i][0]));
  }
  return holidays;
}

/**
 * 当月のクイズ選択肢を構築する
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 * @param {string} employeeId
 * @returns {{ availableDates: string[], playedDates: string[], availableFridays: string[] }}
 */
function buildAvailableDates(ss, employeeId) {
  const todayStr = formatDate(new Date());
  const currentMonth = todayStr.substring(0, 7); // 'yyyy/MM'

  // 今月1日（JSTで構築）
  const parts = currentMonth.split('/');
  const monthStartStr = `${parts[0]}/${parts[1]}/01`;
  const monthStart = new Date(monthStartStr.replace(/\//g, '-') + 'T00:00:00+09:00');
  const today = new Date(todayStr.replace(/\//g, '-') + 'T00:00:00+09:00');

  // 祝日セット取得（既存関数を流用）
  const holidays = getHolidayDates(ss);

  // 今月の受験済み日付を回答ログから取得
  const logSheet = getSheetOrThrow(ss, SHEET_LOG_DAILY);
  const logData = logSheet.getDataRange().getValues();
  const playedDates = [];
  for (let i = 1; i < logData.length; i++) {
    if (String(logData[i][1]) !== String(employeeId)) continue;
    const d = logData[i][2];
    if (!d) continue;
    const ds = formatDate(d);
    if (ds.startsWith(currentMonth) && !playedDates.includes(ds)) {
      playedDates.push(ds);
    }
  }

  // 通常テスト（月〜木）の選択肢：当月1日〜今日
  const availableDates = [];
  const cursor = new Date(monthStart);
  while (cursor <= today) {
    const dow = cursor.getDay();
    const ds = formatDate(cursor);
    // 月〜木（祝日も含む：前倒しまたは事後キャッチアップで対応）
    if (dow >= WEEKDAY_MONDAY && dow <= WEEKDAY_THURSDAY) {
      availableDates.push(ds);
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  // 明日が月〜木の祝日かつ当月内なら前倒し追加
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const tomorrowStr = formatDate(tomorrow);
  const tomorrowDow = tomorrow.getDay();
  if (
    holidays.has(tomorrowStr) &&
    tomorrowStr.startsWith(currentMonth) &&
    tomorrowDow >= WEEKDAY_MONDAY &&
    tomorrowDow <= WEEKDAY_THURSDAY &&
    !availableDates.includes(tomorrowStr)
  ) {
    availableDates.push(tomorrowStr);
  }

  // タイムアタック（金曜）の選択肢：当月1日〜今日の金曜
  const availableFridays = [];
  const fridayCursor = new Date(monthStart);
  while (fridayCursor <= today) {
    if (fridayCursor.getDay() === WEEKDAY_FRIDAY) {
      availableFridays.push(formatDate(fridayCursor));
    }
    fridayCursor.setDate(fridayCursor.getDate() + 1);
  }

  return { availableDates, playedDates, availableFridays };
}

/**
 * 問題マスタ行からクイズオブジェクトを生成
 */
function createQuizObj(row) {
  // 問題マスタ列構成: 日付|出題区分|問題内容|選択肢1|選択肢2|選択肢3|選択肢4|正解番号|解説
  return {
    id: String(row[2]),
    text: String(row[2]),
    options: [String(row[3]), String(row[4]), String(row[5]), String(row[6])],
    correctAnswer: Number(row[7]),
    explanation: String(row[8])
  };
}

/**
 * 配列をランダムにシャッフル (Fisher-Yates)
 */
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

// -------------------------------------------------------------------
// 4. クイズスケジュール解決（バグの根本を修正）
// -------------------------------------------------------------------

/**
 * 今日の出題スケジュールを決定する
 *
 * 処理順序:
 *   1. 前倒しリクエスト（advanceDateが指定された場合）
 *   2. 今日既に回答済み → already_played
 *   3. キャッチアップ候補を探す（lastPlayed翌日〜昨日）
 *   4. 今日の出題を決定（金曜 / 通常 / 祝日前倒し提案 / データなし）
 *
 * @returns {{ earlyReturn, targetDateStr, dayOfWeek, isFriday, isCatchup, isAdvance }}
 *   earlyReturn が null 以外の場合はそのオブジェクトをレスポンスとして返す
 */
function resolveQuizSchedule(employeeId, todayStr, qData, holidays, logData, advanceDate) {

  // --- 1. 前倒しリクエスト ---
  if (advanceDate && advanceDate !== '') {
    const advanceDow = new Date(advanceDate).getDay();
    const isFridayAdvance = (advanceDow === WEEKDAY_FRIDAY);

    // 金曜前倒しは問題マスタに行がないため hasQuizDataForDate チェックをスキップ
    if (!isFridayAdvance && !hasQuizDataForDate(qData, advanceDate)) {
      return { earlyReturn: { success: false, message: '前倒し対象の問題が見つかりません。' } };
    }
    if (isAlreadyAnswered(logData, employeeId, advanceDate)) {
      return { earlyReturn: { success: false, status: 'already_played', message: '前倒し分は既に回答済みです。' } };
    }
    return {
      earlyReturn: null,
      targetDateStr: advanceDate,
      dayOfWeek: advanceDow,
      isFriday: isFridayAdvance,
      isAdvance: true,
      isCatchup: false
    };
  }

  // --- 2. 今日既に回答済み ---
  if (isAlreadyAnswered(logData, employeeId, todayStr)) {
    return { earlyReturn: { success: false, status: 'already_played', message: '今日は終了だ！' } };
  }

  const todayObj = new Date(todayStr);
  const todayDow = todayObj.getDay();

  // --- 3. キャッチアップ候補（最も古い未受験日を探す）---
  // 金曜は問題マスタに行がないため自然にスキップされる
  const lastPlayedStr = getLastPlayedDateFromLog(logData, employeeId);
  if (lastPlayedStr) {
    const lastObj = new Date(lastPlayedStr);
    let candidate = new Date(lastObj);
    candidate.setDate(candidate.getDate() + 1);

    while (candidate < todayObj) {
      const candidateStr = formatDate(candidate);
      if (hasQuizDataForDate(qData, candidateStr) && !isAlreadyAnswered(logData, employeeId, candidateStr)) {
        return {
          earlyReturn: null,
          targetDateStr: candidateStr,
          dayOfWeek: candidate.getDay(),
          isFriday: false,
          isAdvance: false,
          isCatchup: true
        };
      }
      candidate.setDate(candidate.getDate() + 1);
    }
  }

  // --- 4. 今日の出題 ---

  // 今日が金曜
  if (todayDow === WEEKDAY_FRIDAY) {
    if (holidays.has(todayStr)) {
      // 金曜が祝日 → データなし（前日木曜に前倒し済みのはず）
      return { earlyReturn: { success: false, status: 'no_data', message: '本日は祝日です。' } };
    }
    return {
      earlyReturn: null,
      targetDateStr: todayStr,
      dayOfWeek: WEEKDAY_FRIDAY,
      isFriday: true,
      isAdvance: false,
      isCatchup: false
    };
  }

  // 今日にデータあり（月〜木）
  if (hasQuizDataForDate(qData, todayStr)) {
    // 翌日の祝日チェック
    const tomorrowObj = new Date(todayObj);
    tomorrowObj.setDate(tomorrowObj.getDate() + 1);
    const tomorrowStr = formatDate(tomorrowObj);
    const tomorrowDow = tomorrowObj.getDay();

    if (holidays.has(tomorrowStr)) {
      if (tomorrowDow === WEEKDAY_FRIDAY) {
        // 明日が金曜+祝日 → 金曜タイムアタックを前倒し提案
        return {
          earlyReturn: {
            success: false,
            status: 'holiday_advance_available',
            message: '明日（' + tomorrowStr + '）は祝日のため、今日タイムアタックを受けますか？',
            advanceDate: tomorrowStr
          }
        };
      }
      if (hasQuizDataForDate(qData, tomorrowStr)) {
        // 明日が祝日（非金曜）かつデータあり → 通常の前倒し提案
        return {
          earlyReturn: {
            success: false,
            status: 'holiday_advance_available',
            message: '明日（' + tomorrowStr + '）は祝日のため、前倒しで受験できます。今日受けますか？',
            advanceDate: tomorrowStr
          }
        };
      }
    }

    return {
      earlyReturn: null,
      targetDateStr: todayStr,
      dayOfWeek: todayDow,
      isFriday: false,
      isAdvance: false,
      isCatchup: false
    };
  }

  // 今日にデータなし（土日・祝日など）
  return { earlyReturn: { success: false, status: 'no_data', message: '本日の問題はありません。' } };
}

// -------------------------------------------------------------------
// 5. クイズセット構築
// -------------------------------------------------------------------

/**
 * 曜日に応じたクイズセットを構築する
 * @returns {{ quizzes: Array, isFriday: boolean }}
 */
function buildQuizSet(qData, targetDateStr, dayOfWeek, ss, employeeId) {

  // 金曜：その週（月〜木）の全問からランダム出題
  if (dayOfWeek === WEEKDAY_FRIDAY) {
    const fridayObj = new Date(targetDateStr);
    const mondayObj = new Date(fridayObj);
    mondayObj.setDate(mondayObj.getDate() - DAYS_MON_TO_FRI);
    const mondayStr = formatDate(mondayObj);

    const weekQuizzes = [];
    for (let i = 1; i < qData.length; i++) {
      const qDateStr = formatDate(qData[i][0]);
      if (qDateStr >= mondayStr && qDateStr < targetDateStr && !String(qData[i][1]).includes('筆記')) {
        weekQuizzes.push(createQuizObj(qData[i]));
      }
    }
    shuffleArray(weekQuizzes);
    return { quizzes: weekQuizzes.slice(0, FRIDAY_QUIZ_COUNT), isFriday: true };
  }

  // 月曜：当日のみ5問
  const todayQuizzes = getQuizzesByDate(qData, targetDateStr);

  // 火〜木：前日5問＋当日5問（前日未回答の場合のみ前日を追加）
  if (dayOfWeek >= WEEKDAY_TUESDAY && dayOfWeek <= WEEKDAY_THURSDAY) {
    const prevDayObj = new Date(targetDateStr);
    prevDayObj.setDate(prevDayObj.getDate() - 1);
    const prevDayStr = formatDate(prevDayObj);

    const logSheet = getSheetOrThrow(ss, SHEET_LOG_DAILY);
    const logData = logSheet.getDataRange().getValues();

    if (!isAlreadyAnswered(logData, employeeId, prevDayStr)) {
      const prevQuizzes = getQuizzesByDate(qData, prevDayStr);
      return { quizzes: prevQuizzes.concat(todayQuizzes), isFriday: false };
    }
  }

  return { quizzes: todayQuizzes, isFriday: false };
}

// -------------------------------------------------------------------
// 6. クイズ配信 API
// -------------------------------------------------------------------

/**
 * 今日の出題クイズを取得する
 */
function apiGetTodayQuiz(employeeId, advanceDate) {
  try {
    const ss = SpreadsheetApp.openById(DB_SPREADSHEET_ID);
    const quizSheet = getSheetOrThrow(ss, SHEET_MST_QUIZ);
    const logSheet  = getSheetOrThrow(ss, SHEET_LOG_DAILY);
    const qData     = quizSheet.getDataRange().getValues();
    const logData   = logSheet.getDataRange().getValues();
    const holidays  = getHolidayDates(ss);
    const todayStr  = formatDate(new Date());

    const resolved = resolveQuizSchedule(employeeId, todayStr, qData, holidays, logData, advanceDate);
    if (resolved.earlyReturn) return resolved.earlyReturn;

    const { targetDateStr, dayOfWeek, isFriday, isCatchup, isAdvance } = resolved;

    const quizSet = buildQuizSet(qData, targetDateStr, dayOfWeek, ss, employeeId);
    if (quizSet.quizzes.length === 0) {
      return { success: false, status: 'no_quizzes', message: '問題が設定されていません。' };
    }

    return {
      success: true,
      data: {
        targetDate: targetDateStr,
        isFriday: isFriday,
        isCatchup: isCatchup,
        isAdvance: isAdvance,
        quizzes: quizSet.quizzes
      }
    };

  } catch (e) {
    console.error('GetQuiz Error:', e);
    return { success: false, message: 'サーバーエラー: ' + e.message };
  }
}

/**
 * 指定日付のクイズを返す（ユーザーがプルダウンで選択した日付用）
 * @param {string} employeeId
 * @param {string} targetDate - 'yyyy/MM/dd'
 * @param {boolean} isFriday - trueの場合はタイムアタック（週のランダム10問）
 */
function apiGetQuizByDate(employeeId, targetDate, isFriday) {
  try {
    const ss = SpreadsheetApp.openById(DB_SPREADSHEET_ID);
    const quizSheet = getSheetOrThrow(ss, SHEET_MST_QUIZ);
    const qData = quizSheet.getDataRange().getValues();
    const logSheet = getSheetOrThrow(ss, SHEET_LOG_DAILY);
    const logData = logSheet.getDataRange().getValues();

    // 受験済みチェック
    if (isAlreadyAnswered(logData, employeeId, targetDate)) {
      return { success: false, status: 'already_played', message: '既に回答済みです。' };
    }

    let quizzes;
    if (isFriday) {
      // 金曜：週の月〜木からランダム10問
      const quizSet = buildQuizSet(qData, targetDate, WEEKDAY_FRIDAY, ss, employeeId);
      quizzes = quizSet.quizzes;
    } else {
      const dateObj = new Date(targetDate.replace(/\//g, '-') + 'T00:00:00+09:00');
      const dayOfWeek = dateObj.getDay();
      const todayQuizzes = getQuizzesByDate(qData, targetDate);

      if (dayOfWeek >= WEEKDAY_TUESDAY && dayOfWeek <= WEEKDAY_THURSDAY) {
        // 火〜木：前日5問＋当日5問（復習として常に10問）
        const prevDayObj = new Date(targetDate.replace(/\//g, '-') + 'T00:00:00+09:00');
        prevDayObj.setDate(prevDayObj.getDate() - 1);
        const prevDayStr = formatDate(prevDayObj);
        const prevQuizzes = getQuizzesByDate(qData, prevDayStr);
        quizzes = prevQuizzes.concat(todayQuizzes);
      } else {
        // 月曜：当日5問のみ
        quizzes = todayQuizzes;
      }
    }

    if (!quizzes || quizzes.length === 0) {
      return { success: false, status: 'no_quizzes', message: '問題が設定されていません。' };
    }

    return {
      success: true,
      data: {
        targetDate: targetDate,
        isFriday: isFriday,
        quizzes: quizzes
      }
    };
  } catch (e) {
    console.error('GetQuizByDate Error:', e);
    return { success: false, message: 'サーバーエラー: ' + e.message };
  }
}

// -------------------------------------------------------------------
// 7. 回答記録・採点
// -------------------------------------------------------------------

/**
 * テスト結果を送信・記録する
 * 金曜タイマーはクライアントから送られた timeSpentSec で判定（CacheService不使用）
 */
function apiSubmitResult(employeeId, targetDateStr, isFriday, answers, timeSpentSec) {
  try {
    const ss = SpreadsheetApp.openById(DB_SPREADSHEET_ID);

    // 重複送信チェック
    const dailyLogSheet = getSheetOrThrow(ss, SHEET_LOG_DAILY);
    const logData = dailyLogSheet.getDataRange().getValues();
    for (let i = 1; i < logData.length; i++) {
      if (String(logData[i][1]) === String(employeeId) &&
          String(logData[i][2]) === String(targetDateStr)) {
        return {
          success: true,
          message: 'この日の回答は既に記録済みです。',
          data: { score: Number(logData[i][3]) || 0, maxScore: Number(logData[i][4]) || 0 }
        };
      }
    }

    // 金曜：制限時間チェック（クライアントの timeSpentSec を使用）
    if (isFriday) {
      const maxSec = FRIDAY_TIME_LIMIT_SEC + FRIDAY_TIMEOUT_MARGIN_SEC;
      if (Number(timeSpentSec) > maxSec) {
        answers.forEach(a => { a.isCorrect = false; });
        return recordScoresAndLogs(ss, employeeId, targetDateStr, answers, timeSpentSec, '制限時間を超過したため、0点として記録されました。');
      }
    }

    return recordScoresAndLogs(ss, employeeId, targetDateStr, answers, timeSpentSec, 'テスト結果が記録されました！');

  } catch (e) {
    console.error('Submit Error:', e);
    return { success: false, message: '記録中にエラーが発生しました: ' + e.message };
  }
}

/**
 * スコア計算・ログ書き込みの共通処理
 */
function recordScoresAndLogs(ss, employeeId, targetDateStr, answers, timeSpentSec, resultMessage) {
  const score    = answers.filter(a => a.isCorrect).length;
  const maxScore = answers.length;
  const timestamp = new Date();
  const startTime = new Date(timestamp.getTime() - (timeSpentSec * 1000));

  // 社員名簿から氏名取得 + 累計スコア・最終回答日を更新
  const memberSheet = getSheetOrThrow(ss, SHEET_MEMBERS);
  const mData = memberSheet.getDataRange().getValues();
  let employeeName = '';

  for (let i = 1; i < mData.length; i++) {
    if (String(mData[i][0]) !== String(employeeId)) continue;

    employeeName = mData[i][1] || '';

    // 最終回答日（より新しい日付のみ更新）
    const currentLastStr = mData[i][3]
      ? ((mData[i][3] instanceof Date) ? formatDate(mData[i][3]) : String(mData[i][3]))
      : '';
    if (!currentLastStr || targetDateStr > currentLastStr) {
      memberSheet.getRange(i + 1, 4).setValue(targetDateStr);
    }

    // 累計スコア
    const currentScore = Number(mData[i][4]) || 0;
    memberSheet.getRange(i + 1, 5).setValue(currentScore + score);
    break;
  }

  // 日次ログ書き込み
  const dailyLogSheet = getSheetOrThrow(ss, SHEET_LOG_DAILY);
  dailyLogSheet.appendRow([timestamp, employeeId, targetDateStr, score, maxScore, startTime, timeSpentSec, employeeName]);

  // 詳細ログ書き込み
  const detailLogSheet = getSheetOrThrow(ss, SHEET_LOG_DETAIL);
  const detailRows = answers.map(a => [timestamp, employeeId, targetDateStr, a.id, a.selected, a.isCorrect]);
  if (detailRows.length > 0) {
    detailLogSheet.getRange(detailLogSheet.getLastRow() + 1, 1, detailRows.length, detailRows[0].length).setValues(detailRows);
  }

  return {
    success: true,
    message: resultMessage,
    data: { score: score, maxScore: maxScore }
  };
}

// -------------------------------------------------------------------
// 8. ランキング
// -------------------------------------------------------------------

/**
 * 指定期間のランキングを取得する（フロントエンドから呼ばれる）
 */
function apiGetLeaderboard(period, targetMonth) {
  try {
    if (period === 'monthlyTest') {
      const ss = SpreadsheetApp.openById(DB_SPREADSHEET_ID);
      return getMonthlyTestRanking(ss, targetMonth || null);
    }
    const all = apiGetAllLeaderboards();
    if (!all.success) return all;
    const data = all.data[period];
    if (!data) return { success: false, message: '不明な期間です。' };
    return { success: true, data: data };
  } catch (e) {
    return { success: false, message: 'ランキング取得エラー: ' + e.message };
  }
}

/**
 * 全期間のランキングを一括取得する
 */
function apiGetAllLeaderboards() {
  try {
    const cache = CacheService.getScriptCache();
    const cacheKey = 'leaderboard_all';
    const cached = cache.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const ss = SpreadsheetApp.openById(DB_SPREADSHEET_ID);

    // 社員一覧（admin除外）
    const memberSheet = getSheetOrThrow(ss, SHEET_MEMBERS);
    const mData = memberSheet.getDataRange().getValues();
    const nameMap = {};
    for (let i = 1; i < mData.length; i++) {
      const dbId = String(mData[i][0]);
      if (!isAdmin(dbId) && dbId !== '') nameMap[dbId] = mData[i][1];
    }

    // 日付範囲計算
    const now = new Date();
    const dayOfWeek = now.getDay();
    const diffToMonday = (dayOfWeek === 0) ? 6 : dayOfWeek - 1;
    const mondayObj = new Date(now);
    mondayObj.setDate(now.getDate() - diffToMonday);
    const fridayObj = new Date(mondayObj);
    fridayObj.setDate(mondayObj.getDate() + DAYS_MON_TO_FRI);
    const weekStartStr  = formatDate(mondayObj);
    const weekEndStr    = formatDate(fridayObj);
    const monthStartStr = formatDate(new Date(now.getFullYear(), now.getMonth(), 1));
    const monthEndStr   = formatDate(new Date(now.getFullYear(), now.getMonth() + 1, 0));

    // 回答ログから一括集計
    const logSheet = getSheetOrThrow(ss, SHEET_LOG_DAILY);
    const logData  = logSheet.getDataRange().getValues();

    const totalScores   = {};
    const weeklyScores  = {};
    const monthlyScores = {};
    Object.keys(nameMap).forEach(id => {
      totalScores[id]   = { name: nameMap[id], score: 0 };
      weeklyScores[id]  = { name: nameMap[id], score: 0 };
      monthlyScores[id] = { name: nameMap[id], score: 0 };
    });

    for (let i = 1; i < logData.length; i++) {
      const empId = String(logData[i][1]);
      if (!nameMap[empId]) continue;
      const rawDate   = logData[i][2];
      const logDateStr = (rawDate instanceof Date) ? formatDate(rawDate) : String(rawDate);
      const score     = Number(logData[i][3]) || 0;

      totalScores[empId].score += score;
      if (logDateStr >= weekStartStr  && logDateStr <= weekEndStr)  weeklyScores[empId].score  += score;
      if (logDateStr >= monthStartStr && logDateStr <= monthEndStr) monthlyScores[empId].score += score;
    }

    const toRanking = obj => Object.values(obj).sort((a, b) => b.score - a.score);
    const monthlyTestResult = getMonthlyTestRanking(ss, null);

    const result = {
      success: true,
      data: {
        weekly:      toRanking(weeklyScores),
        monthly:     toRanking(monthlyScores),
        total:       toRanking(totalScores),
        monthlyTest: monthlyTestResult
      }
    };

    cache.put(cacheKey, JSON.stringify(result), LEADERBOARD_CACHE_SEC);
    return result;

  } catch (e) {
    console.error('AllLeaderboards Error:', e);
    return { success: false, message: 'ランキング取得エラー: ' + e.message };
  }
}

/**
 * 月次テスト（筆記）のランキングを取得する
 */
function getMonthlyTestRanking(ss, targetMonth) {
  const scoreSheet = getSheetOrThrow(ss, SHEET_SCORE_MONTHLY);
  const scoreData  = scoreSheet.getDataRange().getValues();
  const memberSheet = getSheetOrThrow(ss, SHEET_MEMBERS);
  const mData = memberSheet.getDataRange().getValues();

  const nameMap = {};
  for (let i = 1; i < mData.length; i++) {
    const dbId = String(mData[i][0]);
    if (!isAdmin(dbId) && dbId !== '') nameMap[dbId] = mData[i][1];
  }

  // Dateオブジェクト自動変換対策: スプレッドシートが "2026/02" を Date に変換する場合がある
  const toMonthStr = v => (v instanceof Date)
    ? Utilities.formatDate(v, 'Asia/Tokyo', 'yyyy/MM')
    : String(v).trim().substring(0, 7);

  const monthSet = new Set();
  for (let i = 1; i < scoreData.length; i++) {
    if (scoreData[i][0]) monthSet.add(toMonthStr(scoreData[i][0]));
  }
  const availableMonths = Array.from(monthSet).sort().reverse();

  if (!targetMonth && availableMonths.length > 0) targetMonth = availableMonths[0];

  let ranking = [];
  if (targetMonth) {
    for (let i = 1; i < scoreData.length; i++) {
      if (toMonthStr(scoreData[i][0]) === targetMonth) {
        const empId = String(scoreData[i][1]);
        ranking.push({ name: nameMap[empId] || empId, score: Number(scoreData[i][2]) || 0 });
      }
    }
    ranking.sort((a, b) => b.score - a.score);
  }

  return { success: true, data: ranking, availableMonths: availableMonths, selectedMonth: targetMonth || '' };
}

// -------------------------------------------------------------------
// 9. 管理者機能
// -------------------------------------------------------------------

/**
 * 月次筆記テストの点数を登録・更新する（管理者のみ）
 */
function apiAdminSubmitMonthlyScore(callerEmployeeId, employeeId, targetMonth, scoreStr) {
  try {
    if (!isAdmin(callerEmployeeId)) {
      return { success: false, message: '管理者権限がありません。' };
    }
    const ss = SpreadsheetApp.openById(DB_SPREADSHEET_ID);
    const scoreSheet = getSheetOrThrow(ss, SHEET_SCORE_MONTHLY);
    const data = scoreSheet.getDataRange().getValues();

    let updated = false;
    for (let i = 1; i < data.length; i++) {
      const rowMonth = (data[i][0] instanceof Date)
        ? Utilities.formatDate(data[i][0], 'Asia/Tokyo', 'yyyy/MM')
        : String(data[i][0]).trim().substring(0, 7);
      if (rowMonth === targetMonth && String(data[i][1]) === employeeId) {
        scoreSheet.getRange(i + 1, 3).setValue(scoreStr);
        updated = true;
        break;
      }
    }
    if (!updated) scoreSheet.appendRow([targetMonth, employeeId, scoreStr]);

    return { success: true, message: '月次スコアを保存しました。' };

  } catch (e) {
    console.error('Admin Error:', e);
    return { success: false, message: '保存エラー: ' + e.message };
  }
}

/**
 * 月次テスト用の問題セットを生成する（管理者のみ）
 * カテゴリごとに4択9問・筆記1問をランダム選出
 */
function apiGetMonthlyTestQuestions(callerEmployeeId, targetMonth) {
  try {
    if (!isAdmin(callerEmployeeId)) {
      return { success: false, message: '管理者権限がありません。' };
    }

    const ss = SpreadsheetApp.openById(DB_SPREADSHEET_ID);
    const quizSheet = getSheetOrThrow(ss, SHEET_MST_QUIZ);
    const quizData  = quizSheet.getDataRange().getValues();

    const filterMonth = targetMonth ? String(targetMonth).trim() : null;

    const categoryMap = {};
    for (let i = 1; i < quizData.length; i++) {
      const row = quizData[i];
      let rowMonth = (row[0] instanceof Date)
        ? Utilities.formatDate(row[0], 'Asia/Tokyo', 'yyyy/MM')
        : String(row[0]).trim().substring(0, 7);

      const category = String(row[1]).trim();
      if (!category) continue;
      if (filterMonth && rowMonth !== filterMonth) continue;

      if (!categoryMap[category]) categoryMap[category] = [];
      categoryMap[category].push({
        id: String(row[2]),
        text: String(row[2]),
        options: [String(row[3]), String(row[4]), String(row[5]), String(row[6])],
        correctAnswer: Number(row[7]),
        explanation: String(row[8])
      });
    }

    const MONTHLY_TEST_CATEGORIES    = ['足場の法令', '足場の設置基準', 'サンプル建設ルール'];
    const CHOICE_COUNT_PER_CATEGORY  = 9;
    const sections = [];

    for (const category of MONTHLY_TEST_CATEGORIES) {
      const writtenCategory = category + '（筆記）';
      const choices = (categoryMap[category] || []).slice();
      const written = (categoryMap[writtenCategory] || []).slice();
      shuffleArray(choices);
      shuffleArray(written);
      sections.push({
        category: category,
        choices:  choices.slice(0, CHOICE_COUNT_PER_CATEGORY),
        written:  written.slice(0, 1)
      });
    }

    return { success: true, data: sections };

  } catch (e) {
    return { success: false, message: e.message };
  }
}

/**
 * 問題マスタに存在する月の一覧を返す（管理者のみ）
 */
function apiGetAvailableTestMonths(callerEmployeeId) {
  try {
    if (!isAdmin(callerEmployeeId)) {
      return { success: false, message: '管理者権限がありません。' };
    }
    const ss = SpreadsheetApp.openById(DB_SPREADSHEET_ID);
    const quizData = getSheetOrThrow(ss, SHEET_MST_QUIZ).getDataRange().getValues();

    const monthSet = new Set();
    for (let i = 1; i < quizData.length; i++) {
      if (!String(quizData[i][1]).trim()) continue;
      const rowMonth = (quizData[i][0] instanceof Date)
        ? Utilities.formatDate(quizData[i][0], 'Asia/Tokyo', 'yyyy/MM')
        : String(quizData[i][0]).trim().substring(0, 7);
      if (/^\d{4}\/\d{2}$/.test(rowMonth)) monthSet.add(rowMonth);
    }

    return { success: true, data: Array.from(monthSet).sort().reverse() };

  } catch (e) {
    return { success: false, message: e.message };
  }
}

// -------------------------------------------------------------------
// 10. 個人統計
// -------------------------------------------------------------------

function apiGetPersonalStats(employeeId) {
  try {
    const ss = SpreadsheetApp.openById(DB_SPREADSHEET_ID);
    const logSheet = getSheetOrThrow(ss, SHEET_LOG_DAILY);
    const logData  = logSheet.getDataRange().getValues();

    const now = new Date();
    const dayOfWeek = now.getDay();
    const diffToMonday = (dayOfWeek === 0) ? 6 : dayOfWeek - 1;
    const mondayObj = new Date(now);
    mondayObj.setDate(now.getDate() - diffToMonday);
    const fridayObj = new Date(mondayObj);
    fridayObj.setDate(mondayObj.getDate() + DAYS_MON_TO_FRI);
    const weekStartStr = formatDate(mondayObj);
    const weekEndStr   = formatDate(fridayObj);

    const sixMonthsAgoStr = Utilities.formatDate(
      new Date(now.getFullYear(), now.getMonth() - 5, 1), 'Asia/Tokyo', 'yyyy/MM'
    );

    const weeklyScores  = {};
    const monthlyScores = {};

    for (let i = 1; i < logData.length; i++) {
      const row = logData[i];
      if (String(row[1]) !== String(employeeId)) continue;
      const rawDate  = row[2];
      const dateStr  = (rawDate instanceof Date) ? formatDate(rawDate) : String(rawDate);
      const score    = Number(row[3]) || 0;
      const monthStr = dateStr.substring(0, 7);

      if (dateStr >= weekStartStr && dateStr <= weekEndStr) {
        weeklyScores[dateStr] = (weeklyScores[dateStr] || 0) + score;
      }
      if (monthStr >= sixMonthsAgoStr) {
        monthlyScores[monthStr] = (monthlyScores[monthStr] || 0) + score;
      }
    }

    const monthlyData = Object.keys(monthlyScores).sort().map(m => ({ month: m, score: monthlyScores[m] }));

    return {
      success: true,
      data: { weekStart: weekStartStr, weekEnd: weekEndStr, weekly: weeklyScores, monthly: monthlyData }
    };

  } catch (e) {
    return { success: false, message: e.message };
  }
}

// -------------------------------------------------------------------
// 11. 復習
// -------------------------------------------------------------------

/**
 * 全期間の間違えた問題を取得する
 */
function apiGetWrongAnswers(employeeId, targetDate) {
  try {
    const ss = SpreadsheetApp.openById(DB_SPREADSHEET_ID);
    const detailSheet = getSheetOrThrow(ss, SHEET_LOG_DETAIL);
    const detailData  = detailSheet.getDataRange().getValues();

    const filterDate = targetDate ? String(targetDate).trim() : null;

    const wrongCounts  = {};
    const lastWrongTime = {};
    for (let i = 1; i < detailData.length; i++) {
      const row = detailData[i];
      if (String(row[1]) !== String(employeeId)) continue;
      if (filterDate) {
        const rowDate = (row[2] instanceof Date)
          ? Utilities.formatDate(row[2], 'Asia/Tokyo', 'yyyy/MM/dd')
          : String(row[2]).trim();
        if (rowDate !== filterDate) continue;
      }
      if (!row[5]) {
        const questionId = String(row[3]);
        wrongCounts[questionId] = (wrongCounts[questionId] || 0) + 1;
        const ts = (row[0] instanceof Date) ? row[0] : new Date(row[0]);
        if (!lastWrongTime[questionId] || ts > lastWrongTime[questionId]) lastWrongTime[questionId] = ts;
      }
    }

    if (Object.keys(wrongCounts).length === 0) return { success: true, data: [] };

    let targetIds = Object.keys(wrongCounts);
    if (!filterDate) {
      const clearSheet = ss.getSheetByName(SHEET_REVIEW_CLEAR);
      if (clearSheet) {
        const clearData = clearSheet.getDataRange().getValues();
        const lastClearTime = {};
        for (let i = 1; i < clearData.length; i++) {
          if (String(clearData[i][1]) !== String(employeeId)) continue;
          const qId = String(clearData[i][2]);
          const ts  = (clearData[i][0] instanceof Date) ? clearData[i][0] : new Date(clearData[i][0]);
          if (!lastClearTime[qId] || ts > lastClearTime[qId]) lastClearTime[qId] = ts;
        }
        targetIds = targetIds.filter(qId =>
          !lastClearTime[qId] || lastWrongTime[qId] > lastClearTime[qId]
        );
      }
    }

    if (targetIds.length === 0) return { success: true, data: [] };

    const quizSheet = getSheetOrThrow(ss, SHEET_MST_QUIZ);
    const quizData  = quizSheet.getDataRange().getValues();
    const quizMap   = {};
    for (let i = 1; i < quizData.length; i++) {
      const qId = String(quizData[i][2]);
      if (targetIds.includes(qId)) {
        quizMap[qId] = {
          id: qId,
          text: qId,
          options: [String(quizData[i][3]), String(quizData[i][4]), String(quizData[i][5]), String(quizData[i][6])],
          correctAnswer: Number(quizData[i][7]),
          explanation: String(quizData[i][8]),
          wrongCount: wrongCounts[qId]
        };
      }
    }

    return { success: true, data: Object.values(quizMap).sort((a, b) => b.wrongCount - a.wrongCount) };

  } catch (e) {
    return { success: false, message: e.message };
  }
}

/**
 * 復習クイズで正解した問題をクリア済みとして記録する
 */
function apiClearReviewQuestion(employeeId, questionId) {
  try {
    const ss = SpreadsheetApp.openById(DB_SPREADSHEET_ID);
    let sheet = ss.getSheetByName(SHEET_REVIEW_CLEAR);
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_REVIEW_CLEAR);
      sheet.appendRow(['タイムスタンプ', '社員ID', '問題ID']);
    }
    sheet.appendRow([new Date(), String(employeeId), String(questionId)]);
    return { success: true };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

// -------------------------------------------------------------------
// 12. 集計シート
// -------------------------------------------------------------------

function calculateWeeksInMonth(monthStart, monthEnd) {
  const weeks = [];
  let cursor = new Date(monthStart);
  while (cursor.getDay() !== WEEKDAY_MONDAY && cursor <= monthEnd) {
    cursor.setDate(cursor.getDate() + 1);
  }
  while (cursor <= monthEnd) {
    const mondayStr = formatDate(cursor);
    const fridayObj = new Date(cursor);
    fridayObj.setDate(fridayObj.getDate() + DAYS_MON_TO_FRI);
    weeks.push({ label: 'W' + (weeks.length + 1), start: mondayStr, end: formatDate(fridayObj) });
    cursor.setDate(cursor.getDate() + 7);
  }
  return weeks;
}

function aggregateMemberScores(members, logData, weeks, monthlyScores) {
  return members.map(member => {
    const row = [member.id, member.name];
    let dailyMonthTotal = 0;
    weeks.forEach(week => {
      let weekScore = 0;
      for (let i = 1; i < logData.length; i++) {
        if (String(logData[i][1]) === member.id) {
          const rawDate    = logData[i][2];
          const logDateStr = (rawDate instanceof Date) ? formatDate(rawDate) : String(rawDate);
          if (logDateStr >= week.start && logDateStr <= week.end) {
            weekScore += Number(logData[i][3]) || 0;
          }
        }
      }
      row.push(weekScore);
      dailyMonthTotal += weekScore;
    });
    const monthlyTestScore = monthlyScores[member.id] || 0;
    row.push(dailyMonthTotal, monthlyTestScore, dailyMonthTotal + monthlyTestScore);
    return row;
  });
}

/**
 * 集計一覧シートを生成・更新する
 * @param {string} targetYearMonth - 対象年月 (YYYY/MM)、省略時は当月
 */
function updateSummarySheet(targetYearMonth) {
  const ss = SpreadsheetApp.openById(DB_SPREADSHEET_ID);

  if (!targetYearMonth) {
    targetYearMonth = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM');
  }
  const year  = parseInt(targetYearMonth.split('/')[0], 10);
  const month = parseInt(targetYearMonth.split('/')[1], 10) - 1;

  const monthStart    = new Date(year, month, 1);
  const monthEnd      = new Date(year, month + 1, 0);
  const monthStartStr = formatDate(monthStart);
  const monthEndStr   = formatDate(monthEnd);

  const weeks = calculateWeeksInMonth(monthStart, monthEnd);

  const memberSheet = getSheetOrThrow(ss, SHEET_MEMBERS);
  const mData = memberSheet.getDataRange().getValues();
  const members = [];
  for (let i = 1; i < mData.length; i++) {
    const dbId = String(mData[i][0]);
    if (!isAdmin(dbId) && dbId !== '') members.push({ id: dbId, name: mData[i][1] });
  }

  const logSheet = getSheetOrThrow(ss, SHEET_LOG_DAILY);
  const logData  = logSheet.getDataRange().getValues();

  const monthStats      = {};
  const cumulativeScores = {};
  const fridayScores    = {};
  members.forEach(m => {
    monthStats[m.id]       = { totalScore: 0, totalMaxScore: 0, days: new Set() };
    cumulativeScores[m.id] = 0;
    fridayScores[m.id]     = new Array(weeks.length).fill(0);
  });

  for (let i = 1; i < logData.length; i++) {
    const empId      = String(logData[i][1]);
    if (!monthStats[empId]) continue;
    const rawDate    = logData[i][2];
    const logDateStr = (rawDate instanceof Date) ? formatDate(rawDate) : String(rawDate);
    const score      = Number(logData[i][3]) || 0;

    cumulativeScores[empId] += score;
    if (logDateStr >= monthStartStr && logDateStr <= monthEndStr) {
      monthStats[empId].totalScore    += score;
      monthStats[empId].totalMaxScore += Number(logData[i][4]) || 0;
      monthStats[empId].days.add(logDateStr);
      weeks.forEach((week, weekIdx) => {
        if (logDateStr === week.end) fridayScores[empId][weekIdx] += score;
      });
    }
  }

  const scoreSheet  = getSheetOrThrow(ss, SHEET_SCORE_MONTHLY);
  const scoreData   = scoreSheet.getDataRange().getValues();
  const monthlyScores = {};
  for (let i = 1; i < scoreData.length; i++) {
    if (String(scoreData[i][0]) === targetYearMonth) {
      monthlyScores[String(scoreData[i][1])] = Number(scoreData[i][2]) || 0;
    }
  }

  const rows = aggregateMemberScores(members, logData, weeks, monthlyScores);

  const dailyMonthTotalIdx = rows.length > 0 ? rows[0].length - 3 : 0;
  const monthlyRankOrder   = rows.map((row, idx) => ({ idx, score: row[dailyMonthTotalIdx] })).sort((a, b) => b.score - a.score);
  const monthlyRanks       = new Array(rows.length);
  monthlyRankOrder.forEach((entry, rank) => { monthlyRanks[entry.idx] = rank + 1; });

  const cumulativeRankOrder = members.map((m, idx) => ({ idx, score: cumulativeScores[m.id] || 0 })).sort((a, b) => b.score - a.score);
  const cumulativeRanks     = new Array(members.length);
  cumulativeRankOrder.forEach((entry, rank) => { cumulativeRanks[entry.idx] = rank + 1; });

  rows.forEach((row, idx) => {
    const empId      = row[0];
    const stats      = monthStats[empId] || { days: new Set(), totalScore: 0, totalMaxScore: 0 };
    const attendance = stats.days.size;
    const correctRate = stats.totalMaxScore > 0
      ? Math.round((stats.totalScore / stats.totalMaxScore) * 1000) / 10
      : 0;
    const empFridayScores = fridayScores[empId] || new Array(weeks.length).fill(0);
    for (let w = weeks.length - 1; w >= 0; w--) {
      row.splice(2 + w + 1, 0, empFridayScores[w]);
    }
    row.splice(row.length - 2, 0, attendance, correctRate);
    row.push(monthlyRanks[idx], cumulativeRanks[idx]);
  });

  const headers = ['社員ID', '氏名'];
  weeks.forEach(w => { headers.push(w.label + '合計'); headers.push(w.label + '金曜'); });
  headers.push('日次月合計', '出席日数', '正答率(%)', '月次テスト', '総合計', '月間順位', '累計順位');

  const summarySheetName = SHEET_SUMMARY + '_' + targetYearMonth.replace('/', '-');
  let summarySheet = ss.getSheetByName(summarySheetName);
  if (!summarySheet) summarySheet = ss.insertSheet(summarySheetName);
  summarySheet.clearContents();
  summarySheet.clearFormats();
  summarySheet.getRange(1, 1).setValue(targetYearMonth + ' 集計一覧').setFontWeight('bold').setFontSize(12);
  summarySheet.getRange(3, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#f3f3f3');
  if (rows.length > 0) summarySheet.getRange(4, 1, rows.length, rows[0].length).setValues(rows);
  summarySheet.setFrozenRows(3);
  summarySheet.setFrozenColumns(2);

  Logger.log(targetYearMonth + ' の集計一覧を更新しました（' + rows.length + '名）');
  deleteOldArchivedSheets(ss, SHEET_SUMMARY, 3);
}

function triggerDailyUpdateSummary() {
  updateSummarySheet();
}

// -------------------------------------------------------------------
// 13. Googleカレンダー連携
// -------------------------------------------------------------------

/**
 * Googleカレンダーから日本の祝日を取得して祝日リストシートを自動更新する
 * @param {number} year - 対象年（省略時は当年）
 */
function syncHolidaysFromCalendar(year) {
  const HOLIDAY_CAL_ID = 'ja.japanese#sample@example.com';
  if (!year) year = new Date().getFullYear();

  let calendar = CalendarApp.getCalendarById(HOLIDAY_CAL_ID);
  if (!calendar) {
    try {
      CalendarApp.subscribeToCalendar(HOLIDAY_CAL_ID);
      calendar = CalendarApp.getCalendarById(HOLIDAY_CAL_ID);
    } catch (e) {
      Logger.log('カレンダーの自動登録に失敗: ' + e.message);
    }
    if (!calendar) {
      Logger.log('祝日カレンダーが見つかりません。Googleカレンダーで「日本の祝日」を追加してください。');
      return;
    }
  }

  const events = calendar.getEvents(new Date(year, 0, 1), new Date(year, 11, 31));
  const ss = SpreadsheetApp.openById(DB_SPREADSHEET_ID);
  let sheet = ss.getSheetByName(SHEET_HOLIDAYS);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_HOLIDAYS);
    sheet.getRange(1, 1, 1, 2).setValues([['日付', '祝日名']]).setFontWeight('bold').setBackground('#f3f3f3');
    sheet.setFrozenRows(1);
  }

  const existingData  = sheet.getDataRange().getValues();
  const existingDates = new Set();
  for (let i = 1; i < existingData.length; i++) {
    if (existingData[i][0]) existingDates.add(formatDate(existingData[i][0]));
  }

  let addedCount = 0;
  events.forEach(event => {
    const dateStr = formatDate(event.getStartTime());
    if (!existingDates.has(dateStr)) {
      sheet.appendRow([event.getStartTime(), event.getTitle()]);
      existingDates.add(dateStr);
      addedCount++;
    }
  });

  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).sort(1);
  }

  Logger.log(year + '年の祝日を同期しました。新規追加: ' + addedCount + '件');
}

// -------------------------------------------------------------------
// 14. データアーカイブ
// -------------------------------------------------------------------

/**
 * 回答詳細ログの月次アーカイブ（GASトリガーで毎月1日に自動実行）
 */
function archiveDetailLogs() {
  const ss = SpreadsheetApp.openById(DB_SPREADSHEET_ID);
  const detailSheet = getSheetOrThrow(ss, SHEET_LOG_DETAIL);
  const data = detailSheet.getDataRange().getValues();
  if (data.length <= 1) { Logger.log('アーカイブ対象データなし'); return; }

  const currentMonth = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM');
  const archiveGroups = {};

  for (let i = 1; i < data.length; i++) {
    const rowMonth = String(data[i][2]).substring(0, 7);
    if (rowMonth < currentMonth) {
      const key = rowMonth.replace('/', '-');
      if (!archiveGroups[key]) archiveGroups[key] = [];
      archiveGroups[key].push(data[i]);
    }
  }

  if (Object.keys(archiveGroups).length === 0) {
    Logger.log('アーカイブ対象データなし（全て当月分）');
    return;
  }

  const headers = data[0];
  let totalArchived = 0;

  Object.keys(archiveGroups).sort().forEach(key => {
    const archiveSheetName = SHEET_LOG_DETAIL + '_' + key;
    let archiveSheet = ss.getSheetByName(archiveSheetName);
    if (!archiveSheet) {
      archiveSheet = ss.insertSheet(archiveSheetName);
      archiveSheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#f3f3f3');
      archiveSheet.setFrozenRows(1);
    }
    const rows = archiveGroups[key];
    archiveSheet.getRange(archiveSheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
    totalArchived += rows.length;
    Logger.log(archiveSheetName + ': ' + rows.length + '行をアーカイブ');
  });

  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][2]).substring(0, 7) < currentMonth) detailSheet.deleteRow(i + 1);
  }

  Logger.log('アーカイブ完了: 合計' + totalArchived + '行');
  deleteOldArchivedSheets(ss, SHEET_LOG_DETAIL, 3);
}

/**
 * 古いアーカイブシートを削除（keepMonths件だけ残す）
 */
function deleteOldArchivedSheets(ss, sheetPrefix, keepMonths) {
  const prefix  = sheetPrefix + '_';
  const matched = ss.getSheets()
    .filter(s => s.getName().startsWith(prefix))
    .map(s => ({ sheet: s, key: s.getName().slice(prefix.length) }))
    .sort((a, b) => b.key.localeCompare(a.key));
  matched.slice(keepMonths).forEach(item => {
    ss.deleteSheet(item.sheet);
    Logger.log('古いシートを削除: ' + item.sheet.getName());
  });
}

// -------------------------------------------------------------------
// 15. RPCハブ
// -------------------------------------------------------------------

/**
 * フロントエンドからの呼び出し窓口（google.script.run.doServerAction）
 */
function doServerAction(action, params) {
  const logParams = Object.assign({}, params);
  if (logParams.password) logParams.password = '****';
  Logger.log('Action: ' + action + ' Params: ' + JSON.stringify(logParams));

  if (!action || typeof action !== 'string') {
    return { success: false, message: '不正なリクエストです。' };
  }
  if (!params || typeof params !== 'object') {
    return { success: false, message: 'パラメータが不正です。' };
  }

  const ACTIONS_REQUIRING_EMPLOYEE_ID = [
    'login', 'getTodayQuiz', 'getQuizByDate', 'submitResult', 'adminSubmitScore',
    'getWrongAnswers', 'getPersonalStats', 'clearReviewQuestion'
  ];
  if (ACTIONS_REQUIRING_EMPLOYEE_ID.includes(action)) {
    if (!params.employeeId || String(params.employeeId).trim() === '') {
      return { success: false, message: '社員IDが指定されていません。' };
    }
  }

  if (action === 'submitResult') {
    if (!Array.isArray(params.answers) || params.answers.length === 0) {
      return { success: false, message: '回答データが不正です。' };
    }
    params.answers.forEach(a => {
      a.selected  = Number(a.selected) || 0;
      a.isCorrect = Boolean(a.isCorrect);
    });
    // 金曜タイマー: timeSpentSec が不正値の場合はタイムアウト扱い
    if (params.isFriday && (typeof params.timeSpentSec !== 'number' || params.timeSpentSec < 0)) {
      params.timeSpentSec = FRIDAY_TIME_LIMIT_SEC + FRIDAY_TIMEOUT_MARGIN_SEC + 1;
    }
  }

  switch (action) {
    case 'login':
      return apiLogin(params.employeeId, params.password);
    case 'getTodayQuiz':
      return apiGetTodayQuiz(params.employeeId, params.advanceDate);
    case 'getQuizByDate':
      if (!params.targetDate) return { success: false, message: 'targetDate が指定されていません。' };
      return apiGetQuizByDate(params.employeeId, params.targetDate, !!params.isFriday);
    case 'submitResult':
      return apiSubmitResult(params.employeeId, params.targetDateStr, params.isFriday, params.answers, params.timeSpentSec);
    case 'getLeaderboard':
      return apiGetLeaderboard(params.period, params.targetMonth);
    case 'getAllLeaderboards':
      return apiGetAllLeaderboards();
    case 'adminSubmitScore':
      return apiAdminSubmitMonthlyScore(params.callerEmployeeId, params.employeeId, params.targetMonth, params.score);
    case 'getPersonalStats':
      return apiGetPersonalStats(params.employeeId);
    case 'getWrongAnswers':
      return apiGetWrongAnswers(params.employeeId, params.targetDate);
    case 'clearReviewQuestion':
      return apiClearReviewQuestion(params.employeeId, params.questionId);
    case 'getMonthlyTestQuestions':
      return apiGetMonthlyTestQuestions(params.callerEmployeeId, params.targetMonth);
    case 'getAvailableTestMonths':
      return apiGetAvailableTestMonths(params.callerEmployeeId);
    default:
      return { success: false, message: '不明なアクションです。' };
  }
}

// -------------------------------------------------------------------
// 16. 初期構築
// -------------------------------------------------------------------

/**
 * 新しいスプレッドシートの初期構築（初回のみGASエディタから実行）
 */
function setupDatabase() {
  const ss = SpreadsheetApp.openById(DB_SPREADSHEET_ID);

  initSheet(ss, SHEET_MST_QUIZ,      ['日付', '出題区分', '問題内容', '選択肢1', '選択肢2', '選択肢3', '選択肢4', '正解番号', '解説']);
  initSheet(ss, SHEET_MEMBERS,       ['社員ID', '氏名', 'パスワード', '最終回答日', '累計スコア']);
  initSheet(ss, SHEET_LOG_DAILY,     ['タイムスタンプ', '社員ID', '対象日', '得点', '満点数', '開始時刻', '所要時間', '氏名']);
  initSheet(ss, SHEET_LOG_DETAIL,    ['タイムスタンプ', '社員ID', '対象日', '問題ID', '選んだ選択肢', '正誤']);
  initSheet(ss, SHEET_SCORE_MONTHLY, ['対象月', '社員ID', '月次点数']);
  initSheet(ss, SHEET_HOLIDAYS,      ['日付', '祝日名']);

  if (!ss.getSheetByName(SHEET_SUMMARY)) ss.insertSheet(SHEET_SUMMARY);

  // 管理者アカウントの初期作成
  const memberSheet = ss.getSheetByName(SHEET_MEMBERS);
  if (memberSheet.getLastRow() === 1) {
    memberSheet.appendRow([ADMIN_ID, '管理者', 'pass1234', '', 0]);
  }

  // デフォルトの「シート1」を削除
  const sheet1 = ss.getSheetByName('シート1');
  if (sheet1 && ss.getSheets().length > 1) ss.deleteSheet(sheet1);

  Logger.log('初期構築が完了しました！シートを確認してください。');
}

function initSheet(ss, sheetName, headers) {
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) sheet = ss.insertSheet(sheetName);
  sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).clearContent();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#f3f3f3');
  sheet.setFrozenRows(1);
}

// -------------------------------------------------------------------
// テスト関数（GASエディタから手動実行）
// -------------------------------------------------------------------

/**
 * 問題マスタの列構成・データを確認する
 * 期待値: 9列（日付|出題区分|問題内容|選択肢1|選択肢2|選択肢3|選択肢4|正解番号|解説）
 */
function test_quizData() {
  const ss = SpreadsheetApp.openById(DB_SPREADSHEET_ID);
  const sheet = getSheetOrThrow(ss, SHEET_MST_QUIZ);
  const data = sheet.getDataRange().getValues();

  Logger.log('===== 問題マスタ確認 =====');
  Logger.log('総行数（ヘッダー含む）: ' + data.length);
  Logger.log('列数: ' + data[0].length);
  Logger.log('ヘッダー: ' + JSON.stringify(data[0]));

  if (data.length < 2) {
    Logger.log('⚠ データが1件もありません');
    return;
  }

  // 直近5件を表示
  const preview = data.slice(1, 6);
  preview.forEach(function(row, i) {
    Logger.log('--- 問題[' + (i + 1) + '] ---');
    Logger.log('  日付: ' + row[0]);
    Logger.log('  出題区分: ' + row[1]);
    Logger.log('  問題文: ' + String(row[2]).slice(0, 50));
    Logger.log('  選択肢1: ' + row[3]);
    Logger.log('  選択肢2: ' + row[4]);
    Logger.log('  選択肢3: ' + row[5]);
    Logger.log('  選択肢4: ' + row[6]);
    Logger.log('  正解番号: ' + row[7]);
    Logger.log('  解説: ' + String(row[8]).slice(0, 50));
  });

  // createQuizObj の動作確認
  const testObj = createQuizObj(data[1]);
  Logger.log('--- createQuizObj 動作確認 ---');
  Logger.log('  text: ' + testObj.text);
  Logger.log('  options: ' + JSON.stringify(testObj.options));
  Logger.log('  correctAnswer: ' + testObj.correctAnswer);
  Logger.log('  explanation: ' + testObj.explanation);

  const hasUndefined = Object.values(testObj).some(v => v === undefined || String(v) === 'undefined');
  Logger.log(hasUndefined ? '⚠ undefined が含まれています！列ズレを確認してください' : '✓ undefined なし');
}

/**
 * 特定社員の「今日のクイズ取得」をテストする
 * 引数なしで実行するとテストアカウントを使用
 */
function test_getTodayQuiz() {
  const TEST_EMPLOYEE_ID = 'admin'; // 必要に応じて変更
  Logger.log('===== getTodayQuiz テスト =====');
  Logger.log('社員ID: ' + TEST_EMPLOYEE_ID);

  const result = apiGetTodayQuiz(TEST_EMPLOYEE_ID);
  Logger.log('success: ' + result.success);

  if (!result.success) {
    Logger.log('status: ' + result.status);
    Logger.log('message: ' + result.message);
    return;
  }

  const d = result.data;
  Logger.log('targetDate: ' + d.targetDate);
  Logger.log('isFriday: ' + d.isFriday);
  Logger.log('isCatchup: ' + d.isCatchup);
  Logger.log('isAdvance: ' + d.isAdvance);
  Logger.log('問題数: ' + d.quizzes.length);

  if (d.quizzes.length > 0) {
    const q = d.quizzes[0];
    Logger.log('--- 問題[0] ---');
    Logger.log('  text: ' + String(q.text).slice(0, 60));
    Logger.log('  options: ' + JSON.stringify(q.options));
    Logger.log('  correctAnswer: ' + q.correctAnswer);
    const hasUndefined = [q.text, ...q.options, q.correctAnswer].some(v => String(v) === 'undefined');
    Logger.log(hasUndefined ? '⚠ undefined あり！列ズレを確認してください' : '✓ undefined なし');
  }
}

/**
 * ランキング取得をテストする
 * weekly / monthly / total / monthlyTest の全期間を確認
 */
function test_leaderboard() {
  Logger.log('===== ランキングテスト =====');

  const periods = ['weekly', 'monthly', 'total'];
  periods.forEach(function(period) {
    const result = apiGetLeaderboard(period, null);
    Logger.log('--- period: ' + period + ' ---');
    Logger.log('  success: ' + result.success);
    if (result.success) {
      const list = Array.isArray(result.data) ? result.data : [];
      Logger.log('  件数: ' + list.length);
      if (list.length > 0) Logger.log('  1位: ' + JSON.stringify(list[0]));
    } else {
      Logger.log('  エラー: ' + result.message);
    }
  });

  // monthlyTest
  const today = formatDate(new Date());
  const targetMonth = today.slice(0, 7).replace('/', '-'); // "2026-03" 形式
  const monthlyResult = apiGetLeaderboard('monthlyTest', targetMonth);
  Logger.log('--- period: monthlyTest (' + targetMonth + ') ---');
  Logger.log('  success: ' + monthlyResult.success);
  if (monthlyResult.success) {
    const list = Array.isArray(monthlyResult.data) ? monthlyResult.data : [];
    Logger.log('  件数: ' + list.length);
    if (list.length > 0) Logger.log('  1位: ' + JSON.stringify(list[0]));
  } else {
    Logger.log('  エラー: ' + monthlyResult.message);
  }
}

/**
 * 社員名簿の内容を確認する
 */
function test_members() {
  const ss = SpreadsheetApp.openById(DB_SPREADSHEET_ID);
  const sheet = getSheetOrThrow(ss, SHEET_MEMBERS);
  const data = sheet.getDataRange().getValues();

  Logger.log('===== 社員名簿確認 =====');
  Logger.log('総行数（ヘッダー含む）: ' + data.length);
  Logger.log('ヘッダー: ' + JSON.stringify(data[0]));

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    Logger.log('[' + i + '] ID=' + row[0] + ' 氏名=' + row[1] + ' 最終回答日=' + row[3] + ' 累計スコア=' + row[4]);
  }
}

/**
 * 回答ログの直近20件を確認する
 */
function test_recentLogs() {
  const ss = SpreadsheetApp.openById(DB_SPREADSHEET_ID);
  const sheet = getSheetOrThrow(ss, SHEET_LOG_DAILY);
  const data = sheet.getDataRange().getValues();

  Logger.log('===== 回答ログ（直近20件） =====');
  Logger.log('総行数（ヘッダー含む）: ' + data.length);
  Logger.log('ヘッダー: ' + JSON.stringify(data[0]));

  const start = Math.max(1, data.length - 20);
  for (let i = start; i < data.length; i++) {
    const row = data[i];
    Logger.log('[' + i + '] 社員ID=' + row[1] + ' 対象日=' + row[2] + ' 得点=' + row[3] + '/' + row[4] + ' 所要時間=' + row[6] + 's');
  }
}

/**
 * 全テストをまとめて実行する
 */
function test_all() {
  test_quizData();
  test_members();
  test_recentLogs();
  test_getTodayQuiz();
  test_leaderboard();
  Logger.log('===== test_all 完了 =====');
}
