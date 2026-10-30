// addons-linter（AMOと同じ検証ツール）のJSON出力を読み、「想定外の警告・エラー」があれば失敗させる。
//   node scripts/check-amo-lint.mjs lint.json
// 許可する警告は ALLOWED のみ。3Dmol.js（無改変の公式配布物）内の eval は、文字列コールバックを渡した場合にしか
// 実行されず、本拡張機能はそのAPIを呼ばない（REVIEWER_NOTES.md を参照）。
import fs from "node:fs";

const ALLOWED = [{ code: "DANGEROUS_EVAL", file: "libs/3Dmol-min.js" }];

const lint = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const problems = [];

for (const e of lint.errors || []) problems.push(`エラー ${e.code}: ${e.message} (${e.file ?? "-"})`);
for (const w of lint.warnings || []) {
  const allowed = ALLOWED.some((a) => a.code === w.code && String(w.file || "").endsWith(a.file));
  if (!allowed) problems.push(`想定外の警告 ${w.code}: ${w.message} (${w.file ?? "-"})`);
}

console.log(`addons-linter: errors=${lint.summary?.errors} warnings=${lint.summary?.warnings} notices=${lint.summary?.notices}`);
if (problems.length) {
  console.error("\n" + problems.join("\n"));
  process.exit(1);
}
console.log("想定内の結果です。");
