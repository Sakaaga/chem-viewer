# Third-party notices / サードパーティ表記

本拡張機能は、以下のライブラリを**無改変のまま**同梱しています（`libs/`）。
取得元は公式npmパッケージで、SHA-256が公式配布物と一致することを確認済みです。

| ファイル | パッケージ | バージョン | ライセンス | SHA-256 |
|---|---|---|---|---|
| `libs/3Dmol-min.js` | [3dmol](https://www.npmjs.com/package/3dmol) | 2.5.5 | BSD-3-Clause（`libs/LICENSE-3Dmol.txt`, `libs/3Dmol-min.js.LICENSE.txt`） | f7cc78921ae72e7623e89cdd111434f58c2efddd2ffda1cd212644b406fb8016 |
| `libs/browser-polyfill.min.js` | [webextension-polyfill](https://www.npmjs.com/package/webextension-polyfill) | 0.12.0 | MPL-2.0（`libs/LICENSE-webextension-polyfill.txt`）。ソース: https://github.com/mozilla/webextension-polyfill | 918ed891c0e7f9b58b39ac32c9c3133eb2a1fbaaa27f4aa7579ae55e7572cc21 |

## 取得手順（再現方法）
```
npm install 3dmol@2.5.5 webextension-polyfill@0.12.0
cp node_modules/3dmol/build/3Dmol-min.js                    libs/3Dmol-min.js
cp node_modules/3dmol/build/3Dmol-min.js.LICENSE.txt        libs/3Dmol-min.js.LICENSE.txt
cp node_modules/3dmol/LICENSE                               libs/LICENSE-3Dmol.txt
cp node_modules/webextension-polyfill/dist/browser-polyfill.min.js libs/browser-polyfill.min.js
cp node_modules/webextension-polyfill/LICENSE               libs/LICENSE-webextension-polyfill.txt
```

## 補足（審査向け）
- `3Dmol-min.js` には、文字列のコールバックを受け取った場合にのみ実行される `eval` が1箇所（`makeFunction`）含まれます。本拡張機能はそのAPIを一切呼び出さず（文字列コールバックを渡さない）、MV3の既定CSP（`unsafe-eval` なし）下では実行できません。
- 同ライブラリにはPDB/PubChem等からデータを取得する補助関数が含まれますが、本拡張機能からは呼び出していません（構造データの取得は `pubchem.js` のみが行います）。

## 検証メモ
Firefox版は `addons-linter`（AMOと同じ検証ツール）でエラー0・通知0、警告は上記 `eval` の1件のみです。
