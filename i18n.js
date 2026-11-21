// 多言語対応の共通ヘルパー。表示言語は設定（resultLanguage）に従い、既定（"auto"）ではブラウザの言語。
// ヘッダーのトグルで ja / en を切り替えると、UI文言も即座に切り替わる。
// _locales/ja（既定）, _locales/en の messages.json を自前で読み込んで使う。
// 依存: pubchem.js（ChemAPI）。読み込み前・失敗時は browser.i18n.getMessage にフォールバックする。

let currentLocale = null; // null の間は browser.i18n に任せる
const localeMessages = {};

async function loadLocale(locale) {
  if (localeMessages[locale]) return localeMessages[locale];
  try {
    const res = await fetch(browser.runtime.getURL(`_locales/${locale}/messages.json`));
    localeMessages[locale] = await res.json();
  } catch {
    localeMessages[locale] = null;
  }
  return localeMessages[locale];
}

// messages.json の placeholders（$WEIGHT$ → $1 など）を置換する
function formatMessage(entry, substitutions) {
  const subs = Array.isArray(substitutions) ? substitutions : substitutions == null ? [] : [substitutions];
  let text = entry.message;
  for (const [name, def] of Object.entries(entry.placeholders || {})) {
    const m = /^\$(\d)$/.exec(def.content || "");
    const value = m ? subs[Number(m[1]) - 1] : def.content;
    text = text.split(new RegExp(`\\$${name}\\$`, "i")).join(value ?? "");
  }
  return text;
}

function t(key, substitutions) {
  const entry = currentLocale && localeMessages[currentLocale]?.[key];
  if (entry) return formatMessage(entry, substitutions);
  return browser.i18n.getMessage(key, substitutions) || key;
}

// ページ内の data-i18n / data-i18n-placeholder / data-i18n-title を
// 一括で実際のロケール文字列に置き換える。
function applyI18n(root = document) {
  root.querySelectorAll("[data-i18n]").forEach((el) => {
    const text = t(el.getAttribute("data-i18n"));
    if (text) el.textContent = text;
  });
  root.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    const text = t(el.getAttribute("data-i18n-placeholder"));
    if (text) el.setAttribute("placeholder", text);
  });
  root.querySelectorAll("[data-i18n-aria-label]").forEach((el) => {
    const text = t(el.getAttribute("data-i18n-aria-label"));
    if (text) el.setAttribute("aria-label", text);
  });
  root.querySelectorAll("[data-i18n-title]").forEach((el) => {
    const text = t(el.getAttribute("data-i18n-title"));
    if (text) el.setAttribute("title", text);
  });
}

// 表示言語（"ja" / "en"）を切り替えて、ページ内の静的な文言を再翻訳する
async function setLocale(locale) {
  const resolved = locale === "ja" ? "ja" : "en";
  await loadLocale(resolved);
  currentLocale = resolved;
  document.documentElement.lang = resolved;
  applyI18n();
}

// 先にブラウザの言語で即時表示し、設定の読み込み後に設定どおりの言語へ切り替える
document.documentElement.lang = browser.i18n.getUILanguage().split("-")[0] || "ja";
applyI18n();
const i18nReady = ChemAPI.getSettings()
  .then((s) => setLocale(ChemAPI.resolveLanguage(s.resultLanguage)))
  .catch(() => {});
