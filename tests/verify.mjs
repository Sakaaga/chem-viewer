// 拡張機能の主要な動作（名前検索・SMILES検索・履歴保存）を、実際のChromiumに拡張機能を読み込んだ状態で確認する。
// PubChemの実サーバーに問い合わせるため、実行時にはインターネット接続が必要。
//
// 実行方法（リポジトリ直下から）:
//   node build.mjs                       # dist/chrome を作る
//   cd tests && npm ci
//   npx playwright install chromium      # 初回のみ（ブラウザ本体をダウンロード）
//   npm run check
import { chromium } from "playwright";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(__dirname, "..", "dist", "chrome");

async function getExtensionId(context) {
  let background = context.serviceWorkers()[0];
  if (!background) {
    background = await context.waitForEvent("serviceworker", { timeout: 10000 });
  }
  return background.url().split("/")[2];
}

async function run() {
  const context = await chromium.launchPersistentContext("", {
    headless: false, // 拡張機能の読み込みにはヘッドフルモードが必要
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  try {
    const extensionId = await getExtensionId(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup.html`);

    // 1. 化合物名での検索
    await page.fill("#query-input", "aspirin");
    await page.click("#search-btn");
    await page.waitForSelector("#result", { state: "visible", timeout: 15000 });
    const formula = (await page.textContent("#r-formula")).trim();
    assert.equal(formula, "C9H8O4", `分子式が一致しません: ${formula}`);
    console.log("OK: 化合物名検索 (aspirin -> C9H8O4)");

    // 2. 検索履歴に反映されているか
    const historyText = await page.textContent("#history-list");
    assert.ok(historyText.includes("aspirin"), "履歴にaspirinが見当たりません");
    console.log("OK: 検索履歴への保存");

    // 3. SMILES記法での検索
    await page.check("#smiles-toggle");
    await page.fill("#query-input", "CCO");
    await page.click("#search-btn");
    await page.waitForFunction(
      () => document.querySelector("#r-formula")?.textContent?.trim() === "C2H6O",
      { timeout: 15000 }
    );
    console.log("OK: SMILES検索 (CCO -> C2H6O)");

    console.log("\nすべての確認が完了しました。");
  } finally {
    await context.close();
  }
}

run().catch((err) => {
  console.error("NG:", err.message);
  process.exit(1);
});
