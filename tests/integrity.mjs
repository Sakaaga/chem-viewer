// 同梱ライブラリ（libs/）が、THIRD_PARTY_NOTICES.md に記載した公式配布物のSHA-256と一致するかを検査する。
// 意図しない改変（手作業の編集・サプライチェーン上の差し替え）を検出するため、CIで毎回実行する。
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const root = process.env.CHEM_SRC || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const notices = fs.readFileSync(path.join(root, "THIRD_PARTY_NOTICES.md"), "utf8");

console.log("\n[同梱ライブラリの整合性]");
let checked = 0;
const problems = [];
for (const line of notices.split("\n")) {
  const file = /`(libs\/[^`]+)`/.exec(line)?.[1];
  const expected = /\b([0-9a-f]{64})\b/.exec(line)?.[1];
  if (!file || !expected) continue;
  checked++;
  const full = path.join(root, file);
  if (!fs.existsSync(full)) {
    problems.push(`${file}: ファイルがありません`);
    continue;
  }
  const actual = crypto.createHash("sha256").update(fs.readFileSync(full)).digest("hex");
  if (actual !== expected) problems.push(`${file}: SHA-256が一致しません\n    記載: ${expected}\n    実際: ${actual}`);
  else console.log(`  OK  ${file}`);
}
if (checked === 0) problems.push("THIRD_PARTY_NOTICES.md にSHA-256の記載が見つかりません");

if (problems.length) {
  console.error("  NG\n  " + problems.join("\n  "));
  process.exit(1);
}
console.log(`結果: ${checked} 件一致`);
