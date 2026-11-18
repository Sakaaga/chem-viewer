// popup.html + app.js を jsdom 上で実際に動かし、画面の挙動（反応式・一般名・モル計算・3D操作・キャッシュ・異性体候補）を検証する。
// 通信は偽のfetch、3Dmol.jsは記録用の偽物。   node app.mjs
import { JSDOM } from "jsdom";
import assert from "node:assert/strict";
import { read, json, PROPS } from "./harness.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (cond()) return true;
    await sleep(40);
  }
  throw new Error("waitFor: 条件が満たされませんでした");
}

function fakeFetch(calls, { title = "Water", iupac = "oxidane", formulaCids = null } = {}) {
  return async (url) => {
    calls.push(url);
    if (url.includes("/name/")) return formulaCids ? json(404, {}) : json(200, { IdentifierList: { CID: [962] } });
    if (url.includes("/fastformula/")) return json(200, { IdentifierList: { CID: formulaCids || [] } });
    if (url.includes("/property/Title/")) {
      return json(200, { PropertyTable: { Properties: (formulaCids || []).map((c, i) => ({ CID: c, Title: ["Glucose", "Fructose", "Galactose"][i] })) } });
    }
    if (url.includes("/property/")) {
      const base = PROPS(formulaCids ? formulaCids[0] : 962);
      Object.assign(base.PropertyTable.Properties[0], { Title: title, IUPACName: iupac, MolecularWeight: "18.015" });
      return json(200, base);
    }
    if (url.includes("/SDF")) return { status: 200, ok: true, text: async () => "sdf-data", json: async () => ({}) };
    return json(404, {});
  };
}

async function openPopup({ settings, fetchOpts } = {}) {
  const dom = new JSDOM(read("popup.html"), { runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  const calls = [];
  const store = settings ? { settings } : {};
  const session = {};
  const viewers = [];
  const downloads = [];
  w.fetch = fakeFetch(calls, fetchOpts);
  w.browser = {
    storage: {
      local: { get: async (k) => ({ [k]: store[k] }), set: async (o) => Object.assign(store, o) },
      session: { get: async (k) => ({ [k]: session[k] }), set: async (o) => Object.assign(session, o), remove: async (k) => { delete session[k]; } },
      onChanged: { addListener() {} },
    },
    runtime: { openOptionsPage() {} },
    action: { setBadgeText: async () => {} },
    i18n: { getMessage: (k) => k, getUILanguage: () => "ja" },
    extension: { inIncognitoContext: false },
  };
  w.$3Dmol = {
    createViewer: () => {
      const v = {
        calls: [], spin: [],
        setStyle(...a) { this.calls.push(["setStyle", ...a]); },
        addModel() {}, zoomTo() {}, render() {},
        removeAllLabels() { this.calls.push(["removeAllLabels"]); },
        addPropertyLabels(...a) { this.calls.push(["addPropertyLabels", ...a]); },
        spinCalls: [],
        pngURI: () => "data:image/png;base64,AAAA",
      };
      v.spin = (x) => v.spinCalls.push(x);
      viewers.push(v);
      return v;
    },
  };
  w.URL.createObjectURL = () => "blob:fake";
  w.URL.revokeObjectURL = () => {};
  w.HTMLAnchorElement.prototype.click = function () { downloads.push(this.download); };
  for (const f of ["formula.js", "pubchem.js", "i18n.js", "app.js"]) w.eval(read(f));
  const $ = (id) => w.document.getElementById(id);
  const search = async (q, { smiles = false } = {}) => {
    $("query-input").value = q;
    $("smiles-toggle").checked = smiles;
    $("search-btn").click();
  };
  const input = (el, value) => { el.value = value; el.dispatchEvent(new w.Event("input", { bubbles: true })); };
  const change = (el, value) => { el.value = value; el.dispatchEvent(new w.Event("change", { bubbles: true })); };
  return { w, $, calls, store, session, viewers, downloads, search, input, change, close: () => w.close() };
}

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  OK  ${name}`); } catch (e) { failed++; console.log(`  NG  ${name}\n      ${e.message}`); }
}
const shown = (el) => el.style.display !== "none";

console.log("\n[popup: 反応式]");
await test("釣り合う反応式は、通信せずに判定結果を表示する", async () => {
  const p = await openPopup();
  await p.search("2H2 + O2 -> 2H2O");
  await waitFor(() => shown(p.$("reaction-result")));
  assert.equal(p.$("reaction-verdict").textContent, "reactionBalanced");
  assert.equal(p.$("reaction-verdict").className, "reaction-ok");
  assert.equal(p.calls.length, 0, "通信が発生しました");
  assert.equal(shown(p.$("result")), false);
  assert.equal(p.$("search-btn").disabled, false);
  p.close();
});
await test("釣り合わない式は、元素ごとの左右の数と✗を表示する。通常の検索に切り替えると消える", async () => {
  const p = await openPopup();
  await p.search("H2 + O2 -> H2O");
  await waitFor(() => shown(p.$("reaction-result")));
  assert.equal(p.$("reaction-verdict").className, "reaction-ng");
  const rows = [...p.$("reaction-rows").children].map((r) => r.textContent);
  assert.ok(rows.some((t) => t.startsWith("O21") && t.includes("\u2717")), rows.join("|"));
  assert.ok(rows.some((t) => t.startsWith("H22") && t.includes("\u2713")), rows.join("|"));
  await p.search("water");
  await waitFor(() => shown(p.$("result")));
  assert.equal(shown(p.$("reaction-result")), false);
  p.close();
});
await test("SMILESモードでは反応式として扱わない（C=C など）", async () => {
  const p = await openPopup();
  await p.search("C=C + C", { smiles: true });
  await sleep(300);
  assert.equal(shown(p.$("reaction-result")), false);
  p.close();
});

console.log("\n[popup: 一般名・IUPAC名・モル計算・キャッシュ]");
await test("名前は一般名（Water）、IUPAC名（oxidane）は別の行に出す。同じ名前なら出さない", async () => {
  const p = await openPopup();
  await p.search("water");
  await waitFor(() => shown(p.$("result")));
  assert.equal(p.$("r-name").textContent, "Water");
  assert.equal(p.$("r-iupac").textContent, "oxidane");
  assert.equal(shown(p.$("r-iupac-row")) && p.$("r-iupac-row").style.display !== "none", true);
  p.close();
  const q = await openPopup({ fetchOpts: { title: "Ethanol", iupac: "ethanol" } });
  await q.search("ethanol");
  await waitFor(() => shown(q.$("result")));
  assert.equal(q.$("r-iupac-row").style.display, "none");
  q.close();
});
await test("モル計算は双方向: g→mol と mol→g（分子量 18.015）", async () => {
  const p = await openPopup();
  await p.search("water");
  await waitFor(() => shown(p.$("result")));
  p.input(p.$("molar-mass-input"), "36.03");
  assert.equal(p.$("molar-mol-input").value, "2");
  p.input(p.$("molar-mol-input"), "2");
  assert.equal(p.$("molar-mass-input").value, "36.03");
  p.input(p.$("molar-mass-input"), "");
  assert.equal(p.$("molar-mol-input").value, "", "入力を消したらもう一方も消える");
  p.close();
});
await test("同じ検索をもう一度すると、通信せずキャッシュから表示し、その旨を出す", async () => {
  const p = await openPopup();
  await p.search("water");
  await waitFor(() => shown(p.$("result")));
  const first = p.calls.length;
  assert.ok(first > 0);
  assert.ok(p.session.resultCache, "キャッシュが保存されていません");
  assert.equal(JSON.stringify(p.store).includes("sdf-data"), false, "永続ストレージに構造データが入っています");
  p.$("result").style.display = "none";
  await p.search("water");
  await waitFor(() => shown(p.$("result")));
  assert.equal(p.calls.length, first, "キャッシュがあるのに再通信しました");
  assert.ok(p.$("status").textContent.includes("statusFromCache"));
  p.close();
});
await test("キャッシュOFFの設定なら、毎回検索し、何も保存しない", async () => {
  const p = await openPopup({ settings: { cacheEnabled: false } });
  await p.search("water");
  await waitFor(() => shown(p.$("result")));
  const first = p.calls.length;
  p.$("result").style.display = "none";
  await p.search("water");
  await waitFor(() => shown(p.$("result")) && p.calls.length > first);
  assert.equal(p.session.resultCache, undefined);
  p.close();
});
await test("履歴の「消去」でキャッシュも消える", async () => {
  const p = await openPopup();
  await p.search("water");
  await waitFor(() => shown(p.$("result")));
  assert.ok(p.session.resultCache);
  p.$("history-clear").click();
  await waitFor(() => p.session.resultCache === undefined);
  p.close();
});

console.log("\n[popup: 3D表示の操作]");
await test("表示スタイルを切り替えると反映され、設定にも保存される", async () => {
  const p = await openPopup();
  await p.search("water");
  await waitFor(() => shown(p.$("result")) && p.viewers.length === 1);
  p.change(p.$("style-select"), "sphere");
  const v = p.viewers[0];
  const lastStyle = [...v.calls].reverse().find((c) => c[0] === "setStyle");
  assert.deepEqual(JSON.parse(JSON.stringify(lastStyle.slice(1))), [{}, { sphere: {} }]);
  await waitFor(() => p.store.settings?.viewerStyle === "sphere");
  p.close();
});
await test("保存済みのスタイルで開く", async () => {
  const p = await openPopup({ settings: { viewerStyle: "line" } });
  await waitFor(() => p.$("style-select").value === "line");
  await p.search("water");
  await waitFor(() => p.viewers.length === 1);
  const first = p.viewers[0].calls.find((c) => c[0] === "setStyle");
  assert.deepEqual(JSON.parse(JSON.stringify(first.slice(1))), [{}, { line: {} }]);
  p.close();
});
await test("自動回転と元素ラベルを切り替えられる。新しい結果を出すと、古いビューアの回転を止める", async () => {
  const p = await openPopup();
  await p.search("water");
  await waitFor(() => shown(p.$("result")) && p.viewers.length === 1);
  p.$("spin-toggle").click();
  assert.equal(p.$("spin-toggle").getAttribute("aria-pressed"), "true");
  assert.deepEqual(p.viewers[0].spinCalls, [true]);
  p.$("label-toggle").click();
  assert.equal(p.$("label-toggle").getAttribute("aria-pressed"), "true");
  assert.ok(p.viewers[0].calls.some((c) => c[0] === "addPropertyLabels" && c[1] === "elem"));
  await p.search("ethanol");
  await waitFor(() => p.viewers.length === 2);
  assert.equal(p.viewers[0].spinCalls.at(-1), false, "古いビューアが回り続けます");
  assert.equal(p.viewers[1].spinCalls.at(-1), true, "回転の設定が新しい結果に引き継がれていません");
  p.close();
});
await test("PNG保存・SDF保存でファイル名にCIDが入る。画像表示中は3D用の操作を隠す", async () => {
  const p = await openPopup();
  await p.search("water");
  await waitFor(() => shown(p.$("result")) && p.viewers.length === 1);
  p.$("save-png").click();
  p.$("save-sdf").click();
  assert.deepEqual(p.downloads, ["chem-viewer-962.png", "chem-viewer-962.sdf"]);
  assert.notEqual(p.$("viewer-3d-controls").style.display, "none");
  p.$("view-toggle").click();
  assert.equal(p.$("viewer-3d-controls").style.display, "none");
  p.close();
});

console.log("\n[popup: 異性体候補]");
await test("候補は「名前 (CID)」で表示し、別の候補を選んでもドロップダウンが消えない", async () => {
  const p = await openPopup({ fetchOpts: { formulaCids: [100, 200, 300] } });
  await p.search("C6H12O6");
  await waitFor(() => shown(p.$("result")) && p.$("candidate-select").options.length === 3);
  assert.deepEqual([...p.$("candidate-select").options].map((o) => o.textContent), ["Glucose (CID 100)", "Fructose (CID 200)", "Galactose (CID 300)"]);
  p.change(p.$("candidate-select"), "200");
  // 再取得と再描画が終わるまで待ってから確認する（待たないと、テスト自身が設定した選択値を見ているだけになる）
  await waitFor(() => p.calls.some((u) => u.includes("/cid/200/property/")));
  await waitFor(() => !p.$("search-btn").disabled);
  assert.notEqual(p.$("r-candidates-row").style.display, "none", "候補のドロップダウンが消えました");
  assert.equal(p.$("candidate-select").options.length, 3, "候補が消えました");
  assert.equal(p.$("candidate-select").value, "200");
  p.close();
});

console.log(`\n結果: ${passed} 件成功 / ${failed} 件失敗`);
process.exit(failed ? 1 : 0);
