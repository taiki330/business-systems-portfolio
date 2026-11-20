/** 初期対象業界（Phase 2: 飲食業のみ。他業界展開は将来想定） */
export const TARGET_INDUSTRY = "飲食業" as const;

/**
 * 飲食業態（ワーカー・店舗の業態セレクト用）
 * 居酒屋 / カフェ / 焼肉 / ラーメン / ファストフード / その他
 */
export const BUSINESS_TYPES = [
  "居酒屋",
  "カフェ",
  "焼肉",
  "ラーメン",
  "ファストフード",
  "その他",
] as const;

/** スキルタグ（複数選択可） */
export const SKILL_TAGS = [
  "ホール",
  "キッチン",
  "レジ",
  "ドリンク",
  "ハンディ操作",
  "接客",
  "洗い場",
] as const;

export type BusinessType = (typeof BUSINESS_TYPES)[number];
export type SkillTag = (typeof SKILL_TAGS)[number];
