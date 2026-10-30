// テスト共通部品: background.js を Service Worker 相当の環境（windowなし）で起動する。
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const read = (f) => fs.readFileSync(path.join(src, f), "utf8");

export const json = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body, text: async () => JSON.stringify(body) });
export const PROPS = (cid = 962) => ({ PropertyTable: { Properties: [{ CID: cid, MolecularFormula: "H2O", MolecularWeight: "18.015", IUPACName: "oxidane", CanonicalSMILES: "O", InChIKey: "K" }] } });

// 偽のPubChem: 名前検索→CID、プロパティ→PROPS。mode で挙動を変えられる
export function fakePubChem(mode = "ok") {
  const calls = [];
  const impl = async (url) => {
    calls.push(url);
    if (mode === "busy") return json(503, {});
    if (mode === "notfound") return json(404, {});
    if (url.includes("/property/")) return json(200, PROPS());
    if (url.includes("/name/")) return json(200, { IdentifierList: { CID: [962] } });
    return json(404, {});
  };
  impl.calls = calls;
  return impl;
}

export function bootBackground({ fetchImpl, settings = { autoHighlight: true }, openPopup = true } = {}) {
  const store = { settings };
  const sessionStore = {}; // storage.session相当（実際に保存する簡易実装）
  const listeners = {};
  const registered = [];
  const browser = {
    runtime: {
      id: "ext-id",
      onInstalled: { addListener: (fn) => (listeners.installed = fn) },
      onMessage: { addListener: (fn) => (listeners.message = fn) },
    },
    contextMenus: { removeAll: async () => {}, create() {}, onClicked: { addListener() {} } },
    action: {
      openPopup: async () => { if (!openPopup) throw new Error("openPopup not available"); },
      setBadgeText: async () => {},
      setBadgeBackgroundColor: async () => {},
    },
    commands: { onCommand: { addListener() {} } },
    storage: {
      local: { get: async (k) => ({ [k]: store[k] }), set: async (o) => Object.assign(store, o) },
      session: {
        get: async (k) => ({ [k]: sessionStore[k] }),
        set: async (o) => Object.assign(sessionStore, o),
        remove: async (k) => { delete sessionStore[k]; },
      },
    },
    tabs: { query: async () => [] },
    scripting: {
      getRegisteredContentScripts: async () => registered.slice(),
      registerContentScripts: async (defs) => registered.push(...defs),
      unregisterContentScripts: async () => registered.splice(0),
      executeScript: async () => [],
    },
    permissions: { contains: async () => true, remove: async () => true },
    i18n: { getMessage: (k) => k },
    extension: {},
  };
  // window を定義しない（Service Worker相当）。importScripts で依存ファイルを読み込む。
  const ctx = {
    browser, fetch: fetchImpl, AbortController, setTimeout, clearTimeout, console, URL,
    importScripts: (...files) => { for (const f of files) if (!f.includes("polyfill")) vm.runInContext(read(f), ctx, { filename: f }); },
  };
  vm.createContext(ctx);
  vm.runInContext(read("background.js"), ctx, { filename: "background.js" });
  return {
    ctx, store, registered, listeners,
    message: (msg, senderId = "ext-id") => listeners.message(msg, { id: senderId }),
  };
}
