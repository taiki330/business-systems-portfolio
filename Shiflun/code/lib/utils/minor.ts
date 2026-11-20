/**
 * 18歳未満の夜間規制（労働基準法第61条）：午後10時から翌午前5時の間は働かせられない。
 * DBでも同じ規則で止めている（migration 026 の violates_minor_night_rule）。画面側では先に警告を出すために使う。
 *
 * 勤務は同日内（終了 > 開始）。終了が22:00を過ぎるか、開始が5:00より前なら、深夜の時間にかかる。
 * ちょうど22:00に終わる・ちょうど5:00に始まるのは問題ない。
 */
export const MINOR_NIGHT_START = "22:00";
export const MINOR_NIGHT_END = "05:00";

/** "HH:MM"（または "HH:MM:SS"）の勤務時間が、18歳未満には働かせられない時間にかかるか。 */
export function violatesMinorNightRule(start: string | null | undefined, end: string | null | undefined): boolean {
  if (!start || !end) return false;
  return end.slice(0, 5) > MINOR_NIGHT_START || start.slice(0, 5) < MINOR_NIGHT_END;
}

export const MINOR_NIGHT_NOTICE = "18歳未満の方は、午後10時から翌午前5時の間は働けません（労働基準法）。";
export const MINOR_NIGHT_SCOUT_ERROR = "18歳未満のワーカーには、午後10時から翌午前5時にかかる勤務はお願いできません。終了を22:00までにするか、開始を5:00以降にしてください。";
export const MINOR_NIGHT_SLOT_ERROR = "18歳未満の方は、午後10時から翌午前5時にかかる時間は登録できません。終了を22:00まで、開始を5:00以降にしてください。";
