# LM Studio Local Chat Frontend

LM Studio の OpenAI 互換 API (`/v1`) に接続するシンプルな Web チャット UI です。
会話履歴は `localStorage` に保存されます。

LM Studio内でチャットできるので特に意味はないけど、ものは試しで作ったものです。

## 使い方

1. LM Studio でローカルサーバーを起動
   - 例: `http://127.0.0.1:1234`
   - OpenAI 互換 API を有効化
2. このディレクトリでアプリサーバーを起動
   - `node server.js`
3. ブラウザで `http://localhost:5173` を開く
4. Base URL はデフォルトの `/api/v1` のまま使う
5. Model を入力（または `Load Models` で取得）
6. チャット送信

## 主な機能

- 会話履歴の保存（ブラウザの `localStorage`）
- 会話の新規作成、切り替え、名前変更（ダブルクリック）、削除
- 全履歴クリア
- システムプロンプト指定
- モデル一覧取得 (`GET /v1/models`)
- チャット送信 (`POST /v1/chat/completions`)
- 同一オリジンプロキシ (`/api/v1`) で CORS 回避

## 注意

- `file://` で直接 `index.html` を開くと CORS や fetch 制約で失敗することがあります。必ずローカルサーバー経由で開いてください。
- 履歴はブラウザローカル保存です。端末やブラウザを跨いだ共有はしません。

## LM Studio の接続先を変更する

`LM_STUDIO_BASE` 環境変数でプロキシ先を変更できます。

例:

```bash
LM_STUDIO_BASE=http://127.0.0.1:2233/v1 node server.js
```
