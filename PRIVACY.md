# プライバシーポリシー / Privacy Policy

## 日本語

**化学式ビューア**（以下「本拡張機能」）は、ユーザーが指定した化学式・化合物名・SMILES記法を、化合物データベース **PubChem**（`pubchem.ncbi.nlm.nih.gov`、米国国立生物工学情報センター運営）に問い合わせて結果を表示します。日本語名での検索、および表示言語を日本語に切り替えた場合には、**Wikidata**（`wikidata.org`、Wikimedia財団が運営する公開データベース）にも問い合わせます。

### 外部に送信される情報
- ユーザーが検索欄に入力した文字列、または選択して「解析」を実行した文字列（最大200文字）。PubChemの英語名・分子式検索で見つからない場合、同じ文字列をWikidataにも送って日本語名としての検索を試みます
- 表示言語を日本語に切り替えた場合、直前に表示していた化合物のPubChem CID（整数のID番号）をWikidataに送り、日本語名を逆引きします
- （任意機能「ページ内ハイライト」を有効にした場合のみ）ユーザーが**クリックした**化学式らしき文字列
- 通信は HTTPS で行われ、送信先には通信に伴うIPアドレス等が通常のWebアクセスと同様に届きます。Cookieは送信しません（`credentials: "omit"`）

### 送信しない情報
閲覧中のページのURL・タイトル・本文全体、閲覧履歴、個人を特定する情報、利用状況の統計・解析データ。本拡張機能は開発者のサーバーを持たず、開発者への送信は一切行いません。広告・トラッキング・アナリティクスも含みません。

### 端末内に保存される情報
- 検索履歴（最大件数は設定で変更可、既定20件）と設定値：ブラウザのローカルストレージ（`storage.local`）にのみ保存され、外部へ送信されません
- プライベートウィンドウ/シークレットモードでは検索履歴を保存しません
- 右クリック/ショートカットで渡された選択テキストは、メモリ上の一時領域（`storage.session`）に1分以内だけ保持されます

### データの削除
ポップアップの「消去」ボタンで履歴を削除できます。拡張機能を削除すると、保存データもすべて削除されます。

### 表示される情報について
危険有害性情報（GHS）などはPubChemが集約した情報をそのまま表示する参考情報であり、公式の安全データシート（SDS）の代替ではありません。

---

## English

**Chem Viewer** looks up chemical formulas, compound names and SMILES strings that you specify on **PubChem** (`pubchem.ncbi.nlm.nih.gov`, operated by the U.S. National Center for Biotechnology Information) and displays the result. When you search by a Japanese compound name, or switch the display language to Japanese, it also queries **Wikidata** (`wikidata.org`, a public database operated by the Wikimedia Foundation).

### Data sent to a third party
- The text you type into the search box, or select and choose "Analyze" (up to 200 characters). If PubChem's English name/formula search finds nothing, the same text is also sent to Wikidata as a Japanese-name lookup
- When you switch the display language to Japanese, the PubChem CID (an integer ID number) of the compound you were just viewing is sent to Wikidata to look up its Japanese label
- (Only if you enable the optional page-highlight feature) the formula-like text that you **click** on a page
- Requests use HTTPS; the destination receives the usual network metadata such as your IP address. No cookies are sent (`credentials: "omit"`)

### Data NOT sent
The URL, title or content of the pages you browse, your browsing history, personally identifying information, or usage analytics. The extension operates no server of its own and sends nothing to the developer. It contains no ads, tracking or analytics.

### Data stored on your device
- Search history (up to a configurable limit, default 20) and settings are stored only in the browser's local storage and are never transmitted
- Search history is not saved in private/incognito windows
- Selected text passed via the context menu / shortcut is kept in memory (`storage.session`) for at most one minute

### Deleting data
Use the "Clear" button to delete history. Uninstalling the extension removes all stored data.

### About displayed information
Hazard (GHS) information is shown as aggregated by PubChem for reference only and is not a substitute for an official Safety Data Sheet (SDS).
