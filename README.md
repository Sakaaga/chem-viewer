# 化学式ビューア（Firefox / Chrome）

[![CI](https://github.com/Sakaaga/chem-viewer/actions/workflows/ci.yml/badge.svg)](https://github.com/Sakaaga/chem-viewer/actions/workflows/ci.yml)
[![CodeQL](https://github.com/Sakaaga/chem-viewer/actions/workflows/codeql.yml/badge.svg)](https://github.com/Sakaaga/chem-viewer/actions/workflows/codeql.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

選択した化学式・化合物名・SMILES記法を [PubChem](https://pubchem.ncbi.nlm.nih.gov/) で検索し、分子式・分子量・SMILES・InChIKey・別名・危険有害性情報（GHS）・3D構造／2D構造画像を表示するブラウザ拡張機能です。

#### この拡張機能・リポジトリは実験段階です。一般環境でのご利用はお勧めしません。/This extension and repository is in the experimental stage. It is not recommended to use it in a general environment.

## ビルドと読み込み

ブラウザごとに必須のマニフェスト設定が異なるため（Chrome: `sidePanel`権限 / Firefox: `data_collection_permissions` 等）、
マニフェストはブラウザ別に分け、`build.mjs` で配布物を生成します（依存パッケージなし、Node.js 18+）。

```
node build.mjs
```

`dist/firefox/`・`dist/chrome/` と、それぞれのzipが生成されます。生成時に、マニフェストが参照するファイルの実在・HTMLのscript参照・
インラインイベントハンドラの有無・JS構文・日英ロケールのキー整合を自動検査します。

- **Firefox**（140以上）: `about:debugging#/runtime/this-firefox` →「一時的なアドオンを読み込む…」→ `dist/firefox/manifest.json`
- **Chrome**（116以上）: `chrome://extensions` → デベロッパーモードON →「パッケージ化されていない拡張機能を読み込む」→ `dist/chrome`

## 主な機能

- テキスト選択→右クリック、またはショートカット（既定 `Ctrl+Shift+8` / Mac `Command+Shift+8`）で解析
- 化合物名・分子式・SMILES記法での検索、検索履歴（保存・再検索・JSON書き出し・消去）
- **日本語名での検索**（例: 「アスピリン」）。PubChemの名前・分子式検索で見つからない場合に、Wikidataで日本語ラベルからPubChem CIDを逆引きします
- **英語⇄日本語の表示切り替え**（ヘッダーのトグルボタン）。化合物名はWikidataの日本語ラベル、GHS危険性情報は厚生労働省のH分類仮訳に基づく固定辞書で翻訳表示します
- 分子式・分子量・SMILES・InChIKey・**CAS登録番号**・別名・GHS危険有害性情報（控えめな折りたたみ表示）
- **詳細情報**（折りたたみ）: 正確質量・XLogP・TPSA(極性表面積)・水素結合供与数/受容数
- **モル計算**: 分子量が分かっている化合物について、質量(g)から物質量(mol)を即座に換算
- 分子式検索で**複数の異性体候補**が見つかった場合、ドロップダウンで切り替え表示
- 反応式の係数（`2H2O`）・水和物（`CuSO4·5H2O`）・重水素/三重水素（`D2O`）にも対応（検索欄・選択検索）
- 3Dモデル ⇄ 2D構造画像の切り替え（構造データが取得できない場合は2D画像を自動表示）
- ポップアップ／サイドパネル（Chrome）／サイドバー（Firefox）、ダークモード、日本語・英語UI
- （任意・既定OFF）ページ内の化学式をうっすらハイライトし、**クリックすると選択検索と同じようにポップアップで結果を表示**（ホバーだけでは通信は発生しません）。下付き数字（`H₂O` のUnicode表記、`H<sub>2</sub>O` のHTMLタグ表記、Wikipediaなどで見られる `C 6H 12O 6` のような要素記号直後の空白入り表記）にも対応。検索欄・選択検索でも、`H₂O` や全角 `Ｈ２Ｏ`、空白区切りの `Fe 2 O 3` のような表記を通常の `H2O` / `Fe2O3` として検索

### ページ内ハイライトが効かないとき
F12 →「コンソール」で `Chem Viewer:` から始まるメッセージを確認してください。`failed to initialize` / `skipped a node` は処理中の例外、`reached the highlight limit` は上限到達を示します。設定を変えたあとは、開いているタブの再読み込みが必要です。

## 権限とその理由

| 権限 | 用途 |
|---|---|
| `contextMenus` | 右クリック「化学式として解析」 |
| `storage` | 履歴・設定の保存、選択テキストの一時受け渡し（`storage.session`） |
| `activeTab` + `scripting` | ショートカット実行時に、**そのタブの**選択テキストだけを取得 |
| `host_permissions: pubchem.ncbi.nlm.nih.gov` | 検索・構造データ取得 |
| `host_permissions: wikidata.org` | 日本語名検索・日本語名の逆引き（表示言語を日本語にした場合） |
| `optional_host_permissions: <all_urls>` | ページ内ハイライトを**有効にした場合のみ**、実行時に許可を求める（既定では要求しない） |
| `sidePanel`（Chromeのみ） | Chromeのサイドパネル表示 |

`content_scripts` は宣言していません。ページ内ハイライトのスクリプトは、設定でONにして権限が許可された場合にのみ
`scripting.registerContentScripts` で登録され、OFFにすると登録も権限も自動的に外れます。

## データの扱い

詳細は [PRIVACY.md](PRIVACY.md)。要点:

- 外部に送るのは、ユーザーが入力・選択して実行した文字列（最大200文字）と、ハイライトを**クリックした**文字列のみ。送信先はPubChemだけ
- Cookie・Referrerは送信しない（`credentials: "omit"` / `referrerPolicy: "no-referrer"`）
- 開発者のサーバーは存在せず、解析・広告・トラッキングも含まない
- 履歴と設定は端末内のみ。プライベートウィンドウでは履歴を保存しない。選択テキストの受け渡しはメモリ上の`storage.session`のみで、1分で失効

## セキュリティ設計の要点

- 外部由来の値（APIの応答・ストレージの中身）は`textContent`／数値検証を経てのみ画面やURLに反映（`innerHTML`は空文字での初期化のみ）
- 画像・URLに使うCIDは正の整数であることを検証
- ページ内ハイライトは、ページ側スクリプトが発火した合成イベント（`isTrusted=false`）では通信しない。化学式文字列はDOM属性ではなくクロージャに保持（ページによる書き換えの影響を受けない）
- ページ内のスクリプト（content script）は**PubChemへ直接通信しません**。閲覧中のページのCORS/CSPの制限を受けて失敗するため、問い合わせはバックグラウンドへのメッセージで依頼します。バックグラウンド側は、設定がONで、かつ化学式として文法的に妥当な文字列だけを受け付けます（任意の文字列を第三者へ送らない）
- 通信のタイムアウトは本文の読み込み完了まで有効。429/5xxは「見つからない」ではなく「サーバー混雑」と表示
- 全リクエストを単一キューで間引き（最短250ms間隔）。PubChemの「秒間5リクエスト以内」に合わせている
- インラインスクリプト・外部スクリプト・リモートコードなし（ビルド時に自動検査）

## 既知の制限

- PDFビューア内では選択検出・ハイライトが動作しません
- ハイライトは**元素記号として実在するもので構成され、数字か括弧を含む**式のみが対象です（`NaCl`は対象外）。それでも `USB3` `B2B` `PS4` のような元素記号だけで構成された語は誤検出されます（クリックしない限り通信は発生しません）
- 下付き数字は、`<sub>` が元素記号と**同じ親要素の直下**にある形（`H<sub>2</sub>O`）とUnicode下付き（`H₂O`）に対応しています。元素記号を `<span>` 等で個別に包んでいる、リンクや`<code>`の内部にある、といった形は検出しません
- ページ内ハイライトは既存ページのDOMを書き換えるため、一部のWebアプリ（仮想DOMを使うもの）と干渉する可能性があります。リンク・ボタン・コード表記の内部、1ページ3000件超は対象外です（上限に達するとコンソールに `Chem Viewer: reached the highlight limit` と出ます）。処理は時間で区切って進めるため、長いページでは下の方が少し遅れてハイライトされます。動的に書き換わるページ（React等）にも追従しますが、フレームワークが内容を作り直すたびに付け直します。iframeの内側は対象外です。空白入り表記は「要素記号の直後」のみ対応しており、`U 2`のような1原子だけの表記は誤検出防止のため対象外です
- 分子式での検索は、複数の異性体候補が見つかった場合はドロップダウンで切り替えられますが、初期表示はPubChemが返す先頭1件です
- **GHS情報は参考表示です。** PubChemが集約した情報をそのまま表示しており、公式のSDSの代替ではありません。取り扱いの際は必ず一次情報を確認してください。日本語訳も厚生労働省の仮訳に基づく簡易辞書であり、法的な正式文書ではありません
- 2D構造画像はPubChemのPNGをそのまま読み込みます。存在しない場合は代替メッセージを表示します
- 対応言語は日本語・英語のみ（それ以外の環境では日本語にフォールバック）
- `action.openPopup()` は Firefox 118+ / Chrome 127+ のみ。非対応の場合はバッジ「!」をクリックしてください
- **日本語名検索はWikidataのデータに依存します。** Wikidataに化合物の項目が無い、またはPubChem CID（P662）が登録されていない場合は見つかりません。収録範囲はPubChem自体の英語名に比べて限定的です
- 重水素/三重水素（D/T）表記は、ページ内自動ハイライトでは誤検出（`HTTP2``COVID19`等）を避けるため**無効**にしています。検索欄・選択検索でのみ利用できます
- 水和物（`CuSO4·5H2O`）はPubChemへの問い合わせ用に原子数を展開した式（例: `CuH10O9S`）に変換しますが、変換後の式に一致する化合物がPubChem上に存在しない場合は見つかりません

## ストア提出に向けて（作業メモ）

コードだけでは満たせない、提出時の作業です。

**共通**
- 掲載ページの説明文に「入力・選択した文字列をPubChemに送信する」旨を明記する
- `PRIVACY.md` を公開URL（GitHub Pages等）に置き、そのURLをストアのプライバシーポリシー欄に登録する
- GHS情報が参考表示であること（SDSの代替ではない）を説明文にも書く

**Firefox（AMO）**
- `data_collection_permissions`（必須）を宣言済み: `searchTerms`（入力した検索語）と`websiteContent`（ページ上で選択・クリックした文字列）。新規拡張は未設定だと提出が拒否されます
- 上記のため `strict_min_version` は `142.0` です。`data_collection_permissions` をデスクトップ（140〜）とAndroid（142〜）の両方が認識できる最小版に合わせており、AMOの検証で出る「Android版の最低バージョン」警告を避けています。Androidは右クリックメニュー・サイドバー・ショートカットがないため、実質的にデスクトップ向けです
- ハイライトをクリックしたときのポップアップ自動表示は、右クリックメニュー・ショートカットと同じ`browser.action.openPopup()`を使っています。ブラウザによってはメッセージ経由の呼び出しでユーザー操作とみなされず失敗することがあり、その場合はツールバーのバッジから開く案内を表示します
- `browser_specific_settings.gecko.id` は GUID（`{76ac8e19-a318-485f-aa10-fced234a3292}`）に確定済みです。**公開後は変更できず、変更すると別の拡張機能として扱われる**ため、このIDは控えて今後も変えないでください
- ソースコード提出: 本リポジトリ（`build.mjs`・両マニフェスト・`THIRD_PARTY_NOTICES.md`を含む）をそのまま提出できます。`libs/`は公式パッケージの無改変コピーで、取得手順とSHA-256は `THIRD_PARTY_NOTICES.md` に記載

**Chrome（Chrome Web Store）**
- 2026年8月1日施行のポリシー更新により、目的に直接関係するかを問わず、収集・送信するデータの開示が求められます。Developer Dashboardの「プライバシー」欄で、送信するデータ（ユーザー入力の検索語・ウェブサイトのコンテンツ）を申告してください
- `sidePanel`権限はChromeのサイドパネルに**必須**です（公式ドキュメントで確認）

**ショートカットの重複について**: `chrome.commands` の公式サンプルが `Ctrl+Shift+Y` を使っているため、別の拡張と衝突しやすい傾向があり、既定を `Ctrl+Shift+8` にしています。それでも他の拡張と重複した場合は、後から入れた側が通知なしに無効化されます。`chrome://extensions/shortcuts`（Chrome）／`about:addons`の「ショートカットを管理」（Firefox）で確認できます（設定画面にも記載）。

## ファイル構成

```
manifest.firefox.json / manifest.chrome.json … ブラウザ別マニフェスト
build.mjs            … dist/ の生成と自動検査
background.js        … 右クリック／ショートカット処理
pubchem.js           … PubChem通信・スロットリング・履歴・設定（共通ロジック）
formula.js           … 化学式の文法チェック（元素記号の実在検証）
app.js               … 検索UI（popup / sidepanel 共通）
content.js           … ページ内ハイライト（設定でON時のみ動的に登録。通信はせず、問い合わせはbackground.jsへ依頼）
highlight-sync.js    … ハイライト用スクリプトの登録・解除（設定画面と、更新時の再登録で共用）
i18n.js              … data-i18n属性の自動翻訳（拡張機能の自ページ専用）
options.html/js      … 設定画面
popup.html / sidepanel.html / panel.css
_locales/ja, en      … UI文言
libs/                … 3Dmol.js, webextension-polyfill（無改変・ライセンス同梱）
PRIVACY.md / THIRD_PARTY_NOTICES.md
```

## 開発とCI（GitHub）

```
npm test            # tests/ の依存を入れて、全テストを実行（Node.js 22以上）
node build.mjs      # dist/firefox, dist/chrome とzipを生成（検査つき）
```

| ワークフロー | 内容 |
|---|---|
| `ci.yml` | push・PRごとに、テスト（Node 22/24）、ビルド検査、AMO検証ツール（addons-linter）。想定外の警告・エラーがあれば失敗します（許可しているのは3Dmol.js内の`eval`警告のみ） |
| `codeql.yml` | CodeQL（`security-extended`）によるJavaScriptの静的解析。毎週月曜にも自動実行。圧縮済みの`libs/`は対象外 |
| `dependency-review.yml` | PRで、高い深刻度の脆弱性を含む依存関係の追加を検出 |
| `release.yml` | `v0.3.0` のようなタグをpushすると、タグとmanifestの版数が一致することを確認し、テスト後にFirefox用・Chrome用・ソースのzipをReleaseへ添付 |
| Dependabot | GitHub Actions（コミットハッシュ固定のまま更新）とテスト用npm依存を毎週更新 |

- Actionsはタグではなく**コミットハッシュで固定**しています（タグの付け替えによる乗っ取り対策）。更新はDependabotのPRで行います
- 同梱ライブラリ（`libs/`）は`tests/integrity.mjs`がSHA-256で毎回検証し、意図しない改変を検出します
- シークレットスキャン（プッシュ保護つき）と、脆弱性の非公開報告（[SECURITY.md](SECURITY.md)）を有効にしています

### リリース手順
1. `manifest.firefox.json` と `manifest.chrome.json` の `version` を同じ値に上げる
2. `git tag v0.3.1 && git push origin v0.3.1`
3. Releaseに添付されたzipを、各ストアへ提出する（提出作業は「ストア提出に向けて」を参照）

## ライセンス

本体は [MIT](LICENSE)。同梱ライブラリは別ライセンスです（[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)）。

## 引き継ぎ

未解決の問題・未検証事項・設計メモ・引き継ぎ手順は [HANDOFF.md](HANDOFF.md) を参照してください。
