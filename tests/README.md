# tests

`chem-viewer`（リポジトリ直下）の動作を、ブラウザもネットワークも使わずに検証するテストです。配布物には含まれません。

```
cd tests
npm ci
npm run all
```

| コマンド | 内容 | 所要時間 |
|---|---|---|
| `npm run unit` | 通信層・化学式判定・履歴・日本語名検索/GHS和訳（偽のfetchで検証） | 数秒 |
| `npm run bg` | background.js の問い合わせ受付・更新時の再登録 | 数秒 |
| `npm run integrity` | `libs/` の同梱ライブラリが、`THIRD_PARTY_NOTICES.md` のSHA-256と一致するか | 1秒未満 |
| `npm run dom` | content.js を jsdom 上で実行（大きなページ・動的ページ・ファジング） | 約1分 |
| `npm run all` | 上記をすべて実行（CIが実行するのはこれ） | 約1分 |
| `npm run check` | 実ブラウザ(Chromium)で検索フローを確認。要 `node build.mjs` と `npx playwright install chromium`、PubChemへの実通信あり。CIでは実行しない | — |

一部だけ実行: `ONLY="400段落" node dom.mjs`

## 補足
- `dom.mjs` は jsdom（ブラウザ相当のDOM実装）で動かすため、本物のFirefox/Chromeでの確認の代わりにはなりません。
- ファジングテストは60件に抑えています。各ページ単体では3秒以内に収束することを確認済みで、`content.js` 自体に無限ループはありません。
  大量のJSDOMウィンドウを連続生成すると、テスト環境側が徐々に重くなるためです。
