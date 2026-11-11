import { test as base, expect, type Browser, type Page } from "@playwright/test";

/**
 * ロール別ログイン fixture。
 *
 * 資格情報は e2e/.env.e2e（.env.e2e.example 参照）から読む。
 * 未設定のロールで該当 fixture を使うテストは test.skip() で自動スキップする
 * （「用意されていないロールのテストが false negative で落ちる」事故を防ぐ）。
 *
 * 重要: adminPage / centerPage / vendorPage はそれぞれ専用の BrowserContext を
 * 生成する（共有の `page` fixture には依存しない）。1つのテストで複数ロールを
 * 同時に使う場合（例: admin と center の表示差を比較）、同じ page/context を
 * 使い回すと2つ目のログインが「既にログイン済みなので /login → / へ即リダイレクト」
 * となり、ログインフォームが見つからずタイムアウトする。ロールごとに独立した
 * BrowserContext を使うことで、実際のブラウザで別ユーザーが同時に操作している
 * 状況を正しく再現する。
 */

export type Role = "admin" | "center" | "vendor";

const CREDENTIALS: Record<Role, { email?: string; password?: string }> = {
  admin: {
    email: process.env.E2E_ADMIN_EMAIL,
    password: process.env.E2E_ADMIN_PASSWORD,
  },
  center: {
    email: process.env.E2E_CENTER_EMAIL,
    password: process.env.E2E_CENTER_PASSWORD,
  },
  vendor: {
    email: process.env.E2E_VENDOR_EMAIL,
    password: process.env.E2E_VENDOR_PASSWORD,
  },
};

export function hasCredentials(role: Role): boolean {
  const c = CREDENTIALS[role];
  return Boolean(c.email && c.password);
}

export async function loginAs(page: Page, role: Role): Promise<void> {
  const { email, password } = CREDENTIALS[role];
  if (!email || !password) {
    throw new Error(
      `E2E_${role.toUpperCase()}_EMAIL / PASSWORD が設定されていません（e2e/.env.e2e）`,
    );
  }

  await page.goto("/login");
  await page.getByLabel("メールアドレス").fill(email);
  await page.getByLabel("パスワード").fill(password);
  await page.getByRole("button", { name: "ログイン" }).click();

  // ログイン成功後はホームへリダイレクトされる想定。
  // 失敗時はエラーメッセージ付きで /login に留まるため、ここで確実に検知する。
  await page.waitForURL((url) => url.pathname !== "/login", {
    timeout: 15_000,
  });
}

async function newRolePage(
  browser: Browser,
  role: Role,
  use: (page: Page) => Promise<void>,
  skip: (condition: boolean, message: string) => void,
): Promise<void> {
  if (!hasCredentials(role)) {
    skip(true, `E2E_${role.toUpperCase()}_EMAIL/PASSWORD 未設定のためスキップ`);
    return;
  }
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await loginAs(page, role);
    await use(page);
  } finally {
    await context.close();
  }
}

type Fixtures = {
  adminPage: Page;
  centerPage: Page;
  vendorPage: Page;
};

export const test = base.extend<Fixtures>({
  adminPage: async ({ browser }, use, testInfo) => {
    await newRolePage(browser, "admin", use, testInfo.skip.bind(testInfo));
  },
  centerPage: async ({ browser }, use, testInfo) => {
    await newRolePage(browser, "center", use, testInfo.skip.bind(testInfo));
  },
  vendorPage: async ({ browser }, use, testInfo) => {
    await newRolePage(browser, "vendor", use, testInfo.skip.bind(testInfo));
  },
});

export { expect };
