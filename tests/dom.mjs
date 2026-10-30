// content.js を jsdom（ブラウザ相当のDOM）上で実際に動かし、background.js（Service Worker相当）と
// 実際につないで検証する統合テスト。   node dom.mjs        一部だけ: ONLY="キーワード" node dom.mjs
import { JSDOM } from "jsdom";
import assert from "node:assert/strict";
import { read, bootBackground, fakePubChem } from "./harness.mjs";

const TRUSTED = "__chemviewerTrusted";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// html のページに content.js を注入する。通信は本物の background.js を経由する。
async function runPage(html, { pubchem = "ok", settings = { autoHighlight: true }, openPopup = true, patch } = {}) {
  const dom = new JSDOM(`<!DOCTYPE html><body>${html}</body>`, { runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  const logs = { warn: [], error: [], info: [] };
  w.console = { ...console, warn: (...a) => logs.warn.push(a), error: (...a) => logs.error.push(a), info: (...a) => logs.info.push(a) };

  const pc = fakePubChem(pubchem);
  const bg = bootBackground({ fetchImpl: pc, settings, openPopup });
  const messages = [];
  w.browser = {
    storage: { local: { get: async () => ({ settings }), set: async () => {} } },
    runtime: { sendMessage: async (msg) => { messages.push(msg); return bg.message(msg); } },
    i18n: { getMessage: (k) => k },
    extension: {},
  };

  // クリックの「本物/偽物(isTrusted)」を切り替えられるようにする（jsdomは本物のユーザー操作を作れないため）。
  const orig = w.EventTarget.prototype.addEventListener;
  w.EventTarget.prototype.addEventListener = function (type, fn, opts) {
    if (type === "click" && typeof fn === "function") {
      return orig.call(this, type, function (e) {
        const proxy = new Proxy(e, { get: (t, p) => (p === "isTrusted" ? !!w[TRUSTED] : typeof t[p] === "function" ? t[p].bind(t) : t[p]) });
        return fn.call(this, proxy);
      }, opts);
    }
    return orig.call(this, type, fn, opts);
  };

  for (const f of ["formula.js", "content.js"]) w.eval(read(f)); // ページには formula.js と content.js だけを入れる（pubchem.js は入れない）
  if (patch) patch(w);
  // JSDOMのウィンドウ（MutationObserver・タイマーを含む）は明示的に閉じないと残り続け、
  // 大量のページを連続生成するファジングテストでプロセス全体が徐々に遅くなる（製品側の不具合ではない）。
  return { w, doc: w.document, logs, messages, pc, bg, close: () => dom.window.close() };
}

// ハイライト数が一定時間変わらなくなるまで待つ（時間分割で処理されるため）
async function settle(doc, { stableMs = 500, maxMs = 40000 } = {}) {
  const t0 = Date.now();
  let last = -1, since = Date.now();
  while (Date.now() - t0 < maxMs) {
    const n = doc.querySelectorAll(".chemviewer-hl").length;
    if (n !== last) { last = n; since = Date.now(); }
    else if (Date.now() - since >= stableMs) return n;
    await sleep(100);
  }
  return last;
}
const hl = (doc) => [...doc.querySelectorAll(".chemviewer-hl")].map((e) => e.textContent);

let passed = 0, failed = 0;
async function test(name, fn) {
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return; // 一部のテストだけ実行する用
  try { await fn(); passed++; console.log(`  OK  ${name}`); } catch (e) { failed++; console.log(`  NG  ${name}\n      ${e.message}`); }
}
const para = (i) => `<p>Para ${i}: water H<sub>2</sub>O and CO2 here.</p>`;

console.log("\n[報告された症状の回帰テスト]");
await test("【ページ下部が未処理】400段落(800件)すべて、最後の段落までハイライトされる（旧実装は300件で打ち切り）", async () => {
  const { doc } = await runPage(Array.from({ length: 400 }, (_, i) => para(i)).join(""));
  assert.equal(await settle(doc), 800);
  const last = [...doc.querySelectorAll("p")].at(-1);
  assert.equal(last.querySelectorAll(".chemviewer-hl").length, 2, "最後の段落がハイライトされていません");
});

await test("1000段落(2000件)でも、すべて処理され、ページ上の文字は一切変わらない", async () => {
  const html = Array.from({ length: 1000 }, (_, i) => para(i)).join("");
  const { doc } = await runPage(html);
  assert.equal(await settle(doc), 2000);
  assert.equal(doc.body.textContent, new JSDOM(`<body>${html}</body>`).window.document.body.textContent);
});

await test("上限(3000件)に達したら、それ以上は囲まず、その旨をコンソールに1回だけ出す", async () => {
  const { doc, logs } = await runPage(Array.from({ length: 1700 }, (_, i) => para(i)).join(""));
  assert.equal(await settle(doc, { stableMs: 800 }), 3000);
  assert.equal(logs.info.filter((a) => String(a[0]).includes("highlight limit")).length, 1);
});

await test("【動的ページ】既存のテキストをその場で書き換えても検出する（characterData）", async () => {
  const { doc } = await runPage(`<p id="p">nothing yet</p>`);
  await sleep(200);
  doc.getElementById("p").firstChild.nodeValue = "now H2O appears";
  assert.equal(await settle(doc), 1);
});

await test("【動的ページ】既存の要素にテキストノードだけを追加しても検出する", async () => {
  const { doc } = await runPage(`<p id="p">first CO2 </p>`);
  assert.equal(await settle(doc), 1);
  doc.getElementById("p").appendChild(doc.createTextNode("later NH3 added"));
  assert.equal(await settle(doc), 2);
});

await test("【動的ページ】フレームワークが内容を作り直しても、再びハイライトされる", async () => {
  const { doc } = await runPage(`<div id="app"><p>A: H<sub>2</sub>O</p></div>`);
  assert.equal(await settle(doc), 1);
  doc.getElementById("app").innerHTML = `<p>B: CO2 and NH<sub>3</sub></p>`; // 再描画（ハイライトのspanは消える）
  assert.equal(await settle(doc), 2);
});

await test("1つのノードで例外が起きても、他のノードの処理は止まらない（警告は最大3回）", async () => {
  const html = `<p>one H2O</p><p>BOOM H2O</p><p>three CO2</p><p>BOOM NH3</p><p>five CH4</p>`;
  const { doc, logs } = await runPage(html, {
    patch: (w) => {
      const real = w.ChemFormula.findFormulas;
      w.ChemFormula.findFormulas = (t) => { if (String(t).includes("BOOM")) throw new Error("boom"); return real(t); };
    },
  });
  await settle(doc);
  assert.deepEqual(hl(doc), ["H2O", "CO2", "CH4"]);
  assert.ok(logs.warn.length >= 1 && logs.warn.length <= 3, `警告 ${logs.warn.length} 件`);
});

console.log("\n[クリックと通信（content → background → PubChem）]");
await test("ホバーでは通信しない／ページ側が発火した偽のクリックでも通信しない", async () => {
  const { doc, w, messages, pc } = await runPage(`<p>Water H<sub>2</sub>O.</p>`);
  await settle(doc);
  const span = doc.querySelector(".chemviewer-hl");
  span.dispatchEvent(new w.MouseEvent("mouseenter", { bubbles: true }));
  w[TRUSTED] = false;
  span.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await sleep(400);
  assert.equal(messages.length, 0);
  assert.equal(pc.calls.length, 0);
});

await test("【ご要望】本物のクリックで、選択検索と同じ経路（chemviewer:analyze）でポップアップを開こうとする", async () => {
  const { doc, w, messages, bg } = await runPage(`<p>Water H<sub>2</sub>O.</p>`);
  await settle(doc);
  w[TRUSTED] = true;
  doc.querySelector(".chemviewer-hl").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await sleep(300);
  assert.deepEqual(JSON.parse(JSON.stringify(messages)), [{ type: "chemviewer:analyze", formula: "H2O" }]);
  // 選択して検索した場合（右クリック／ショートカット）と同じ pendingQuery に渡っていること
  const pending = (await bg.ctx.browser.storage.session.get("pendingQuery")).pendingQuery;
  assert.equal(pending.text, "H2O");
});

await test("ポップアップが自動で開けた場合は、ページ上のヒントを消す", async () => {
  const { doc, w } = await runPage(`<p>Water H<sub>2</sub>O.</p>`, { openPopup: true });
  await settle(doc);
  w[TRUSTED] = true;
  doc.querySelector(".chemviewer-hl").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await sleep(300);
  assert.equal(doc.getElementById("chemviewer-tooltip").style.display, "none");
});

await test("ポップアップを自動で開けない場合（古いブラウザ相当）は、ツールバーを見るよう案内する", async () => {
  const { doc, w } = await runPage(`<p>Water H<sub>2</sub>O.</p>`, { openPopup: false });
  await settle(doc);
  w[TRUSTED] = true;
  doc.querySelector(".chemviewer-hl").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await sleep(300);
  assert.ok(doc.getElementById("chemviewer-tooltip").textContent.includes("highlightCheckToolbar"));
});

await test("ページに pubchem.js が無くても動く（通信はバックグラウンドのみ）／ページからPubChemへ直接fetchしない", async () => {
  const { w } = await runPage(`<p>H2O</p>`);
  assert.equal(typeof w.ChemAPI, "undefined");
  assert.equal(typeof w.fetch, "undefined");
});

console.log("\n[下付き数字・除外対象]");
await test("<sub>形式（H<sub>2</sub>O, C6H12O6, Ca(OH)2, SO4<sup>2−</sup>）を検出し、文字は一切変わらない", async () => {
  const html = `<p id="p">Water is H<sub>2</sub>O, glucose is C<sub>6</sub>H<sub>12</sub>O<sub>6</sub>; lime Ca(OH)<sub>2</sub>; sulfate SO<sub>4</sub><sup>2−</sup>.</p>`;
  const { doc } = await runPage(html);
  await settle(doc);
  assert.equal(doc.getElementById("p").textContent, new JSDOM(`<body>${html}</body>`).window.document.getElementById("p").textContent);
  assert.deepEqual(hl(doc), ["H2O", "C6H12O6", "Ca(OH)2", "SO4"]);
});
await test("Unicode下付き（H₂SO₄）は元の表記のまま検出する", async () => {
  const { doc } = await runPage(`<p id="p">Acid H₂SO₄ and water H₂O.</p>`);
  await settle(doc);
  assert.deepEqual(hl(doc), ["H₂SO₄", "H₂O"]);
});
await test("リンク・コード内は対象外／一般語(MP3)は対象外", async () => {
  const { doc } = await runPage(`<p><a href="#x">CO<sub>2</sub> NH3</a> <code>H<sub>2</sub>O</code> and the MP3 file</p>`);
  await sleep(500);
  assert.deepEqual(hl(doc), []);
});

console.log("\n[ファジング: ランダムな構造のページ 60 件]");
// 件数は60に抑えている。各反復を個別に実行すると3秒未満で収束することは確認済みで content.js 自体に
// 無限ループは無いが、この簡易テストハーネスは jsdom のウィンドウを使い捨てる作りのため、
// 大量に連続生成するとプロセス全体が徐々に重くなる（テスト環境固有の制約であり製品側の不具合ではない）。
await test("どんな構造でも、例外なし・文字が変わらない・除外要素に入らない・妥当な式だけを囲む", async () => {
  let seed = 20260930;
  const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const words = ["H", "O", "C", "Ca", "N", "Na", "Cl", "S", "2", "12", "(OH)", "SO4", "word", " ", ", ", "MP3", "CO2", "H2O", "NaCl", "H₂O", "&nbsp;", "日本語", "(", ")", "Fe2O3", "x"];
  const tags = ["p", "span", "b", "i", "a", "code", "sub", "sup", "td", "li", "em", "button", "div"];
  const gen = (d) => { let s = ""; const n = 1 + Math.floor(rnd() * 5); for (let i = 0; i < n; i++) { if (d < 3 && rnd() < 0.45) { const t = pick(tags); s += `<${t}>${gen(d + 1)}</${t}>`; } else s += pick(words); } return s; };

  const SKIP = "a, button, code, pre";
  for (let i = 0; i < 60; i++) {
    const html = `<div>${gen(0)}</div><div>${gen(0)}</div>`;
    const before = new JSDOM(`<body>${html}</body>`).window.document.body.textContent;
    const { doc, logs, w, close } = await runPage(html);
    try {
      await settle(doc, { stableMs: 250, maxMs: 2000 });
      assert.equal(doc.body.textContent, before, `#${i} 文字が変化: ${html}`);
      assert.equal(logs.warn.length + logs.error.length, 0, `#${i} 例外/警告: ${JSON.stringify(logs.warn.concat(logs.error))} ${html}`);
      for (const span of doc.querySelectorAll(".chemviewer-hl")) {
        assert.ok(!span.closest(SKIP), `#${i} 除外要素の内側を囲みました: ${html}`);
        assert.ok(!span.parentElement.closest(".chemviewer-hl"), `#${i} 入れ子で囲みました: ${html}`);
        const p = w.ChemFormula.parse(w.ChemFormula.normalizeSubscripts(span.textContent.replace(/\u00a0/g, "")));
        assert.ok(p.valid && p.atoms >= 2, `#${i} 妥当でない式を囲みました「${span.textContent}」: ${html}`);
      }
    } finally {
      close(); // 次の反復に影響を持ち越さない
    }
  }
});

console.log(`\n結果: ${passed} 件成功 / ${failed} 件失敗`);
process.exit(failed ? 1 : 0);
