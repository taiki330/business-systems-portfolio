import { test, expect } from "./fixtures/auth";
import {
  countSearchableOptions,
  pickSearchable,
  pickSearchableIndex,
  pickSearchableValue,
  searchableValue,
} from "./helpers";

/**
 * 予定数量超過の警告表示（Phase 3-7）。
 * E2E_VENDOR_SITE_NAME で指定された、vendor が担当している現場を使う
 * （vendor アカウントが依頼作成可能な現場でなければ /requests/new が拒否するため）。
 */

test.describe("予定数量超過の確認画面", () => {
  const vendorSite = process.env.E2E_VENDOR_SITE_NAME;

  test("予定数量を大きく超える依頼を作成すると /plans/over に警告表示される", async ({
    adminPage,
    vendorPage,
  }) => {
    test.skip(!vendorSite, "E2E_VENDOR_SITE_NAME 未設定のためスキップ");

    // 0) admin: 対象現場・商品を決める（毎回同じ現場×商品を使うため、再実行に備えて
    //    既存の予定数量があれば先に削除しておく。site_product_plans は
    //    (site_id, product_id) に unique 制約があるため、削除せず再作成しようとすると
    //    「既に登録されているデータと重複しています。」で失敗する）。
    await adminPage.goto("/plans/new");
    const siteInput = adminPage.getByLabel("現場");
    await siteInput.click();
    const siteOptions = await adminPage
      .locator('ul[role="listbox"] [role="option"]')
      .allTextContents();
    const siteLabel = siteOptions.find((o) => o.includes(vendorSite!));
    test.skip(
      !siteLabel,
      `現場 "${vendorSite}" が予定数量登録の現場候補に見つからないためスキップ`,
    );
    await pickSearchable(siteInput, siteLabel!);
    const siteId = await searchableValue(adminPage, "site_id").inputValue();

    const productInput = adminPage.getByLabel("商品");
    const productOptionCount = await countSearchableOptions(productInput);
    test.skip(productOptionCount < 1, "商品マスタが空のためスキップ");
    await pickSearchableIndex(productInput, 0);
    const productLabel = (await productInput.inputValue()).trim();
    // /plans/new と /requests/new は商品の表示形式が異なる
    // （"CODE NAME" と "CODE — NAME"）ため、表示名ではなく
    // 候補の data-value（商品 id、両ページ共通）で選択する。
    const productId = await searchableValue(adminPage, "product_id").inputValue();

    // 既存の予定数量（同一現場×商品）があれば削除してから作り直す
    await adminPage.goto(`/plans?site_id=${siteId}`);
    const existingRow = adminPage.getByRole("row", { name: new RegExp(productLabel) });
    if ((await existingRow.count()) > 0) {
      adminPage.once("dialog", (dialog) => dialog.accept());
      await existingRow.getByRole("button", { name: "削除" }).click();
      await adminPage.waitForURL(/\/plans\?ok=deleted/);
    }

    // 1) admin: 対象現場・商品に小さい予定数量を登録する
    await adminPage.goto("/plans/new");
    await pickSearchableValue(adminPage.getByLabel("現場"), siteId);
    await pickSearchableValue(adminPage.getByLabel("商品"), productId);
    await adminPage.getByLabel("予定数量").fill("1");
    await adminPage.getByRole("button", { name: "登録" }).click();
    await adminPage.waitForURL(/\/plans\?ok=created/);

    // 2) vendor: 同じ現場・商品に予定を大きく超える依頼を作成する
    await vendorPage.goto("/requests/new");
    const vSiteInput = vendorPage.getByLabel("現場");
    await vSiteInput.click();
    const vSiteOptions = await vendorPage
      .locator('ul[role="listbox"] [role="option"]')
      .allTextContents();
    const vSiteLabel = vSiteOptions.find((o) => o.includes(vendorSite!));
    test.skip(
      !vSiteLabel,
      `現場 "${vendorSite}" が出庫依頼の現場候補に見つからないためスキップ（vendor 未担当の可能性）`,
    );
    await pickSearchable(vSiteInput, vSiteLabel!);
    await vendorPage.waitForLoadState("networkidle");

    await pickSearchableValue(vendorPage.getByLabel("商品"), productId);
    await vendorPage.getByLabel("数量").fill("999");
    await vendorPage.getByRole("button", { name: "登録" }).click();
    await vendorPage.waitForURL(/\/requests(\/|$)/);

    // 3) admin: /plans と /plans/over で超過が確認できる
    await adminPage.goto("/plans");
    await expect(
      adminPage.getByText(/予定数量を超過している現場×商品が \d+ 件あります。/),
    ).toBeVisible();

    await adminPage.goto("/plans/over");
    await expect(
      adminPage.getByRole("heading", { name: "予定数量超過の確認" }),
    ).toBeVisible();
    const overRow = adminPage.getByRole("row", { name: new RegExp(productLabel) });
    await expect(overRow).toBeVisible();
    await expect(overRow.getByText(/^\+\d+/)).toBeVisible(); // 超過数量バッジ
  });
});
