# ストア掲載文の下書き（AMO / Chrome Web Store）

プライバシーポリシーURL: https://sakaaga.github.io/chem-viewer/privacy/ （Pages公開後に実際に開けることを確認してから登録すること）

## 短い説明（132文字以内）
- ja: 選択した化学式・化合物名・SMILESをPubChemで検索し、分子式・分子量・3D構造・危険有害性情報を表示します。
- en: Look up a selected chemical formula, compound name or SMILES on PubChem and view its properties, 3D structure and hazard info.

## 詳細な説明（日本語）
Webページ上で選択した化学式（H2O、C6H12O6、CuSO4·5H2O など）・化合物名・SMILES記法を、化合物データベースPubChemで検索して表示します。日本語名（例: アスピリン）でも検索できます。

主な機能
- 右クリックメニュー、またはショートカット（Ctrl+Shift+8 / Mac は Command+Shift+8）で解析
- 分子式・分子量・SMILES・InChIKey・CAS登録番号・別名の表示
- 3D構造と2D構造画像の切り替え
- 危険有害性情報（GHS）の表示と日本語訳
- 英語⇄日本語の表示切り替え、モル計算、検索履歴
- （任意・初期設定はオフ）ページ内の化学式をうっすらハイライトし、クリックで検索

データの送信について
- 入力または選択して実行した文字列（最大200文字）をPubChem（米国国立生物工学情報センター）に送信します。見つからない場合は日本語名の検索のためWikidataにも送信します。
- ハイライト機能をオンにした場合のみ、クリックした化学式をPubChemに送信します（ホバーだけでは送信しません）。
- Cookieは送信しません。開発者のサーバーはなく、広告・解析・トラッキングは含みません。
- 検索履歴は端末内にのみ保存され、プライベートウィンドウでは保存しません。

ご注意
- 危険有害性情報（GHS）はPubChemが集約した情報の参考表示であり、公式の安全データシート（SDS）の代替ではありません。取り扱いの際は必ず一次情報をご確認ください。日本語訳は厚生労働省の仮訳に基づく簡易辞書です。
- 日本語名検索はWikidataのデータに依存するため、収録されていない化合物は見つかりません。

## Description (English)
Select a chemical formula (H2O, C6H12O6, CuSO4·5H2O ...), a compound name or a SMILES string on any web page and look it up on PubChem. Japanese compound names are supported too.

Features
- Right-click menu or keyboard shortcut (Ctrl+Shift+8 / Command+Shift+8 on Mac)
- Formula, molecular weight, SMILES, InChIKey, CAS number and synonyms
- Switch between a 3D model and a 2D structure image
- GHS hazard statements, with Japanese translation
- English/Japanese display toggle, molar calculator, search history
- (Optional, off by default) subtle highlighting of formulas on pages; click one to look it up

Data sent
- The text you type, or select and analyze (up to 200 characters), is sent to PubChem (U.S. National Center for Biotechnology Information). If nothing is found, it is also sent to Wikidata as a Japanese-name lookup.
- Only if you enable page highlighting: the formula you click is sent to PubChem (hovering sends nothing).
- No cookies are sent. There is no developer server, and no ads, analytics or tracking.
- Search history stays on your device and is not saved in private windows.

Notes
- Hazard (GHS) information is shown for reference only, as aggregated by PubChem. It is not a substitute for an official Safety Data Sheet (SDS).
- Japanese-name search depends on Wikidata coverage.

## Chrome Web Store「プライバシー」欄の下書き
- 単一用途: 選択・入力した化学式や化合物名をPubChemで検索し、結果を表示する
- 申告するデータ: ユーザーが入力した検索語（ユーザーのアクティビティ／ウェブサイトのコンテンツに相当するもの。ダッシュボードの選択肢に合わせて選ぶ）
- 権限の理由:
  - contextMenus: 右クリック「化学式として解析」
  - storage: 履歴・設定の保存、選択テキストの一時受け渡し
  - activeTab + scripting: ショートカット実行時に、そのタブの選択テキストだけを取得
  - sidePanel: サイドパネル表示
  - host: pubchem.ncbi.nlm.nih.gov（検索・構造データ）、www.wikidata.org（日本語名の検索・逆引き）
  - optional host（<all_urls>）: ハイライトを有効にした場合のみ実行時に許可を求める
- リモートコード: なし
- 「データを販売しない」「無関係な目的に使用しない」「信用度や融資に使用しない」: すべて該当せず（認証チェックを入れる）

## AMO
- `data_collection_permissions` は manifest に宣言済み（searchTerms, websiteContent）
- ソースコード提出: このリポジトリ（`node build.mjs`、REVIEWER_NOTES.md 参照）
