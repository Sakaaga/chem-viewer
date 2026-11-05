# 引き継ぎメモ（HANDOFF）

このプロジェクトの作業を、別のChat・別の担当者が引き継ぐための資料です。**作業のたびに更新してください。**
（作業用のサンドボックスは途中で何度もリセットされ、手元のファイルが消えます。正本は常にこのGitHubリポジトリです。）

最終更新: 2026-11-06

## 0. 引き継いだら最初にやること
1. リポジトリを取得（公開リポジトリなのでトークン不要）: `git clone https://github.com/Sakaaga/chem-viewer.git`
2. このファイルと `README.md` を読む
3. 現状確認: `cd tests && npm ci && npm run all`（すべて通るはず）、`node build.mjs`
4. 「3. 未解決・未着手」から、ユーザーに**どれを進めるか確認**する（勝手に直さない。下記の理由を参照）
5. 作業したら、このファイルの「3」を更新してコミット・pushする

## 1. プロジェクトの概要
- **化学式ビューア（Chem Viewer）**: Firefox / Chrome 用ブラウザ拡張（Manifest V3）。v0.3.0（未リリース・未提出）
- 選択・入力した化学式／化合物名（日本語名も可）／SMILES を **PubChem** で検索し、分子式・分子量・SMILES・InChIKey・CAS番号・別名・GHS危険有害性情報（日本語訳つき）・3D構造／2D画像を表示する
- 日本語名検索と日本語表示は **Wikidata** 経由（外部送信先は PubChem と Wikidata のみ）
- ページ内の化学式のハイライト（任意・既定OFF）。クリックすると選択検索と同じ経路でポップアップに結果を出す
- GitHub: https://github.com/Sakaaga/chem-viewer （公開・MIT・既定ブランチ main）
- 開発者の方針: **Firefoxを優先**して開発し、Chromeにも対応。AMO（Firefox）と Chrome Web Store への提出を目指す

## 2. 開発の進め方
```
node build.mjs                    # dist/firefox, dist/chrome とzip（構文・ロケール・参照ファイル等の自動検査つき）
cd tests && npm ci && npm run all # テスト58件（unit 35 + bg 7 + dom 16）＋ 同梱ライブラリ2件のSHA-256検査
npm run check                     # 実Chromiumでの確認（要 playwright install。PubChemへ実通信。CIでは実行しない）
```
- Node.js 22 以上。依存パッケージは tests/ 内のみ（配布物は依存ゼロ）
- 読み込み: Firefox は `about:debugging#/runtime/this-firefox` → `dist/firefox/manifest.json`、Chrome は `chrome://extensions` → `dist/chrome`
- **コミット前の注意**: リポジトリは公開。トークン・個人のメールアドレスを入れない（コミットはGitHubのnoreplyアドレスを使用）
- **トークンの扱い**: ユーザーがチャットにPATを貼ることがある。保存せず、使い終わったら削除してもらう。強制push（`--force`）はしない
- 作業環境の注意: シェルは `sh` で、bash配列が使えないことがある（`bash -c '...'` を使う）。外部通信はgithub.com・npm・pypi等に限られ、**PubChem・Wikidataへは届かない**（そのため実APIでの確認は一度もできていない）

## 3. 未解決・未着手（優先度順）
> 3-1は2026-11-06にユーザーの指示で修正した。以降の項目も、着手前にユーザーに確認すること。

### 3-1. 既知の不具合

- **SMILES欄が「-」になる不具合: 修正済み（2026-11-06）。実サーバーでの確認のみ未了**
  - 原因: PubChemがSMILES系のプロパティ名を改名した（`CanonicalSMILES` を要求すると応答キーは `ConnectivitySMILES`、`IsomericSMILES` は `SMILES`）
  - 対応: `pubchem.js` の `fetchProperties` が `SMILES` → `ConnectivitySMILES` → `CanonicalSMILES` → `IsomericSMILES` の順で最初の非空文字列を `props.smiles` に正規化（無ければ `null`）。`app.js` は `props.smiles` を表示。要求するプロパティ名は従来どおり `CanonicalSMILES`（旧名のエイリアスが効く前提。実応答は未確認なので、実機で確認すること）
  - テスト: `tests/unit.mjs` に「[SMILES系プロパティ名の改名への対応]」2件を追加（修正前は失敗することを確認済み）
  - 残り: 実PubChemで、SMILES欄に値が入ることを確認する（3-3 参照）

### 3-2. 導入待ち（権限待ち）
- **CI・CodeQL・Dependabot・Dependency review・リリース自動化は未導入**。設定は検証済みで `docs/pending-ci/` に退避してある（有効化の手順は `docs/pending-ci/README.md`）
  - 必要なもの: ユーザーのGitHubトークンに **Workflows: Read and write** 権限（Fine-grainedトークンは設定画面で後から編集でき、文字列は変わらない）
  - 有効化後、初回のCI・CodeQLの結果を確認して対処する。`README.md` の CI/CodeQL バッジと「開発とCI」の節は、この有効化までは実態と合っていない
- 適用済みのリポジトリ設定: シークレットスキャン＋プッシュ保護、Dependabotアラートと自動更新、脆弱性の非公開報告、Actions既定権限=読み取りのみ、mainの強制push/削除の禁止、wiki/projects無効、マージ後ブランチ自動削除

### 3-3. 未検証（実機・実サーバーで一度も確認していない）
- 実際のFirefox/Chromeでの動作全般（これまでの検証はjsdomと偽fetchのみ）。特に: ハイライトをクリックしたときのポップアップ自動表示（`action.openPopup()`）、全サイト権限の許可フロー、Chromeのサイドパネル、Wikipedia等の実ページでのハイライト
- **Wikidata APIの実通信**（`wbsearchentities` / `wbgetentities` / `list=search` の `haswbstatement:P662=`、CORSの `origin=*`）。仕様は公式ドキュメントに基づくが、実応答は未確認
- PubChemの **GHS（PUG View）パーサ**が、実応答の構造を正しく読めているか
- 分子式検索（`fastformula`）が、水和物を展開した式（例 `CuH10O9S`）や `D2O` を受け付けるか。ローカルでは受理しているが、PubChem側で見つからない可能性がある
- addons-linter は実行済み（エラー0、警告1=3Dmol.js内のevalで既知・対処済み）。ただし実際のAMO審査・Chrome審査は未提出

### 3-4. 提出まわり（未着手）
- ストア掲載文に「入力・選択した文字列をPubChem（と、日本語名検索・日本語表示ではWikidata）に送信する」「GHSは参考表示でSDSの代替ではない」旨を書く
- `PRIVACY.md` を公開URLに置く（GitHub Pages等。未設定）。Chrome Developer Dashboardのプライバシー欄で、送信データ（検索語・ウェブサイトのコンテンツ）を申告
- Firefoxの `browser_specific_settings.gecko.id` は確定済み（`{76ac8e19-a318-485f-aa10-fced234a3292}`）。**公開後は変更不可**。変えない
- 提出用ソースzipは、タグ `vX.Y.Z` をpushすると `release.yml`（導入後）が作る。手動なら `git archive`

### 3-5. 既知の制限・検討中の案
- 既知の制限は `README.md` の「既知の制限」を参照（PDFビューア内は非対応、`B52`/`F16`/`N95` のような「単一元素＋数字」は誤検出が残る、iframe内は対象外 など）
- 検討したが未着手の機能案: サイト別のハイライトON/OFF、3Dビューアのスタイル切替・SDF保存、ローカルキャッシュ、お気に入り／比較、ポップアップを開けない場合のページ内カード表示

## 4. 構成と設計
```
manifest.firefox.json / manifest.chrome.json … ブラウザ別（Chrome: sidePanel権限 / Firefox: data_collection_permissions, strict_min_version 142）
build.mjs        … dist/ 生成と自動検査（参照ファイルの実在、HTMLのscript参照、インラインイベント禁止、JS構文、ja/enキー整合）
background.js    … 右クリック・ショートカット、ハイライトからの問い合わせ受付（chemviewer:analyze）
pubchem.js       … PubChem/Wikidata通信（250msスロットル・タイムアウト・429/5xx判定）、履歴・設定、GHS和訳辞書
formula.js       … 化学式の文法チェックとHill式変換（純粋関数）
content.js       … ページ内ハイライト（通信しない）。設定ON＋権限許可時のみ highlight-sync.js が動的登録
highlight-sync.js… content scriptの登録・解除
app.js / popup.html / sidepanel.html / panel.css … 検索UI（popupとsidepanel共通）
options.html/js, i18n.js, _locales/{ja,en}      … 設定画面・多言語
libs/            … 3Dmol.js, webextension-polyfill（無改変。SHA-256は THIRD_PARTY_NOTICES.md、tests/integrity.mjs が検証）
tests/           … unit / bg / dom（jsdom）/ integrity / verify（実Chromium）
scripts/check-amo-lint.mjs … addons-linterの結果判定（許可する警告は3Dmol.js内のevalのみ）
docs/pending-ci/ … 導入待ちのCI設定
```
- 通信は **background / ポップアップ側のみ**。content script からは直接fetchしない（ページのCORS/CSPで失敗するため、`runtime.sendMessage` でbackgroundへ依頼）
- 選択テキストの受け渡しは `storage.session`（メモリ上、1分で失効）。履歴・設定は `storage.local`。プライベートウィンドウでは履歴を保存しない
- 外部由来の値は `textContent` と数値検証を経てのみ画面・URLに反映（CIDは正の整数であることを確認）。`innerHTML` は空文字の初期化のみ
- 検索の優先順位: 名前 → 分子式（合成済みHill式で問い合わせ、複数候補は先頭＋他候補）→ 日本語名（Wikidata）。SMILESモードはSMILES専用エンドポイントのみ

## 5. 落とし穴（過去に直した不具合。再発させない）
- **`atoms` は「元素トークンの個数」**であって、原子の総数ではない（`O2` は1トークン）。総数にすると `U 2` のような1トークンの式が誤検出される。総数は別途 `counts` に保持している
- **D/T（重水素・三重水素）を自動ハイライトで許可しない**。`V`・`I`・`D`・`T`・`U`・`P`・`F` などが偶然つながって `HTTP2` `COVID19` `UTF8` `HD720` を誤検出する。検索欄・選択検索でのみ許可（`parse(..., { allowIsotopes: true })`）
- `parse()` の `groups()` は、`)` と水和物の区切り（`·` `*`）で**素直に止まる**必要がある。さもないと水和物全体が不正になる
- `CANDIDATE` 正規表現の否定後読みは、直前の**数字を拒否しない**（`2H2O` の係数を拾うため）。英字・アンダースコア・Unicode下付きのみ拒否
- Wikipedia式の空白（`C 6H 12O 6`）は、空白の**位置を記録して**詰め表記を作る（一括除去すると無関係な数字列が結合する）
- ページ内走査は時間で区切り、上限3000件、動的更新（`characterData`・テキストノード追加）に追従。1ノードの例外で全体を止めない
- ファジングテストは60件が上限（jsdomウィンドウを閉じないとテスト環境が重くなる）
- `LICENSE` は**標準のMIT原文のみ**にする（注記を足すとGitHubがライセンスを判定できない）。同梱ライブラリのライセンスは THIRD_PARTY_NOTICES.md に書く
- NFKC正規化は `H₂O` を `H2O` に変換する（`normalizeQuery` の挙動）

## 6. ユーザーが決めたこと
- リポジトリは**公開**、ライセンスは**MIT**、テストは `tests/` フォルダに置く
- ページ内ハイライトは**既定OFF**、**クリックしたときだけ**通信する（ホバーでは通信しない）
- 新規GitHubリポジトリには、コードスキャナ（CodeQL等）を入れる
- Cloudflare無料プラン（Workers・KV・D1・Pages）は許可なく使ってよいが、他のサービスは事前に確認する。設定はコードではなくWebダッシュボードで行う（この拡張機能では未使用）
- 返信・ドキュメントは日本語
