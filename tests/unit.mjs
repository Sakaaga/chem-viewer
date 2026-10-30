// pubchem.js / formula.js のロジックを、偽のブラウザAPI・偽のfetchで検証するテスト。
// ブラウザもネットワークも不要:  node unit.mjs
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function makeEnv({ fetchImpl, incognito = false, settings } = {}) {
  const store = {};
  if (settings) store.settings = settings;
  const browser = {
    storage: { local: { get: async (k) => ({ [k]: store[k] }), set: async (o) => Object.assign(store, o) } },
    extension: { inIncognitoContext: incognito },
  };
  const ctx = { browser, fetch: fetchImpl, AbortController, setTimeout, clearTimeout, console, URL };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of ["formula.js", "pubchem.js"]) vm.runInContext(fs.readFileSync(path.join(src, f), "utf8"), ctx, { filename: f });
  return { ChemAPI: ctx.window.ChemAPI, ChemFormula: ctx.window.ChemFormula, store };
}

// vmの別実行空間で作られた配列/オブジェクトは prototype が異なり厳密比較に失敗するため、素のJSONに変換して比較する
const plain = (v) => JSON.parse(JSON.stringify(v));
const json = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body, text: async () => JSON.stringify(body) });
const text = (status, body) => ({ status, ok: status >= 200 && status < 300, text: async () => body, json: async () => JSON.parse(body) });
const PROPS = (over = {}) => ({
  PropertyTable: {
    Properties: [{
      CID: 5793, MolecularFormula: "C6H12O6", MolecularWeight: "180.16", IUPACName: "glucose",
      CanonicalSMILES: "C", InChIKey: "K", ExactMass: "180.06", XLogP: -2.7, TPSA: 110,
      HBondDonorCount: 5, HBondAcceptorCount: 6, ...over,
    }],
  },
});

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  OK  ${name}`); }
  catch (e) { failed++; console.log(`  NG  ${name}\n      ${e.message}`); }
}

console.log("\n[化学式判定・Hill式変換 formula.js]");
{
  const { ChemFormula } = makeEnv({ fetchImpl: async () => json(404, {}) });
  const real = ["H2O", "CO2", "C6H12O6", "H2SO4", "NH3", "CH3COOH", "Ca(OH)2", "NaHCO3", "C2H5OH", "Fe2O3"];
  const rejected = ["MP3", "HTTP2", "COVID19", "IPv4", "UTF8", "SHA256", "RS232", "HD720", "DDR4", "AK47", "Q4FY", "TCP4", "Web3", "3D printing", "5G network"];

  await test("本物の化学式10件をすべて検出する", () => {
    for (const f of real) assert.equal(ChemFormula.findFormulas(f)[0]?.raw, f, `${f} を検出できません`);
  });
  await test("一般語の誤検出を排除する（D/T追加の副作用を含む回帰確認）", () => {
    for (const w of rejected) assert.equal(ChemFormula.findFormulas(w).length, 0, `${w} が誤検出されました`);
  });
  await test("1トークンの単一元素+数字（U 2, O2単体等）は誤検出しない", () => {
    assert.equal(ChemFormula.findFormulas("Water Is Bad For U 2").length, 0);
    assert.equal(ChemFormula.findFormulas("O2 is oxygen").length, 0);
  });
  await test("文中の化学式を位置つきで抽出する（括弧・句読点を含む）", () => {
    const r = ChemFormula.findFormulas("Water (H2O) and CO2, then Ca(OH)2.");
    assert.deepEqual(plain(r.map((x) => x.raw)), ["H2O", "CO2", "Ca(OH)2"]);
  });
  await test("Wikipedia形式の空白（要素記号直後）を検出し、地の文を巻き込まない", () => {
    const r = ChemFormula.findFormulas("Glucose C 6H 12O 6 is sweet and Water Is Bad For U 2");
    assert.deepEqual(plain(r.map((x) => x.text)), ["C6H12O6"]);
  });
  await test("反応式の係数（2H2O）を検出し、検索用の式には係数を含めない", () => {
    const r = ChemFormula.findFormulas("2H2 + O2 \u2192 2H2O");
    assert.deepEqual(plain(r.map((x) => ({ raw: x.raw, text: x.text }))), [{ raw: "2H2O", text: "H4O2" }]);
    // "page2H2O" のように数字の前が単語の続きの場合、"H2O" 自体は検出してよいが、
    // 直前の "2" を係数として巻き込んではいけない（raw に "page2" が含まれないことを確認する）。
    const r2 = ChemFormula.findFormulas("page2H2O");
    assert.equal(r2.length, 1);
    assert.equal(r2[0].raw, "H2O", "単語の続きの数字を係数として巻き込んでいます");
  });
  await test("水和物（CuSO4\u00b75H2O）を検出し、PubChem用にHill式へ展開する", () => {
    const r = ChemFormula.findFormulas("CuSO4\u00b75H2O in a beaker");
    assert.equal(r.length, 1);
    assert.equal(r[0].raw, "CuSO4\u00b75H2O");
    assert.equal(r[0].text, "CuH10O9S");
  });
  await test("D2O（重水）はページ内自動ハイライトでは対象外（HTTP2等の誤検出を避けるため）", () => {
    assert.equal(ChemFormula.findFormulas("D2O is heavy water").length, 0);
  });
  await test("検索欄では D/T 同位体記法を許可する", () => {
    assert.ok(ChemFormula.isFormula("D2O"));
    assert.equal(ChemFormula.toSearchFormula("D2O"), "D2O");
  });
  await test("Hill式変換: 括弧の乗数を正しく展開する（Fe(NO3)3 → FeN3O9）", () => {
    assert.equal(ChemFormula.toSearchFormula("Fe(NO3)3"), "FeN3O9");
    assert.equal(ChemFormula.toSearchFormula("Ca(OH)2"), "CaH2O2");
  });
  await test("検索欄: 要素の前後どちらの空白も許容する（手入力のFe 2 O 3等）", () => {
    assert.equal(ChemFormula.normalizeFormula("Fe 2 O 3"), "Fe2O3");
    assert.ok(ChemFormula.isFormula("Na Cl"));
  });
  await test("空白を挟んでも、元素記号として存在しない語は依然として拒否する", () => {
    assert.equal(ChemFormula.normalizeFormula("Xx 2 Yy 3"), null);
  });
  await test("文法的に無関係な数字列は誤って結合しない（過去の回帰バグの固定化）", () => {
    assert.equal(ChemFormula.normalizeFormula("H2ONaCl12 2"), null);
  });
  await test("Unicode下付きの式を検出し、raw=元の表記 / text=検索用の表記 を返す", () => {
    const r = ChemFormula.findFormulas("Acid H\u2082SO\u2084.");
    assert.equal(r.length, 1);
    assert.equal(r[0].raw, "H\u2082SO\u2084");
    assert.equal(r[0].text, "H2O4S");
  });
}

console.log("\n[入力検証・通信層 pubchem.js]");
await test("正規化(NFKC)と200文字上限（超過は QueryTooLongError）", async () => {
  const { ChemAPI } = makeEnv({ fetchImpl: async () => json(404, {}) });
  assert.equal(ChemAPI.normalizeQuery("  a \n\t b  "), "a b");
  assert.equal(ChemAPI.normalizeQuery("H\u2082O"), "H2O"); // NFKC正規化がUnicode下付き数字(U+2082等)も通常の数字に変換する
  await assert.rejects(ChemAPI.resolveCompound("A".repeat(201)), { name: "QueryTooLongError" });
});

await test("404は『見つからない』(null)、429/503は ServerBusyError（誤表示を防ぐ）", async () => {
  let env = makeEnv({ fetchImpl: async () => json(404, {}) });
  assert.equal(await env.ChemAPI.resolveCompound("zzz-nothing-xx"), null);
  for (const code of [429, 503]) {
    env = makeEnv({ fetchImpl: async () => json(code, {}) });
    await assert.rejects(env.ChemAPI.resolveCompound("aspirin"), { name: "ServerBusyError" });
  }
});

await test("Cookie・Referrerを送らない設定でfetchしている", async () => {
  let opts;
  const fetchImpl = async (url, o) => { opts = o; return json(404, {}); };
  const { ChemAPI } = makeEnv({ fetchImpl });
  await ChemAPI.resolveCompound("aspirin");
  assert.equal(opts.credentials, "omit");
  assert.equal(opts.referrerPolicy, "no-referrer");
});

await test("APIが返したCIDが数値でなければ採用しない（URL/DOMへの注入防止）", async () => {
  const fetchImpl = async () => json(200, { IdentifierList: { CID: ["<img src=x onerror=alert(1)>"] } });
  const { ChemAPI } = makeEnv({ fetchImpl });
  assert.equal(await ChemAPI.resolveCompound("aspirin"), null);
});

console.log("\n[検索の優先順位: 名前 → 分子式 → 日本語名(Wikidata)]");
await test("名前検索が成功すれば、分子式・Wikidataへは問い合わせない", async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    if (url.includes("/name/")) return json(200, { IdentifierList: { CID: [5793] } });
    if (url.includes("/property/")) return json(200, PROPS());
    if (url.includes("/SDF")) return text(200, "sdf");
    return json(200, { InformationList: { Information: [{ Synonym: [] }] } });
  };
  const { ChemAPI } = makeEnv({ fetchImpl });
  const r = await ChemAPI.resolveCompound("glucose", { light: true });
  assert.equal(r.matchedBy, "name");
  assert.ok(!urls.some((u) => u.includes("fastformula") || u.includes("wikidata")));
});

await test("分子式として妥当な表記は、PubChemへ合成済みのHill式（スペース・水和物なし）で問い合わせる", async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    if (url.includes("/name/")) return json(404, {});
    if (url.includes("/fastformula/")) return json(200, { IdentifierList: { CID: [5793, 1234] } });
    if (url.includes("/property/")) return json(200, PROPS());
    return text(200, "sdf");
  };
  const { ChemAPI } = makeEnv({ fetchImpl });
  const r = await ChemAPI.resolveCompound("C 6H 12O 6", { light: true });
  assert.equal(r.matchedBy, "formula");
  const formulaUrl = urls.find((u) => u.includes("/fastformula/"));
  assert.equal(formulaUrl, "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/fastformula/C6H12O6/cids/JSON");
});

await test("分子式検索で複数候補が見つかった場合、先頭を採用しつつ残りを otherCids として保持する", async () => {
  const fetchImpl = async (url) => {
    if (url.includes("/name/")) return json(404, {});
    if (url.includes("/fastformula/")) return json(200, { IdentifierList: { CID: [100, 200, 300] } });
    if (url.includes("/property/")) return json(200, PROPS());
    return text(200, "sdf");
  };
  const { ChemAPI } = makeEnv({ fetchImpl });
  const r = await ChemAPI.resolveCompound("C6H12O6", { light: true });
  assert.equal(r.cid, 100);
  assert.deepEqual(plain(r.otherCids), [200, 300]);
});

await test("resolveCompoundByCid は名前・分子式の再解決をせず、指定CIDの情報だけを取得する", async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    if (url.includes("/property/")) return json(200, PROPS({ CID: 200 }));
    return text(200, "sdf");
  };
  const { ChemAPI } = makeEnv({ fetchImpl });
  const r = await ChemAPI.resolveCompoundByCid(200, { light: true });
  assert.equal(r.cid, 200);
  assert.ok(!urls.some((u) => u.includes("/name/") || u.includes("fastformula")));
});

await test("名前・分子式のどちらでも見つからない場合のみ、Wikidataで日本語名を試す", async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    if (url.includes("/name/")) return json(404, {});
    if (url.includes("action=wbsearchentities")) {
      return json(200, { search: [{ id: "Q18216", label: "\u30a2\u30b9\u30d4\u30ea\u30f3" }] });
    }
    if (url.includes("action=wbgetentities")) {
      return json(200, { entities: { Q18216: { claims: { P662: [{ mainsnak: { datavalue: { value: "2244" } } }] } } } });
    }
    if (url.includes("/property/")) return json(200, PROPS({ CID: 2244, IUPACName: "aspirin" }));
    return text(200, "sdf");
  };
  const { ChemAPI } = makeEnv({ fetchImpl });
  const r = await ChemAPI.resolveCompound("\u30a2\u30b9\u30d4\u30ea\u30f3", { light: true }); // アスピリン
  assert.equal(r.matchedBy, "ja-name");
  assert.equal(r.cid, 2244);
  assert.equal(r.jaName, "\u30a2\u30b9\u30d4\u30ea\u30f3");
  assert.ok(urls.some((u) => u.includes("origin=*")), "WikidataへCORS用のorigin=*を付けていません");
});

await test("Wikidataの応答にCIDが無い/数値でない場合は、最終的に null を返す（誤って他の化合物を返さない）", async () => {
  const fetchImpl = async (url) => {
    if (url.includes("/name/")) return json(404, {});
    if (url.includes("action=wbsearchentities")) return json(200, { search: [{ id: "Q1", label: "x" }] });
    if (url.includes("action=wbgetentities")) return json(200, { entities: { Q1: { claims: {} } } });
    return json(404, {});
  };
  const { ChemAPI } = makeEnv({ fetchImpl });
  assert.equal(await ChemAPI.resolveCompound("\u672a\u77e5\u306e\u5316\u5408\u7269"), null);
});

await test("fetchJapaneseLabelByCid: haswbstatementでCIDから逆引きする", async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    if (url.includes("action=query")) return json(200, { query: { search: [{ title: "Q18216" }] } });
    if (url.includes("action=wbgetentities")) return json(200, { entities: { Q18216: { labels: { ja: { value: "\u30a2\u30b9\u30d4\u30ea\u30f3" } } } } });
    return json(404, {});
  };
  const { ChemAPI } = makeEnv({ fetchImpl });
  const label = await ChemAPI.fetchJapaneseLabelByCid(2244);
  assert.equal(label, "\u30a2\u30b9\u30d4\u30ea\u30f3");
  assert.ok(urls[0].includes("haswbstatement%3AP662%3D2244") || urls[0].includes("haswbstatement:P662=2244"));
});

console.log("\n[CAS番号・GHS和訳]");
await test("別名(Synonyms)の中からCAS番号の形式のものだけを抽出する", async () => {
  const fetchImpl = async (url) => {
    if (url.includes("/name/")) return json(200, { IdentifierList: { CID: [2244] } });
    if (url.includes("/property/")) return json(200, PROPS({ CID: 2244 }));
    if (url.includes("/synonyms/")) {
      return json(200, { InformationList: { Information: [{ Synonym: ["Aspirin", "50-78-2", "Acetylsalicylic acid", "not-a-cas-1"] }] } });
    }
    return text(200, "sdf");
  };
  const { ChemAPI } = makeEnv({ fetchImpl });
  const r = await ChemAPI.resolveCompound("aspirin");
  assert.equal(r.casNumber, "50-78-2");
});

await test("GHS: HコードごとにstatementsJa（日本語訳）を併記する", async () => {
  const ghsBody = { Record: { Section: [{ TOCHeading: "GHS Classification", Section: [
    { TOCHeading: "GHS Hazard Statements", Information: [{ Value: { StringWithMarkup: [{ String: "H315: Causes skin irritation" }, { String: "H999: Unknown future code" }] } }] },
  ] }] } };
  const fetchImpl = async (url) => {
    if (url.includes("pug_view")) return json(200, ghsBody);
    if (url.includes("/name/")) return json(200, { IdentifierList: { CID: [5793] } });
    if (url.includes("/property/")) return json(200, PROPS());
    if (url.includes("/SDF")) return text(200, "sdf");
    if (url.includes("/synonyms/")) return json(200, { InformationList: { Information: [{ Synonym: [] }] } });
    return json(404, {});
  };
  const { ChemAPI } = makeEnv({ fetchImpl });
  const r = await ChemAPI.resolveCompound("glucose");
  assert.deepEqual(plain(r.ghs.statements), ["H315: Causes skin irritation", "H999: Unknown future code"]);
  assert.equal(r.ghs.statementsJa[0], "H315: \u76ae\u819a\u523a\u6fc0"); // 皮膚刺激
  assert.equal(r.ghs.statementsJa[1], "H999: Unknown future code", "辞書に無いコードは原文のまま");
});

await test("translateHazardStatement は単体でも使える（Hコードが無ければ原文のまま）", () => {
  const { ChemAPI } = makeEnv({ fetchImpl: async () => json(404, {}) });
  assert.equal(ChemAPI.translateHazardStatement("H302: Harmful if swallowed"), "H302: \u98f2\u307f\u8fbc\u3080\u3068\u6709\u5bb3");
  assert.equal(ChemAPI.translateHazardStatement("no code here"), "no code here");
});

console.log("\n[追加プロパティ・ライトモード]");
await test("ExactMass/XLogP/TPSA/水素結合ドナー・アクセプタを取得する", async () => {
  const fetchImpl = async (url) => {
    if (url.includes("/name/")) return json(200, { IdentifierList: { CID: [5793] } });
    if (url.includes("/property/")) return json(200, PROPS());
    return text(200, "sdf");
  };
  const { ChemAPI } = makeEnv({ fetchImpl });
  const r = await ChemAPI.resolveCompound("glucose", { light: true });
  assert.equal(r.props.ExactMass, "180.06");
  assert.equal(r.props.XLogP, -2.7);
  assert.equal(r.props.TPSA, 110);
  assert.equal(r.props.HBondDonorCount, 5);
  assert.equal(r.props.HBondAcceptorCount, 6);
});

await test("light モードは構造データ・別名・GHS・CASを取得しない（通信の最小化）", async () => {
  const urls = [];
  const fetchImpl = async (url) => { urls.push(url); return url.includes("/property/") ? json(200, PROPS()) : json(200, { IdentifierList: { CID: [5793] } }); };
  const { ChemAPI } = makeEnv({ fetchImpl });
  const r = await ChemAPI.resolveCompound("glucose", { light: true });
  assert.ok(!urls.some((u) => /SDF|synonyms|pug_view/.test(u)), urls.join("\n"));
  assert.equal(r.casNumber, null);
  assert.equal(r.ghs, null);
});

console.log("\n[履歴・設定]");
await test("履歴の重複判定は『クエリ＋検索モード』／上限件数を守る", async () => {
  const { ChemAPI } = makeEnv({ fetchImpl: async () => json(404, {}), settings: { historyMax: 2 } });
  await ChemAPI.addHistoryEntry({ query: "CCO", smilesMode: true });
  await ChemAPI.addHistoryEntry({ query: "CCO", smilesMode: false });
  let h = await ChemAPI.getHistory();
  assert.equal(h.length, 2);
  await ChemAPI.addHistoryEntry({ query: "CCO", smilesMode: true });
  h = await ChemAPI.getHistory();
  assert.equal(h.length, 2);
  assert.equal(h[0].smilesMode, true);
  await ChemAPI.addHistoryEntry({ query: "x", smilesMode: false });
  assert.equal((await ChemAPI.getHistory()).length, 2);
});

await test("プライベートウィンドウでは履歴を書き込まない", async () => {
  const { ChemAPI, store } = makeEnv({ fetchImpl: async () => json(404, {}), incognito: true });
  await ChemAPI.addHistoryEntry({ query: "secret", smilesMode: false });
  assert.equal(store.searchHistory, undefined);
});

await test("壊れた/改ざんされた保存データは除外・補正される", async () => {
  const { ChemAPI, store } = makeEnv({ fetchImpl: async () => json(404, {}) });
  store.searchHistory = [1, null, { query: 5 }, { query: "ok", timestamp: 1 }];
  assert.deepEqual(plain((await ChemAPI.getHistory()).map((h) => h.query)), ["ok"]);
  store.settings = { timeoutSeconds: "abc", historyMax: 99999, preferredStructure: "x", autoHighlight: "yes", resultLanguage: "fr" };
  assert.deepEqual(plain(await ChemAPI.getSettings()), { timeoutSeconds: 8, historyMax: 200, preferredStructure: "3d", autoHighlight: false, resultLanguage: "en" });
});

console.log(`\n結果: ${passed} 件成功 / ${failed} 件失敗`);
process.exit(failed ? 1 : 0);
