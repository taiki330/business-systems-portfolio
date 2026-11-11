import type { Locator, Page } from "@playwright/test";

/** テスト実行のたびに一意な名前を作る（重複制約や識別を避けるため）。 */
export function uniqueName(prefix: string): string {
  const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  return `${prefix}_${stamp}`;
}

/** 今日の日付を yyyy-mm-dd で返す（date input への入力用）。 */
export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * /forbidden または /no-access へ遷移したか（アクセス拒否されたか）を判定する。
 * access-rules.ts の evaluatePathAccess は forbidden → redirect('/forbidden')。
 */
export function isForbiddenUrl(page: Page): boolean {
  const path = new URL(page.url()).pathname;
  return path === "/forbidden" || path === "/no-access";
}

/**
 * 検索付き選択欄（SearchableSelect）から候補を選ぶ。
 *
 * 素の <select> ではなく「入力して候補から選ぶ」入力欄のため、
 * selectOption は使えない。候補リストは role="listbox" の中の role="option"。
 */
export async function pickSearchable(
  input: Locator,
  optionText: string,
): Promise<void> {
  await input.click();
  await input.fill(optionText);
  await input
    .page()
    .locator('ul[role="listbox"] [role="option"]', { hasText: optionText })
    .first()
    .click();
}

/**
 * 候補リストの n 番目を選ぶ（名前が分からない場合に使う）。
 * 「指定なし」を許す選択欄では 0 番目がそれになるため、実データは 1 番目から。
 */
export async function pickSearchableIndex(
  input: Locator,
  index: number,
): Promise<void> {
  await input.click();
  await input
    .page()
    .locator('ul[role="listbox"] [role="option"]')
    .nth(index)
    .click();
}

/** 検索付き選択欄に出ている候補の件数を返す（開いた状態にしてから数える）。 */
export async function countSearchableOptions(input: Locator): Promise<number> {
  await input.click();
  return input.page().locator('ul[role="listbox"] [role="option"]').count();
}

/** 検索付き選択欄の候補を「値」で選ぶ（表示名が画面ごとに異なる場合に使う）。 */
export async function pickSearchableValue(
  input: Locator,
  value: string,
): Promise<void> {
  await input.click();
  await input
    .page()
    .locator(`ul[role="listbox"] [role="option"][data-value="${value}"]`)
    .click();
}

/** 検索付き選択欄が実際にフォームへ送る値（hidden input）を返す。 */
export function searchableValue(scope: Page | Locator, name: string): Locator {
  return scope.locator(`input[type="hidden"][name="${name}"]`);
}
