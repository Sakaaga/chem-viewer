// ブラウザ別（Firefox / Chrome）の配布物を dist/ に生成するスクリプト。依存パッケージなし。
//   node build.mjs
// 単一マニフェストでは、Chromeが要求する `sidePanel` 権限とFirefoxが要求する
// `data_collection_permissions` などを同時に満たせず、双方で警告が出るため、ブラウザ別に分けている。
// 生成時に「マニフェストが参照するファイルの実在」「HTMLのscript参照」「JS構文」「ロケール整合」も検査する。
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(root, "dist");

const FILES = [
  "_locales", "icons", "libs",
  "app.js", "background.js", "content.js", "formula.js", "highlight-sync.js", "i18n.js",
  "options.html", "options.js", "panel.css", "popup.html", "pubchem.js", "sidepanel.html",
  "LICENSE", "PRIVACY.md", "THIRD_PARTY_NOTICES.md",
];
const TARGETS = { firefox: "manifest.firefox.json", chrome: "manifest.chrome.json" };

const errors = [];
const fail = (msg) => errors.push(msg);
const readJSON = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

function manifestRefs(m) {
  const refs = new Set();
  const add = (p) => p && !p.startsWith("__MSG_") && refs.add(p);
  (m.background?.scripts || []).forEach(add);
  add(m.background?.service_worker);
  add(m.action?.default_popup);
  add(m.options_ui?.page);
  add(m.side_panel?.default_path);
  add(m.sidebar_action?.default_panel);
  Object.values(m.icons || {}).forEach(add);
  Object.values(m.action?.default_icon || {}).forEach(add);
  Object.values(m.sidebar_action?.default_icon || {}).forEach(add);
  return refs;
}

function checkBuild(dir, manifest) {
  for (const ref of manifestRefs(manifest)) {
    if (!fs.existsSync(path.join(dir, ref))) fail(`[${path.basename(dir)}] manifestが参照するファイルがありません: ${ref}`);
  }
  for (const html of fs.readdirSync(dir).filter((f) => f.endsWith(".html"))) {
    const text = fs.readFileSync(path.join(dir, html), "utf8");
    for (const m of text.matchAll(/<script[^>]+src="([^"]+)"/g)) {
      if (/^https?:/.test(m[1])) fail(`[${html}] 外部スクリプトの読み込みは禁止です: ${m[1]}`);
      else if (!fs.existsSync(path.join(dir, m[1]))) fail(`[${html}] script参照先がありません: ${m[1]}`);
    }
    if (/\son[a-z]+\s*=\s*["']/i.test(text)) fail(`[${html}] インラインイベントハンドラがあります（CSP違反になります）`);
  }
  for (const js of ["app.js", "background.js", "content.js", "formula.js", "highlight-sync.js", "i18n.js", "options.js", "pubchem.js"]) {
    try { execFileSync(process.execPath, ["--check", path.join(dir, js)], { stdio: "pipe" }); }
    catch (e) { fail(`[${js}] 構文エラー: ${e.stderr}`); }
  }
  const ja = Object.keys(readJSON(path.join(dir, "_locales/ja/messages.json")));
  const en = Object.keys(readJSON(path.join(dir, "_locales/en/messages.json")));
  for (const k of ja) if (!en.includes(k)) fail(`_locales/en に ${k} がありません`);
  for (const k of en) if (!ja.includes(k)) fail(`_locales/ja に ${k} がありません`);
}

for (const f of [...FILES, ...Object.values(TARGETS)]) {
  if (!fs.existsSync(path.join(root, f))) fail(`必要なファイルがありません: ${f}`);
}
if (errors.length) {
  console.error("\n検査に失敗しました:\n- " + errors.join("\n- "));
  process.exit(1);
}

fs.rmSync(dist, { recursive: true, force: true });
const manifests = {};
for (const [name, file] of Object.entries(TARGETS)) manifests[name] = readJSON(path.join(root, file));
if (manifests.firefox.version !== manifests.chrome.version) fail("Firefox/Chromeのversionが一致していません");

for (const [name, file] of Object.entries(TARGETS)) {
  const out = path.join(dist, name);
  fs.mkdirSync(out, { recursive: true });
  for (const f of FILES) fs.cpSync(path.join(root, f), path.join(out, f), { recursive: true });
  fs.copyFileSync(path.join(root, file), path.join(out, "manifest.json"));
  checkBuild(out, manifests[name]);
}

// 検査に不合格なら、zipを作らずに終了する（壊れた成果物を配布しないため）
if (errors.length) {
  fs.rmSync(dist, { recursive: true, force: true });
  console.error("\n検査に失敗しました:\n- " + [...new Set(errors)].join("\n- "));
  process.exit(1);
}

for (const [name] of Object.entries(TARGETS)) {
  const zip = path.join(dist, `chem-extension-${name}-v${manifests[name].version}.zip`);
  try {
    execFileSync("zip", ["-qr", zip, "."], { cwd: path.join(dist, name) });
    console.log(`OK  ${path.relative(root, zip)}`);
  } catch {
    console.log(`OK  dist/${name}/ （zipコマンドが無いため、フォルダのまま読み込めます）`);
  }
}
console.log("\nすべての検査に合格しました。");
