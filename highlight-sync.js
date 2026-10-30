// ページ内ハイライト用 content script の登録・解除を一箇所にまとめたもの
// （設定画面と、拡張機能の更新時の再登録の両方から使う）。
// manifest に content_scripts を常設せず、設定でONにして権限が許可された場合だけ動的に登録する。
(function (global) {
  const SCRIPT_ID = "chemviewer-highlight";
  const ORIGINS = { origins: ["<all_urls>"] };
  // 通信はバックグラウンド経由で行うため、ページ内スクリプトに pubchem.js は読み込まない
  const FILES = ["libs/browser-polyfill.min.js", "formula.js", "content.js"];

  async function register() {
    // 拡張機能の更新後に古い定義（読み込むファイル一覧など）が残らないよう、常に作り直す
    const existing = await browser.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
    if (existing.length > 0) await browser.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
    await browser.scripting.registerContentScripts([
      { id: SCRIPT_ID, matches: ["<all_urls>"], js: FILES, runAt: "document_idle", persistAcrossSessions: true },
    ]);
  }

  async function unregister() {
    const existing = await browser.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
    if (existing.length > 0) await browser.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
    await browser.permissions.remove(ORIGINS).catch(() => {});
  }

  async function sync(enabled) {
    if (enabled) await register();
    else await unregister();
  }

  // 拡張機能のインストール/更新時：設定がONで権限もある場合のみ、最新の定義で登録し直す
  async function resyncFromSettings() {
    const settings = await ChemAPI.getSettings();
    const hasPermission = await browser.permissions.contains(ORIGINS);
    if (settings.autoHighlight && hasPermission) await register();
  }

  global.ChemHighlight = { sync, resyncFromSettings, ORIGINS };
})(typeof window !== "undefined" ? window : globalThis);
