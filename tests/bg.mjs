// background.js（ポップアップを開く問い合わせ受付・更新時の再登録）の検証。
// Service Worker相当の環境で実行する。
import assert from "node:assert/strict";
import { bootBackground, fakePubChem } from "./harness.mjs";

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  OK  ${name}`); } catch (e) { failed++; console.log(`  NG  ${name}\n      ${e.message}`); }
}
console.log("\n[background.js: ページ内ハイライトのクリックからの問い合わせ]");

await test("Service Worker相当の環境（windowなし）で起動でき、依存ファイルが読み込まれる", () => {
  const bg = bootBackground({ fetchImpl: fakePubChem() });
  assert.equal(typeof bg.listeners.message, "function");
  assert.equal(typeof bg.ctx.ChemAPI?.resolveCompound, "function");
  assert.equal(typeof bg.ctx.ChemFormula?.parse, "function");
  assert.equal(typeof bg.ctx.ChemHighlight?.sync, "function");
});

await test("妥当な化学式なら、選択検索と同じ経路（pendingQuery保存＋ポップアップを開こうとする）で受理する", async () => {
  const bg = bootBackground({ fetchImpl: fakePubChem() });
  const res = await bg.message({ type: "chemviewer:analyze", formula: "H2O" });
  assert.equal(res.accepted, true);
  assert.equal(typeof res.opened, "boolean");
  const pending = (await bg.ctx.browser.storage.session.get("pendingQuery")).pendingQuery;
  assert.equal(pending.text, "H2O");
});

await test("化学式として不正な文字列は、通信も保存もせずに拒否する（任意の文字列を第三者へ送らない）", async () => {
  const f = fakePubChem();
  const bg = bootBackground({ fetchImpl: f });
  for (const bad of ["aspirin", "'; DROP TABLE", "A".repeat(100), "H2O\n私のメモ", "", null, 123, { x: 1 }]) {
    const res = await bg.message({ type: "chemviewer:analyze", formula: bad });
    assert.equal(res.accepted, false, `${JSON.stringify(bad)} が受理されました`);
  }
  assert.equal(f.calls.length, 0, "通信が発生しました");
  assert.equal((await bg.ctx.browser.storage.session.get("pendingQuery")).pendingQuery, undefined);
});

await test("設定のON/OFFに関わらず受理する（開いた後のポップアップ側がOFFなら案内するため、ここでは拒否しない）", async () => {
  const bg = bootBackground({ fetchImpl: fakePubChem(), settings: { autoHighlight: false } });
  const res = await bg.message({ type: "chemviewer:analyze", formula: "H2O" });
  assert.equal(res.accepted, true);
});

await test("他の拡張機能（sender.id不一致）や無関係なメッセージには応答しない", async () => {
  const bg = bootBackground({ fetchImpl: fakePubChem() });
  assert.equal(bg.message({ type: "chemviewer:analyze", formula: "H2O" }, "other-ext"), undefined);
  assert.equal(bg.message({ type: "something-else", formula: "H2O" }), undefined);
  assert.equal(bg.message(null), undefined);
});

await test("更新時の再登録: ON＋権限ありなら最新の定義（pubchem.jsなし）で登録し直す", async () => {
  const bg = bootBackground({ fetchImpl: fakePubChem() });
  bg.registered.push({ id: "chemviewer-highlight", js: ["libs/browser-polyfill.min.js", "formula.js", "pubchem.js", "content.js"] }); // 旧バージョンの定義
  await bg.listeners.installed();
  assert.equal(bg.registered.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(bg.registered[0].js)), ["libs/browser-polyfill.min.js", "formula.js", "content.js"]);
});

await test("設定がOFFなら、更新時に勝手に登録しない", async () => {
  const bg = bootBackground({ fetchImpl: fakePubChem(), settings: { autoHighlight: false } });
  await bg.listeners.installed();
  assert.equal(bg.registered.length, 0);
});

console.log(`\n結果: ${passed} 件成功 / ${failed} 件失敗`);
process.exit(failed ? 1 : 0);
