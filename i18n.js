// 多言語対応の共通ヘルパー。browser.i18n.getMessage() の薄いラッパーと、
// data-i18n系属性を持つDOM要素への自動反映を行う。
// 対応言語は _locales/ja（既定）, _locales/en。

function t(key, substitutions) {
  return browser.i18n.getMessage(key, substitutions) || key;
}

// ページ内の data-i18n / data-i18n-placeholder / data-i18n-title を
// 一括で実際のロケール文字列に置き換える。
function applyI18n(root = document) {
  root.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    const text = t(key);
    if (text) el.textContent = text;
  });
  root.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    const key = el.getAttribute("data-i18n-placeholder");
    const text = t(key);
    if (text) el.setAttribute("placeholder", text);
  });
  root.querySelectorAll("[data-i18n-aria-label]").forEach((el) => {
    const key = el.getAttribute("data-i18n-aria-label");
    const text = t(key);
    if (text) el.setAttribute("aria-label", text);
  });
  root.querySelectorAll("[data-i18n-title]").forEach((el) => {
    const key = el.getAttribute("data-i18n-title");
    const text = t(key);
    if (text) el.setAttribute("title", text);
  });
}

// スクリーンリーダー等のため、ページの言語属性も実際のUI言語に合わせる
document.documentElement.lang = browser.i18n.getUILanguage().split("-")[0] || "ja";
applyI18n();
