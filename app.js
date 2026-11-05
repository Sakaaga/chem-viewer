const els = {
  input: document.getElementById("query-input"),
  smilesToggle: document.getElementById("smiles-toggle"),
  searchBtn: document.getElementById("search-btn"),
  status: document.getElementById("status"),
  result: document.getElementById("result"),
  rQuery: document.getElementById("r-query"),
  rName: document.getElementById("r-name"),
  rFormula: document.getElementById("r-formula"),
  rWeight: document.getElementById("r-weight"),
  rSmiles: document.getElementById("r-smiles"),
  rInchikey: document.getElementById("r-inchikey"),
  rCasRow: document.getElementById("r-cas-row"),
  rCas: document.getElementById("r-cas"),
  rSynonymsRow: document.getElementById("r-synonyms-row"),
  rSynonyms: document.getElementById("r-synonyms"),
  rHazardRow: document.getElementById("r-hazard-row"),
  hazardSummary: document.getElementById("hazard-summary"),
  hazardStatements: document.getElementById("hazard-statements"),
  rCandidatesRow: document.getElementById("r-candidates-row"),
  candidateSelect: document.getElementById("candidate-select"),
  rExactMass: document.getElementById("r-exactmass"),
  rXlogp: document.getElementById("r-xlogp"),
  rTpsa: document.getElementById("r-tpsa"),
  rHDonor: document.getElementById("r-hdonor"),
  rHAcceptor: document.getElementById("r-hacceptor"),
  viewToggle: document.getElementById("view-toggle"),
  viewer: document.getElementById("viewer"),
  viewerImage: document.getElementById("viewer-image"),
  molarMassInput: document.getElementById("molar-mass-input"),
  molarMolOutput: document.getElementById("molar-mol-output"),
  pubchemLink: document.getElementById("pubchem-link"),
  copyResult: document.getElementById("copy-result"),
  historyList: document.getElementById("history-list"),
  historyClear: document.getElementById("history-clear"),
  historyExport: document.getElementById("history-export"),
  optionsLink: document.getElementById("options-link"),
  langToggle: document.getElementById("lang-toggle"),
  privateNote: document.getElementById("private-note"),
};

let glviewer = null;
let isSearching = false; // 多重リクエスト防止用フラグ
let lastResult = null; // 「結果をコピー」用に直近の検索結果を保持
let viewMode = "3d"; // "3d"（3Dmol.jsモデル） または "image"（PubChemの2D画像）
let currentImageUrl = null; // 2D画像は表示モードになるまで読み込まない（不要な通信を避ける）
let currentLang = "en"; // 表示言語（英語既定）。設定の resultLanguage から初期化する
let currentJaName = null; // 直近の結果についての日本語名（取得済みならキャッシュ、未取得ならnull）
let currentGhs = null; // 翻訳トグルでHコードの表示を切り替えるために保持

// プライベートウィンドウでは「履歴は保存されません」の案内を表示する
if (els.privateNote && ChemAPI.isPrivateContext()) {
  els.privateNote.style.display = "block";
}

// 設定の表示言語を初期値として反映（以後はこのポップアップ内でのトグルで切り替える）
ChemAPI.getSettings().then((settings) => {
  currentLang = settings.resultLanguage;
  updateLangToggleLabel();
});

function updateLangToggleLabel() {
  if (!els.langToggle) return;
  els.langToggle.textContent = currentLang === "ja" ? "日本語" : "EN";
}

function setStatus(msg) {
  els.status.textContent = msg;
}

// 検索中は入力欄・ボタンを無効化し、連打や多重リクエストを防ぐ
function setBusy(busy) {
  isSearching = busy;
  els.searchBtn.disabled = busy;
  els.input.disabled = busy;
  els.searchBtn.textContent = busy ? t("searchButtonBusy") : t("searchButton");
}

function renderViewer(sdfText) {
  els.viewer.innerHTML = "";
  glviewer = $3Dmol.createViewer(els.viewer, { backgroundColor: "white" });
  glviewer.addModel(sdfText, "sdf");
  glviewer.setStyle({}, { stick: {}, sphere: { scale: 0.3 } });
  glviewer.zoomTo();
  glviewer.render();
}

// 2D画像 / 3Dモデルの表示切り替え
function setViewMode(mode) {
  viewMode = mode;
  if (mode === "image") {
    els.viewer.style.display = "none";
    els.viewerImage.style.display = "block";
    if (currentImageUrl && els.viewerImage.getAttribute("src") !== currentImageUrl) {
      els.viewerImage.src = currentImageUrl;
    }
    els.viewToggle.textContent = t("viewToggleTo3D");
  } else {
    els.viewer.style.display = "block";
    els.viewerImage.style.display = "none";
    els.viewToggle.textContent = t("viewToggleTo2D");
  }
}

els.viewerImage.addEventListener("error", () => {
  els.viewerImage.style.display = "none";
  setStatus(t("noStructureData"));
});

els.viewToggle.addEventListener("click", () => {
  setViewMode(viewMode === "3d" ? "image" : "3d");
});

function formatHistoryLabel(entry) {
  const date = new Date(entry.timestamp);
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${entry.query} (${hh}:${mm})`;
}

// 検索履歴の描画
async function renderHistory() {
  const history = await ChemAPI.getHistory();
  els.historyList.innerHTML = "";

  if (history.length === 0) {
    const li = document.createElement("li");
    li.className = "history-empty";
    li.textContent = t("historyEmpty");
    els.historyList.appendChild(li);
    return;
  }

  for (const entry of history) {
    const li = document.createElement("li");
    li.className = "history-item";
    li.textContent = formatHistoryLabel(entry);
    li.addEventListener("click", () => {
      if (isSearching) return; // 検索中にチェックボックスだけ変わって不整合になるのを防ぐ
      els.input.value = entry.query;
      els.smilesToggle.checked = !!entry.smilesMode;
      runQuery(entry.query);
    });
    els.historyList.appendChild(li);
  }
}

// GHS危険性情報の描画（控えめな表示にとどめる：小さい文字・折りたたみ）。
// currentLang に応じて、英語の原文／日本語訳（Hコード辞書）のどちらを見せるか切り替える。
function renderHazard(ghs) {
  currentGhs = ghs;
  if (!ghs || (ghs.pictograms.length === 0 && ghs.statements.length === 0)) {
    els.rHazardRow.style.display = "none";
    return;
  }
  els.rHazardRow.style.display = "block";
  els.hazardSummary.textContent = ghs.pictograms.length > 0 ? ghs.pictograms.join(" / ") : t("hazardSummary");
  const list = currentLang === "ja" ? ghs.statementsJa : ghs.statements;
  els.hazardStatements.innerHTML = "";
  for (const statement of list) {
    const p = document.createElement("div");
    p.textContent = statement;
    els.hazardStatements.appendChild(p);
  }
}

function renderSynonyms(synonyms) {
  if (!synonyms || synonyms.length === 0) {
    els.rSynonymsRow.style.display = "none";
    return;
  }
  els.rSynonymsRow.style.display = "flex";
  els.rSynonyms.textContent = synonyms.join(", ");
}

function renderCasNumber(casNumber) {
  if (!casNumber) {
    els.rCasRow.style.display = "none";
    return;
  }
  els.rCasRow.style.display = "flex";
  els.rCas.textContent = casNumber;
}

function renderAdvancedProps(props) {
  els.rExactMass.textContent = props.ExactMass ? `${props.ExactMass} g/mol` : "-";
  els.rXlogp.textContent = props.XLogP ?? "-";
  els.rTpsa.textContent = props.TPSA != null ? `${props.TPSA} Å²` : "-";
  els.rHDonor.textContent = props.HBondDonorCount ?? "-";
  els.rHAcceptor.textContent = props.HBondAcceptorCount ?? "-";
}

// 分子式検索で異性体が複数見つかった場合の候補ドロップダウン
function renderCandidates(cid, otherCids) {
  if (!otherCids || otherCids.length === 0) {
    els.rCandidatesRow.style.display = "none";
    els.candidateSelect.innerHTML = "";
    return;
  }
  els.rCandidatesRow.style.display = "flex";
  els.candidateSelect.innerHTML = "";
  for (const c of [cid, ...otherCids]) {
    const opt = document.createElement("option");
    opt.value = String(c);
    opt.textContent = `CID ${c}`;
    els.candidateSelect.appendChild(opt);
  }
  els.candidateSelect.value = String(cid);
}

els.candidateSelect.addEventListener("change", async () => {
  const cid = els.candidateSelect.value;
  if (!cid || isSearching) return;
  setBusy(true);
  setStatus(t("statusSearching"));
  try {
    const resolved = await ChemAPI.resolveCompoundByCid(cid);
    if (resolved) await renderResult(resolved, els.input.value, els.smilesToggle.checked, { skipHistory: true });
  } catch (err) {
    console.error(err);
    setStatus(t("statusError"));
  } finally {
    setBusy(false);
  }
});

// 名前の表示を、現在の言語設定に合わせて更新する（必要ならWikidataへ遅延取得する）
async function updateNameDisplay() {
  if (!lastResult) return;
  if (currentLang === "ja") {
    if (currentJaName === null && lastResult.matchedBy !== "ja-name") {
      els.rName.textContent = t("statusSearching");
      currentJaName = (await ChemAPI.fetchJapaneseLabelByCid(lastResult.cid).catch(() => null)) || "";
    }
    els.rName.textContent = currentJaName || lastResult.nameEn;
  } else {
    els.rName.textContent = lastResult.nameEn;
  }
  renderHazard(currentGhs);
}

if (els.langToggle) {
  els.langToggle.addEventListener("click", async () => {
    currentLang = currentLang === "ja" ? "en" : "ja";
    updateLangToggleLabel();
    await ChemAPI.saveSettings({ resultLanguage: currentLang });
    await updateNameDisplay();
  });
}

// CIDが決まった後の表示処理。候補切り替え（renderCandidates経由の再検索）とも共有する。
async function renderResult(resolved, query, smilesMode, { skipHistory = false } = {}) {
  const { cid, props, sdf, synonyms, casNumber, ghs, imageUrl, matchedBy, jaName, otherCids } = resolved;

  currentJaName = matchedBy === "ja-name" ? jaName : null;
  const nameEn = props.IUPACName || "(不明)";

  els.rQuery.textContent = query;
  els.rName.textContent = currentLang === "ja" && currentJaName ? currentJaName : nameEn;
  els.rFormula.textContent = props.MolecularFormula || "-";
  els.rWeight.textContent = props.MolecularWeight ? t("weightWithUnit", [props.MolecularWeight]) : "-";
  els.rSmiles.textContent = props.smiles || "-";
  els.rInchikey.textContent = props.InChIKey || "-";
  els.pubchemLink.href = `https://pubchem.ncbi.nlm.nih.gov/compound/${cid}`;

  renderCasNumber(casNumber);
  renderSynonyms(synonyms);
  renderHazard(ghs);
  renderAdvancedProps(props);
  renderCandidates(cid, otherCids);

  els.result.style.display = "block";
  currentImageUrl = imageUrl;
  els.viewerImage.removeAttribute("src");
  els.viewerImage.alt = nameEn || props.MolecularFormula || query;

  els.molarMassInput.value = "";
  els.molarMolOutput.textContent = "-";

  // 分子式での一致は「同じ分子式の異性体のうち先頭1件」なので、その旨を明示する
  const note = matchedBy === "formula" ? t("statusFormulaMatch") : "";

  if (sdf) {
    renderViewer(sdf);
    els.viewToggle.style.display = "inline-block";
    setViewMode("3d");
    setStatus(note);
  } else {
    // 3D/2D構造データのどちらも無い場合は、代替としてPubChemの2D画像を直接表示する
    els.viewToggle.style.display = "none";
    setViewMode("image");
    setStatus(note);
  }

  // 「結果をコピー」用に保持
  lastResult = {
    cid,
    matchedBy,
    query,
    nameEn,
    formula: props.MolecularFormula || "-",
    weight: props.MolecularWeight ? t("weightWithUnit", [props.MolecularWeight]) : "-",
    smiles: props.smiles || "-",
    inchikey: props.InChIKey || "-",
    casNumber: casNumber || "-",
    pubchemUrl: `https://pubchem.ncbi.nlm.nih.gov/compound/${cid}`,
  };

  if (!skipHistory) {
    await ChemAPI.addHistoryEntry({
      query,
      smilesMode,
      name: nameEn,
      formula: props.MolecularFormula || null,
    });
    await renderHistory();
  }
}

async function runQuery(rawQuery) {
  if (isSearching) return; // 実行中の多重起動を防ぐ

  const query = ChemAPI.normalizeQuery(rawQuery);
  if (!query) {
    setStatus(t("statusEmptyQuery"));
    return;
  }
  if (query.length > ChemAPI.MAX_QUERY_LENGTH) {
    // 長文を誤って選択した場合に、そのまま第三者(PubChem)へ送らない
    setStatus(t("statusTooLong"));
    return;
  }

  els.result.style.display = "none";
  setBusy(true);
  setStatus(t("statusSearching"));

  const smilesMode = els.smilesToggle.checked;

  try {
    const resolved = await ChemAPI.resolveCompound(query, { smilesMode });

    if (!resolved) {
      setStatus(t("statusNotFound"));
      lastResult = null;
      return;
    }

    await renderResult(resolved, query, smilesMode);
  } catch (err) {
    if (err.name === "AbortError") {
      setStatus(t("statusTimeout"));
    } else if (err.name === "ServerBusyError") {
      setStatus(t("statusBusy"));
    } else if (err.name === "QueryTooLongError") {
      setStatus(t("statusTooLong"));
    } else {
      console.error(err);
      setStatus(t("statusError"));
    }
    lastResult = null;
  } finally {
    setBusy(false);
  }
}

// モル計算（質量 g → 物質量 mol）。分子量が分かっている結果にのみ対応。
els.molarMassInput.addEventListener("input", () => {
  const grams = parseFloat(els.molarMassInput.value);
  const weight = lastResult && Number(lastResult.weight.replace(/[^\d.]/g, ""));
  if (!Number.isFinite(grams) || !weight) {
    els.molarMolOutput.textContent = "-";
    return;
  }
  els.molarMolOutput.textContent = (grams / weight).toPrecision(4);
});

// 結果をテキストとしてクリップボードにコピー
async function copyResultToClipboard() {
  if (!lastResult) return;
  const text = [
    `${t("clipboardLabelQuery")}: ${lastResult.query}`,
    `${t("clipboardLabelName")}: ${lastResult.nameEn}`,
    `${t("clipboardLabelFormula")}: ${lastResult.formula}`,
    `${t("clipboardLabelWeight")}: ${lastResult.weight}`,
    `${t("clipboardLabelSmiles")}: ${lastResult.smiles}`,
    `${t("clipboardLabelInchikey")}: ${lastResult.inchikey}`,
    `${t("clipboardLabelCas")}: ${lastResult.casNumber}`,
    `${t("clipboardLabelPubchem")}: ${lastResult.pubchemUrl}`,
  ].join("\n");

  try {
    await navigator.clipboard.writeText(text);
    const original = els.copyResult.textContent;
    els.copyResult.textContent = t("copyResultDone");
    setTimeout(() => {
      els.copyResult.textContent = original;
    }, 1500);
  } catch (err) {
    console.error(err);
  }
}

// 履歴をJSONファイルとしてダウンロード
async function exportHistory() {
  const json = await ChemAPI.exportHistoryAsJSON();
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `chem-viewer-history-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

els.searchBtn.addEventListener("click", () => runQuery(els.input.value));
els.input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") runQuery(els.input.value);
});
els.historyClear.addEventListener("click", async () => {
  await ChemAPI.clearHistory();
  await renderHistory();
});
els.copyResult.addEventListener("click", copyResultToClipboard);
els.historyExport.addEventListener("click", exportHistory);

// 設定リンク（オプションページを開く）
if (els.optionsLink) {
  els.optionsLink.addEventListener("click", (e) => {
    e.preventDefault();
    browser.runtime.openOptionsPage();
  });
}

// 右クリックメニュー／キーボードショートカットから渡された選択テキストの受け取り。
// background.js がメモリ上のみ(storage.session)に短時間だけ置く。ポップアップが先に開いていても
// 後から届いても拾えるよう、起動時の読み取りと onChanged の両方で受け取る。
const PENDING_KEY = "pendingQuery";
const PENDING_TTL_MS = 60 * 1000; // 古い選択テキストが後から突然検索されないよう、1分で失効させる

async function consumePending() {
  const stored = await browser.storage.session.get(PENDING_KEY);
  const pending = stored[PENDING_KEY];
  if (!pending) return;
  await browser.storage.session.remove(PENDING_KEY);
  await browser.action.setBadgeText({ text: "" });
  if (typeof pending.text !== "string" || Date.now() - pending.ts > PENDING_TTL_MS) return;
  els.smilesToggle.checked = false;
  els.input.value = pending.text;
  runQuery(pending.text);
}

// 先にリスナーを登録してから初回読み取りを行う（両者の間に隙間を作らない）
browser.storage.onChanged.addListener((changes, area) => {
  if (area === "session" && changes[PENDING_KEY]?.newValue) consumePending();
});
browser.action.setBadgeText({ text: "" }).catch(() => {}); // 開いた時点でバッジは不要
consumePending();

renderHistory();
