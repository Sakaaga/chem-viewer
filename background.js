// Chrome の Service Worker 環境では importScripts が使えるので、ここで polyfill を読み込む。
// Firefox の background（event page）環境では importScripts が存在せず、
// manifest の "scripts" 配列側で既に polyfill が読み込み済みのため、この分岐はスキップされる。
// Firefox側は manifest の "scripts" 配列で同じファイルを読み込む。
if (typeof importScripts === "function") {
  importScripts("libs/browser-polyfill.min.js", "formula.js", "pubchem.js", "highlight-sync.js");
}

const PENDING_KEY = "pendingQuery"; // app.js と同じキー
const MAX_SELECTION_LENGTH = 1000; // 誤って大量に選択した文章をそのまま保持・送信しないための上限

function normalizeSelection(text) {
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, MAX_SELECTION_LENGTH);
}

// メニューは作り直しても重複エラーにならないよう、先に全削除してから登録する
browser.runtime.onInstalled.addListener(async () => {
  await browser.contextMenus.removeAll();
  browser.contextMenus.create({
    id: "analyze-chemical",
    // "%s" はブラウザが選択テキストに自動置換するプレースホルダー
    title: browser.i18n.getMessage("contextMenuAnalyze"),
    contexts: ["selection"],
  });
  // 更新後も、ページ内ハイライトを有効にしているユーザーには最新の定義で登録し直す
  try {
    await ChemHighlight.resyncFromSettings();
  } catch (err) {
    console.warn("ハイライト用スクリプトの再登録に失敗しました:", err?.message || err);
  }
});

// ポップアップを開く。ユーザー操作（クリック/ショートカット）の直後でないと拒否されるため、
// 他の await より前に同期的に呼び出して、ジェスチャーが失効しないようにする。
// 非対応バージョン・拒否時は false を返し、バッジ表示のみのフォールバックになる。
function tryOpenPopup() {
  try {
    return Promise.resolve(browser.action.openPopup()).then(() => true, () => false);
  } catch {
    return Promise.resolve(false);
  }
}

// 選択テキストを「メモリ上のみ・短時間だけ有効」な領域(storage.session)に渡す。
// ディスクには残らず、ブラウザ終了で消える。プライベートウィンドウ由来のテキストも永続化されない。
async function deliverSelection(selectionText) {
  const text = normalizeSelection(selectionText);
  if (!text) return;
  // バッジを先に立てる（受け取り側が消した後にバッジだけ残る競合を避けるため、必ず保存より前）
  await browser.action.setBadgeText({ text: "!" });
  await browser.action.setBadgeBackgroundColor({ color: "#2563eb" });
  await browser.storage.session.set({ [PENDING_KEY]: { text, ts: Date.now() } });
}

// 右クリックメニュー
browser.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId !== "analyze-chemical" || !info.selectionText) return;
  const opening = tryOpenPopup(); // 同期的に呼ぶ（ジェスチャー維持）
  deliverSelection(info.selectionText)
    .then(() => opening)
    .catch((err) => console.error("deliverSelection failed:", err));
});

// キーボードショートカット。commands API は選択テキストを渡してくれないため、
// アクティブなタブで window.getSelection() を取得する（activeTab権限＋ユーザー操作で許可される）。
browser.commands.onCommand.addListener((command) => {
  if (command !== "analyze-selection") return;
  const opening = tryOpenPopup(); // 同期的に呼ぶ（ジェスチャー維持）。ポップアップは受け取り側が後から結果を拾う

  (async () => {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    try {
      const results = await browser.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => window.getSelection()?.toString() ?? "",
      });
      await deliverSelection(results?.[0]?.result || "");
    } catch (err) {
      // PDFビューア・ブラウザ内部ページ・拡張機能ページなど、スクリプト注入できないページでは何もしない
      console.warn("選択テキストを取得できませんでした:", err?.message || err);
    }
    await opening;
  })();
});

// ---------------------------------------------------------------------------
// ページ内ハイライト（content script）のクリックからの問い合わせ受付。
// 右クリックメニュー／ショートカットと同じ経路（deliverSelection）に統一し、
// ハイライトをクリックした場合も選択して検索した場合と同じようにポップアップで結果を表示する。
// content script 自身はPubChemへ直接通信しない（通信は必ずバックグラウンドで行う）。
// ---------------------------------------------------------------------------
const ANALYZE_MESSAGE = "chemviewer:analyze";

browser.runtime.onMessage.addListener((message, sender) => {
  // 自分自身の拡張機能から届いた、想定の形式のメッセージ以外は無視する
  if (sender.id !== browser.runtime.id) return undefined;
  if (!message || message.type !== ANALYZE_MESSAGE) return undefined;

  // 化学式として文法的に妥当な文字列だけを受け付ける（任意の文字列を第三者へ送らない）
  const formula = typeof message.formula === "string" ? ChemAPI.normalizeQuery(message.formula) : "";
  if (!formula || !ChemFormula.parse(formula).valid) return Promise.resolve({ opened: false, accepted: false });

  // 他のクリック元（右クリックメニュー・ショートカット）と同様、
  // 他のawaitより前に同期的に呼び出して、ユーザー操作のジェスチャーが失効しないようにする。
  const opening = tryOpenPopup();
  return (async () => {
    await deliverSelection(formula);
    const opened = await opening;
    return { opened, accepted: true };
  })();
});
