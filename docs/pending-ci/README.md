# pending-ci（導入待ちのCI・スキャナ設定）

ここにあるのは、**検証済みだが、まだ有効化していない**CI・セキュリティスキャナの設定です。
`.github/workflows/` 配下のファイルをpushするには、GitHubのトークンに **Workflows: Read and write**
権限（Classicなら `workflow` スコープ）が必要なため、いったんここに退避しています。この場所にある間は何も実行されません。

## 有効化の手順（トークンに権限が付いたら）

```
mkdir -p .github
git mv docs/pending-ci/workflows   .github/workflows
git mv docs/pending-ci/codeql      .github/codeql
git mv docs/pending-ci/dependabot.yml .github/dependabot.yml
git rm docs/pending-ci/README.md
git commit -m "ci: enable CI, CodeQL, Dependabot, dependency review and release workflows"
git push origin main
```

その後、Actionsタブで初回のCI・CodeQLの結果を確認し、失敗や検出があれば対処してください。
有効化できたら、この `docs/pending-ci/` と `HANDOFF.md` の該当箇所を更新してください。

## 検証状況
- `actionlint` 1.7.12 で全ワークフローが問題なし
- Actionsは**コミットハッシュで固定**（各行の末尾コメントがバージョン）。更新はDependabotに任せる
- CIと同じ手順（`npm ci` → `npm run all`、`node build.mjs`、addons-linter 10.14.0 + `scripts/check-amo-lint.mjs`）は、ローカルで通過済み
- GitHub上での実行は未確認（Node 24でjsdomが動くか等は、初回CIで分かる）
