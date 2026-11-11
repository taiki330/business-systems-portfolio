import { test, expect } from "./fixtures/auth";
import { countSearchableOptions, pickSearchable, pickSearchableIndex, todayISO, uniqueName } from "./helpers";
import type { Page } from "@playwright/test";

/**
 * operation_id の二重送信対策（コードレビュー指摘 Critical #8）の E2E 確認。
 *
 * UI 側は SubmitButton（useFormStatus）で送信中はボタンを disabled にし、
 * 各フォームは描画時に1回だけ生成した operation_id を隠しフィールドに持つ。
 * サーバー側は同一 operation_id・同一操作者・同一対象の再送を lease_operations で
 * 検出し二重処理しない。
 *
 * このテストは「素早い二重クリックをしても受入数量が1回分しか増えない」という
 * エンドツーエンドの結果を検証する。UI のボタン無効化・サーバー側の operation_id
 * 重複検出のどちらが実際に効いたかまでは切り分けないが、利用者から見える
 * 最終的な保証（二重処理されないこと）を確認する。
 */

async function createApprovedBatch(adminPage: Page): Promise<string> {
  const companyName = uniqueName("E2E二重送信会社");
  await adminPage.goto("/leases/companies/new");
  await adminPage.getByLabel("リース会社名").fill(companyName);
  await adminPage.getByRole("button", { name: "登録" }).click();
  await adminPage.waitForURL("**/leases/companies");

  await adminPage.goto("/leases/batches/new");
  await pickSearchable(adminPage.getByLabel("リース会社"), companyName);
  await adminPage.getByLabel("借用日").fill(todayISO());

  const productInput = adminPage.locator("#item_product_id_0");
  const productOptionCount = await countSearchableOptions(productInput);
  test.skip(productOptionCount <= 1, "商品マスタが空のためスキップ");
  await pickSearchableIndex(productInput, 1);
  await adminPage.locator("#item_quantity_0").fill("10");

  await adminPage.getByRole("button", { name: "登録" }).click();
  await adminPage.waitForURL(/\/leases\/batches\/[0-9a-f-]+\?ok=created/);
  const batchUrl = adminPage.url().split("?")[0];

  await adminPage.getByRole("button", { name: "承認する" }).click();
  await adminPage.waitForURL(/\?ok=approved/);

  return batchUrl;
}

test.describe("operation_id の二重送信対策", () => {
  test("受入フォームを素早く二重クリックしても受入数量は1回分のみ増える", async ({
    adminPage: page,
  }) => {
    const batchUrl = await createApprovedBatch(page);

    await page.goto(batchUrl);
    const receiveForm = page.locator('form:has-text("受入（残り")');
    await receiveForm.locator('input[name="quantity"]').fill("3");

    const button = receiveForm.getByRole("button", { name: "受入確定" });

    // ほぼ同時に2回クリックを試みる（UI 側の disabled 化 or サーバー側の
    // operation_id 重複検出のいずれかで二重処理が防止されるはず）。
    await Promise.all([
      button.click({ trial: false }).catch(() => {}),
      button.click({ trial: false }).catch(() => {}),
    ]);

    await page.waitForURL(/\?ok=received/, { timeout: 15_000 });
    // dt/dd 構造の「受入済み」欄の数値が 3 のままであること（6 になっていないこと）
    const receivedDd = page
      .locator("dt", { hasText: "受入済み" })
      .locator("xpath=following-sibling::dd[1]");
    await expect(receivedDd).toContainText("3");
    await expect(receivedDd).not.toContainText("6");
  });

  test("同じフォームを2回リロードして送信すると、operation_id が異なるため両方処理される（対照実験）", async ({
    adminPage: page,
  }) => {
    const batchUrl = await createApprovedBatch(page);

    await page.goto(batchUrl);
    let receiveForm = page.locator('form:has-text("受入（残り")');
    await receiveForm.locator('input[name="quantity"]').fill("2");
    await receiveForm.getByRole("button", { name: "受入確定" }).click();
    await page.waitForURL(/\?ok=received/);

    // ページを再読み込み（= 新しい operation_id が生成される）して、もう一度受入
    await page.reload();
    receiveForm = page.locator('form:has-text("受入（残り")');
    await receiveForm.locator('input[name="quantity"]').fill("2");
    await receiveForm.getByRole("button", { name: "受入確定" }).click();
    await page.waitForURL(/\?ok=received/);

    const receivedDd = page
      .locator("dt", { hasText: "受入済み" })
      .locator("xpath=following-sibling::dd[1]");
    // 2回とも別 operation_id のため、それぞれ正しく加算され合計4になる
    // （= operation_id が異なれば正しく個別の操作として処理されることの対照確認）
    await expect(receivedDd).toContainText("4");
  });
});
