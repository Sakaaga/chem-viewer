// PubChem API とのやり取り、検索履歴・設定の保存を担当する共通モジュール。
// popup / sidepanel / options / background から読み込まれ、globalThis.ChemAPI 経由で使われる
// （ビルドツールを使わないためESモジュールにはしていない）。ページ内スクリプト(content script)には読み込まない。
// 依存: formula.js（globalThis.ChemFormula）

const PUBCHEM_BASE = "https://pubchem.ncbi.nlm.nih.gov/rest/pug";
const PUBCHEM_VIEW_BASE = "https://pubchem.ncbi.nlm.nih.gov/rest/pug_view";
const WIKIDATA_BASE = "https://www.wikidata.org/w/api.php";
const HISTORY_KEY = "searchHistory";
const SETTINGS_KEY = "settings";
const MAX_QUERY_LENGTH = 200; // 誤って長文を選択した場合に、第三者へ大量の文章を送らないための上限
const MAX_CANDIDATES = 5; // 分子式検索で異性体が複数ある場合に提示する候補数の上限

// ---------- 設定 ----------

const DEFAULT_SETTINGS = {
  timeoutSeconds: 8,
  historyMax: 20,
  preferredStructure: "3d", // "3d" または "2d"
  autoHighlight: false, // ページ内自動ハイライト（デフォルトOFF）
  resultLanguage: "en", // "en" または "ja"（化合物名・GHS文言の表示言語）
};

// ストレージの中身は信用せず、型と範囲を必ず正規化して使う
function sanitizeSettings(raw) {
  const s = raw && typeof raw === "object" ? raw : {};
  const num = (value, min, max, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
  };
  return {
    timeoutSeconds: num(s.timeoutSeconds, 1, 60, DEFAULT_SETTINGS.timeoutSeconds),
    historyMax: num(s.historyMax, 1, 200, DEFAULT_SETTINGS.historyMax),
    preferredStructure: s.preferredStructure === "2d" ? "2d" : "3d",
    autoHighlight: s.autoHighlight === true,
    resultLanguage: s.resultLanguage === "ja" ? "ja" : "en",
  };
}

async function getSettings() {
  const stored = await browser.storage.local.get(SETTINGS_KEY);
  return sanitizeSettings(stored[SETTINGS_KEY]);
}

async function saveSettings(partial) {
  const merged = sanitizeSettings({ ...(await getSettings()), ...partial });
  await browser.storage.local.set({ [SETTINGS_KEY]: merged });
  return merged;
}

// ---------- 入力の正規化 ----------

function normalizeQuery(value) {
  return String(value ?? "")
    .normalize("NFKC") // 下付き数字（H₂O）や全角英数字（Ｈ２Ｏ）を通常の文字に揃える
    .replace(/\s+/g, " ")
    .trim();
}

function makeError(name, message) {
  const err = new Error(message);
  err.name = name;
  return err;
}

// ---------- 通信（スロットリング＋タイムアウト＋ステータス判定） ----------

// 全リクエストが1つのキューを通ることで、最短でも MIN_INTERVAL_MS 間隔になる（PubChemは秒間5件以内を要請）。
const MIN_INTERVAL_MS = 250;
let requestQueue = Promise.resolve();
let lastRequestTime = 0;

function throttle(taskFn) {
  const next = requestQueue.then(async () => {
    const wait = Math.max(0, lastRequestTime + MIN_INTERVAL_MS - Date.now());
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    lastRequestTime = Date.now();
    return taskFn();
  });
  requestQueue = next.catch(() => {}); // 個々の失敗でキュー全体が止まらないようにする
  return next;
}

// タイムアウトは「本文の読み込み完了まで」を対象にする（ヘッダ受信後に本文が止まっても固まらない）。
// 戻り値: 成功時はパース済み本文 / 該当なし(404,400等)は null。
// サーバー混雑(429,5xx)は ServerBusyError を投げ、「見つからない」と誤表示しないようにする。
async function request(url, kind = "json") {
  const settings = await getSettings();
  const timeoutMs = settings.timeoutSeconds * 1000;

  return throttle(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        credentials: "omit",
        referrerPolicy: "no-referrer",
      });
      if (res.status === 429 || res.status >= 500) {
        throw makeError("ServerBusyError", `server responded with ${res.status}`);
      }
      if (!res.ok) return null;
      return kind === "text" ? await res.text() : await res.json();
    } finally {
      clearTimeout(timer);
    }
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// APIから返るCIDは数値であることを検証してから使う（URLやDOMに埋め込むため）
function firstCid(data) {
  const cid = data?.IdentifierList?.CID?.[0];
  return Number.isSafeInteger(cid) && cid > 0 ? cid : null;
}

// 妥当な正の整数のCIDだけを残し、重複を除いて先頭N件に絞る
function sanitizeCids(list, limit = MAX_CANDIDATES) {
  const seen = new Set();
  const out = [];
  for (const cid of Array.isArray(list) ? list : []) {
    if (Number.isSafeInteger(cid) && cid > 0 && !seen.has(cid)) {
      seen.add(cid);
      out.push(cid);
      if (out.length >= limit) break;
    }
  }
  return out;
}

async function fetchCidByName(name) {
  return firstCid(await request(`${PUBCHEM_BASE}/compound/name/${encodeURIComponent(name)}/cids/JSON`));
}

// fastformula は結果が多いと即時に返らず ListKey（待機用キー）を返すことがあるため、数回ポーリングする。
// 同じ分子式の化合物（異性体）が複数ある場合に備え、先頭N件を返す。
async function fetchCidsByFormula(formula) {
  let data = await request(`${PUBCHEM_BASE}/compound/fastformula/${encodeURIComponent(formula)}/cids/JSON`);
  for (let i = 0; i < 5 && data?.Waiting?.ListKey; i++) {
    await sleep(1000);
    data = await request(`${PUBCHEM_BASE}/compound/listkey/${encodeURIComponent(data.Waiting.ListKey)}/cids/JSON`);
  }
  return sanitizeCids(data?.IdentifierList?.CID);
}

async function fetchCidBySmiles(smiles) {
  return firstCid(await request(`${PUBCHEM_BASE}/compound/smiles/${encodeURIComponent(smiles)}/cids/JSON`));
}

// Wikidataの項目ID（Q123）として妥当かを検証する。応答から受け取ったIDをURLへ埋め込むため、
// 想定外の文字列（"Q1&origin=..." など）でクエリを書き換えられないようにする。
function isWikidataId(id) {
  return typeof id === "string" && /^Q[1-9]\d{0,12}$/.test(id);
}

// Wikidataで日本語名から化合物を探す（PubChemの名前検索は和名にほぼ対応していないため）。
// 1) wbsearchentities で日本語ラベル/別名から候補の項目(QID)を探す
// 2) 各候補の claims から P662（PubChem CID）を取り出す
// どちらもCORSが有効な公開APIで、origin=* を付けることでブラウザから直接呼び出せる
// （参照: https://www.mediawiki.org/wiki/API:Cross-site_requests）。
async function fetchCidByJapaneseNameWithLabel(name) {
  const searchUrl = `${WIKIDATA_BASE}?action=wbsearchentities&search=${encodeURIComponent(name)}&language=ja&format=json&origin=*&type=item&limit=5`;
  const searchData = await request(searchUrl);
  const candidates = (searchData?.search || []).filter((s) => isWikidataId(s?.id));
  if (candidates.length === 0) return null;

  const idsParam = candidates.map((c) => c.id).join("|");
  const entitiesUrl = `${WIKIDATA_BASE}?action=wbgetentities&ids=${idsParam}&props=claims&format=json&origin=*`;
  const entitiesData = await request(entitiesUrl);
  for (const candidate of candidates) {
    const claims = entitiesData?.entities?.[candidate.id]?.claims?.P662;
    const cid = Number(claims?.[0]?.mainsnak?.datavalue?.value);
    if (Number.isSafeInteger(cid) && cid > 0) {
      return { cid, label: candidate.label || name };
    }
  }
  return null;
}

// 既知のCIDについて、Wikidata上の日本語ラベルを逆引きする（英訳トグル用）。
// Wikidata検索API（CirrusSearch）の haswbstatement 構文で P662=CID の項目を探す。
async function fetchJapaneseLabelByCid(cid) {
  const searchUrl = `${WIKIDATA_BASE}?action=query&list=search&srsearch=${encodeURIComponent(`haswbstatement:P662=${cid}`)}&format=json&origin=*&srlimit=1`;
  const searchData = await request(searchUrl);
  const qid = searchData?.query?.search?.[0]?.title;
  if (!isWikidataId(qid)) return null;

  const entityUrl = `${WIKIDATA_BASE}?action=wbgetentities&ids=${qid}&props=labels&languages=ja&format=json&origin=*`;
  const entityData = await request(entityUrl);
  return entityData?.entities?.[qid]?.labels?.ja?.value || null;
}

async function fetchProperties(cid) {
  const props =
    "MolecularFormula,MolecularWeight,IUPACName,CanonicalSMILES,InChIKey," +
    "ExactMass,XLogP,TPSA,HBondDonorCount,HBondAcceptorCount";
  const data = await request(`${PUBCHEM_BASE}/compound/cid/${cid}/property/${props}/JSON`);
  const p = data?.PropertyTable?.Properties?.[0];
  if (!p) return null;
  // PubChemはSMILES系のプロパティ名を改名したため、要求名と応答キーが一致しないことがある
  // （CanonicalSMILES→ConnectivitySMILES、IsomericSMILES→SMILES）。どの名前で返っても読めるよう、
  // 表示側が使う p.smiles に正規化する。文字列以外・空文字は採用しない。
  const smiles = [p.SMILES, p.ConnectivitySMILES, p.CanonicalSMILES, p.IsomericSMILES].find(
    (v) => typeof v === "string" && v.length > 0
  );
  return { ...p, smiles: smiles ?? null };
}

// CAS登録番号。PubChemは専用プロパティとしては提供していないため、別名（Synonyms）の中から
// CAS番号の形式（例: 50-78-2）のものを探す。
function extractCasNumber(synonyms) {
  const casPattern = /^\d{2,7}-\d{2}-\d$/;
  return (synonyms || []).find((s) => casPattern.test(s)) || null;
}

function fetchSDF3D(cid) {
  return request(`${PUBCHEM_BASE}/compound/cid/${cid}/SDF?record_type=3d`, "text");
}

function fetchSDF2D(cid) {
  return request(`${PUBCHEM_BASE}/compound/cid/${cid}/SDF?record_type=2d`, "text");
}

// PubChemが直接返す2D構造画像（PNG）のURL。<img>のsrcに使う。
function get2DImageUrl(cid) {
  return `${PUBCHEM_BASE}/compound/cid/${cid}/PNG?record_type=2d&image_size=300x300`;
}

// 別名（Synonyms）の全件を取得する（CAS番号の抽出に使うため）。表示用に絞るのは呼び出し側で行う。
async function fetchSynonymsRaw(cid) {
  const data = await request(`${PUBCHEM_BASE}/compound/cid/${cid}/synonyms/JSON`);
  const list = data?.InformationList?.Information?.[0]?.Synonym || [];
  return list.filter((s) => typeof s === "string");
}

// GHS（危険有害性）分類。PUG View APIはレスポンスが深くネストしているため、
// 見出し(TOCHeading)を手がかりに文字列を集める。分類のない化合物が多いので、無ければ null。
async function fetchGHSClassification(cid) {
  const data = await request(`${PUBCHEM_VIEW_BASE}/data/compound/${cid}/JSON?heading=GHS+Classification`);
  const sections = data?.Record?.Section;
  if (!Array.isArray(sections)) return null;

  const pictograms = new Set();
  const statements = new Set();

  function walk(section) {
    const heading = String(section.TOCHeading || "");
    for (const info of section.Information || []) {
      for (const v of info?.Value?.StringWithMarkup || []) {
        const text = String(v.String || "").trim();
        if (heading.includes("Pictogram")) {
          // ピクトグラムは文字列ではなくアイコン(Markup)として入っており、名前は Extra にある
          for (const m of v.Markup || []) {
            if (m && typeof m.Extra === "string" && m.Extra.trim()) pictograms.add(m.Extra.trim());
          }
          if (text) pictograms.add(text);
        } else if (heading.includes("Hazard Statements") && text) {
          statements.add(text.slice(0, 160));
        }
      }
    }
    for (const child of section.Section || []) walk(child);
  }
  sections.forEach(walk);

  if (pictograms.size === 0 && statements.size === 0) return null;
  return { pictograms: [...pictograms].slice(0, 6), statements: [...statements].slice(0, 5) };
}

// GHS危険有害性情報（Hコード）の日本語訳。
// 出典: 厚生労働省「GHS対応・化管法／安衛法／毒劇法におけるラベル表示・SDS提供制度」
// （国連GHS文書附属書3 表A3.1.1〜A3.1.3 の仮訳に基づく）。オフラインの固定辞書のため追加の通信は発生しない。
const GHS_JA = {
  H200: "不安定爆発物", H201: "爆発物；大量爆発危険性", H202: "爆発物；激しい飛散危険性",
  H203: "爆発物；火災、爆風または飛散危険性", H204: "火災または飛散危険性", H205: "火災時に大量爆発のおそれ",
  H206: "火災、爆風または飛散危険性；鈍性化剤が減少した場合には爆発の危険性の増加",
  H207: "火災または飛散危険性；鈍性化剤が減少した場合には爆発の危険性の増加",
  H208: "火災危険性；鈍性化剤が減少した場合には爆発の危険性の増加",
  H220: "極めて可燃性の高いガス", H221: "可燃性ガス", H222: "極めて可燃性の高いエアゾール",
  H223: "可燃性エアゾール", H224: "極めて引火性の高い液体および蒸気", H225: "引火性の高い液体および蒸気",
  H226: "引火性の液体および蒸気", H227: "可燃性液体", H228: "可燃性固体", H229: "高圧容器：熱すると破裂のおそれ",
  H230: "空気が無くても爆発的に反応するおそれ",
  H231: "圧力および/または温度が上昇した場合、空気が無くても爆発的に反応するおそれ",
  H232: "空気に触れると自然発火のおそれ", H240: "熱すると爆発のおそれ", H241: "熱すると火災または爆発のおそれ",
  H242: "熱すると火災のおそれ", H250: "空気に触れると自然発火", H251: "自己発熱；火災のおそれ",
  H252: "大量の場合自己発熱；火災のおそれ", H260: "水に触れると自然発火するおそれのある可燃性ガスを発生",
  H261: "水に触れると可燃性ガスを発生", H270: "発火または火災助長のおそれ；酸化性物質",
  H271: "火災または爆発のおそれ；強酸化性物質", H272: "火災助長のおそれ；酸化性物質",
  H280: "高圧ガス；熱すると爆発のおそれ", H281: "深冷液化ガス；凍傷または傷害のおそれ", H290: "金属腐食のおそれ",
  H300: "飲み込むと生命に危険", H301: "飲み込むと有毒", H302: "飲み込むと有害", H303: "飲み込むと有害のおそれ",
  H304: "飲み込んで気道に侵入すると生命に危険のおそれ", H305: "飲み込んで気道に侵入すると有害のおそれ",
  H310: "皮膚に接触すると生命に危険", H311: "皮膚に接触すると有毒", H312: "皮膚に接触すると有害",
  H313: "皮膚に接触すると有害のおそれ", H314: "重篤な皮膚の薬傷・眼の損傷", H315: "皮膚刺激",
  H316: "軽度の皮膚刺激", H317: "アレルギー性皮膚反応を起こすおそれ", H318: "重篤な眼の損傷",
  H319: "強い眼刺激", H320: "眼刺激", H330: "吸入すると生命に危険", H331: "吸入すると有毒",
  H332: "吸入すると有害", H333: "吸入すると有害のおそれ",
  H334: "吸入するとアレルギー、喘息または呼吸困難を起こすおそれ", H335: "呼吸器への刺激のおそれ",
  H336: "眠気またはめまいのおそれ", H340: "遺伝性疾患のおそれ", H341: "遺伝性疾患のおそれの疑い",
  H350: "発がんのおそれ", H351: "発がんのおそれの疑い", H360: "生殖能または胎児への悪影響のおそれ",
  H361: "生殖能または胎児への悪影響のおそれの疑い", H362: "授乳中の子に害を及ぼすおそれ",
  H370: "臓器の障害", H371: "臓器の障害のおそれ", H372: "長期にわたる、または反復ばく露による臓器の障害",
  H373: "長期にわたる、または反復ばく露による臓器の障害のおそれ", H400: "水生生物に非常に強い毒性",
  H401: "水生生物に毒性", H402: "水生生物に有害", H410: "長期継続的影響により水生生物に非常に強い毒性",
  H411: "長期継続的影響により水生生物に毒性", H412: "長期継続的影響により水生生物に有害",
  H413: "長期継続的影響により水生生物に有害のおそれ", H420: "オゾン層を破壊し、健康および環境に有害",
};

// "H315: Causes skin irritation" のような英語の注意書きから、先頭のHコードだけを使って日本語訳に置き換える。
// 辞書に無いコードや、コードを含まない文字列はそのまま返す（無理に訳さない）。
function translateHazardStatement(text) {
  const m = /^(H\d{3})\b/.exec(String(text || ""));
  if (m && GHS_JA[m[1]]) return `${m[1]}: ${GHS_JA[m[1]]}`;
  return text;
}

// ---------- 検索の統合 ----------

// CIDが決まった後の共通処理（プロパティ・構造データ・別名・CAS・GHSの取得）。
// light: true のとき、構造データ・別名・GHSを取得しない（ページ内ツールチップ用。通信を最小限にする）。
async function buildResult(cid, matchedBy, { light = false, jaName = null, otherCids = [] } = {}) {
  const props = await fetchProperties(cid);
  if (!props) return null;

  if (light) {
    return { cid, props, matchedBy, jaName, otherCids, sdf: null, synonyms: [], casNumber: null, ghs: null, imageUrl: get2DImageUrl(cid) };
  }

  const settings = await getSettings();
  const [first, second] = settings.preferredStructure === "2d" ? [fetchSDF2D, fetchSDF3D] : [fetchSDF3D, fetchSDF2D];
  let sdf = await first(cid);
  if (!sdf) sdf = await second(cid);

  // 別名・GHSは補助情報。ここが失敗しても検索結果全体は成立させる。
  const [allSynonyms, ghsRaw] = await Promise.all([
    fetchSynonymsRaw(cid).catch(() => []),
    fetchGHSClassification(cid).catch(() => null),
  ]);

  const casNumber = extractCasNumber(allSynonyms);
  const synonyms = allSynonyms.slice(0, 5);
  const ghs = ghsRaw
    ? { ...ghsRaw, statementsJa: ghsRaw.statements.map(translateHazardStatement) }
    : null;

  return { cid, props, matchedBy, jaName, otherCids, sdf, synonyms, casNumber, ghs, imageUrl: get2DImageUrl(cid) };
}

// CID→プロパティ→（構造データ・別名・GHS）を解決する。
// smilesMode: SMILES専用エンドポイントのみを使う。
// それ以外は「名前検索→（式として妥当なら）分子式検索→（日本語名としてWikidataで）検索」の順に試す。
// light: true のとき、構造データ・別名・GHSを取得しない（ページ内ツールチップ用。通信を最小限にする）。
async function resolveCompound(query, { smilesMode = false, light = false } = {}) {
  const q = normalizeQuery(query);
  if (!q) return null;
  if (q.length > MAX_QUERY_LENGTH) {
    throw makeError("QueryTooLongError", `query exceeds ${MAX_QUERY_LENGTH} characters`);
  }

  if (smilesMode) {
    const cid = await fetchCidBySmiles(q);
    if (!cid) return null;
    return buildResult(cid, "smiles", { light });
  }

  const cid = await fetchCidByName(q);
  if (cid) return buildResult(cid, "name", { light });

  // "C 6H 12O 6" のように要素記号の直後に空白が入った表記（Wikipedia等）、
  // 手入力の「Fe 2 O 3」のような空白区切り、水和物（CuSO4·5H2O）、重水素（D2O）などは、
  // PubChemへは係数・水和物を展開した合成済みの式（Hill式）で問い合わせる。
  // 分子式は同じ式を持つ化合物（異性体）が複数あることがあるため、候補を複数保持する。
  const searchFormula = ChemFormula.toSearchFormula(q);
  if (searchFormula) {
    const candidates = await fetchCidsByFormula(searchFormula);
    if (candidates.length > 0) {
      return buildResult(candidates[0], "formula", { light, otherCids: candidates.slice(1) });
    }
  }

  // PubChemの名前検索はほぼ英語名専用のため、日本語名はWikidata経由で探す
  const jaResult = await fetchCidByJapaneseNameWithLabel(q).catch(() => null);
  if (jaResult) {
    return buildResult(jaResult.cid, "ja-name", { light, jaName: jaResult.label });
  }

  return null;
}

// 分子式検索などで複数候補が出た場合に、ユーザーが選んだ別の候補を表示するための関数。
// 名前・分子式の再解決は行わず、指定されたCIDについてのみ情報を取得する。
async function resolveCompoundByCid(cid, { light = false } = {}) {
  const parsedCid = Number(cid);
  if (!Number.isSafeInteger(parsedCid) || parsedCid <= 0) return null;
  return buildResult(parsedCid, "formula", { light });
}

// ---------- 検索履歴（browser.storage.local に保存） ----------

// プライベートブラウジング/シークレットで実行中かどうか。
// この場合は履歴を書き込まない（Mozilla Add-on Policies: プライベートブラウジングのデータは保存しない）。
function isPrivateContext() {
  return !!(typeof browser !== "undefined" && browser.extension && browser.extension.inIncognitoContext);
}

async function getHistory() {
  const stored = await browser.storage.local.get(HISTORY_KEY);
  const list = stored[HISTORY_KEY];
  if (!Array.isArray(list)) return [];
  // 壊れた/改ざんされた要素はここで除外する
  return list.filter((h) => h && typeof h.query === "string" && Number.isFinite(h.timestamp));
}

// 同じ「クエリ＋検索モード」の重複は先頭にまとめ直し、上限件数を超えた分は古いものから捨てる。
async function addHistoryEntry(entry) {
  if (isPrivateContext()) return getHistory();
  const settings = await getSettings();
  const history = await getHistory();
  const sameEntry = (h) => h.query === entry.query && !!h.smilesMode === !!entry.smilesMode;
  const next = [{ ...entry, timestamp: Date.now() }, ...history.filter((h) => !sameEntry(h))].slice(0, settings.historyMax);
  await browser.storage.local.set({ [HISTORY_KEY]: next });
  return next;
}

async function clearHistory() {
  await browser.storage.local.set({ [HISTORY_KEY]: [] });
}

async function exportHistoryAsJSON() {
  return JSON.stringify(await getHistory(), null, 2);
}

globalThis.ChemAPI = {
  MAX_QUERY_LENGTH,
  normalizeQuery,
  resolveCompound,
  resolveCompoundByCid,
  fetchJapaneseLabelByCid,
  translateHazardStatement,
  get2DImageUrl,
  getHistory,
  addHistoryEntry,
  clearHistory,
  exportHistoryAsJSON,
  getSettings,
  saveSettings,
  isPrivateContext,
};
