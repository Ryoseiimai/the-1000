# THE THOUSAND · LINE Bot

Cloudflare Workers 上で稼働する LINE Messaging API Bot。

- **設計詳細**: [BLUEPRINT.md](./BLUEPRINT.md)
- **殿の手順**: [SETUP.md](./SETUP.md)
- **本体コード**: [worker.js](./worker.js)（約350行・依存ゼロ・stdlibのみ）

## デプロイ（4値到着後の30分手順）

### 前提

- 殿が SETUP.md ステップ1〜6を完走済 → 4値取得済
- Cloudflare アカウント作成済（無料）

### Step 1. wrangler インストール（5分）

```bash
cd "/Users/ryoseiworld/Library/Mobile Documents/iCloud~md~obsidian/Documents/NEW脳みそ/夢/1万円払った1000人 (2026-05-27)/line-bot"
npm install
npx wrangler login   # ブラウザでCloudflareにログイン
```

※ `node` が未導入なら `brew install node` で先に入れる

### Step 2. Secrets 投入（10分）

```bash
npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN     # SETUP.md ステップ3で取得した長期トークン
npx wrangler secret put LINE_CHANNEL_SECRET           # SETUP.md ステップ3で取得したシークレット
npx wrangler secret put ADMIN_LINE_USER_ID            # 殿のLINEユーザーID（初回push後にログから取得）
npx wrangler secret put GITHUB_PAT                    # killers.json更新用PAT（repo scope）
npx wrangler secret put ANTHROPIC_API_KEY             # 自然言語パース用
npx wrangler secret put OPENCHAT_INVITE_URL           # SETUP.md ステップ6
```

### Step 3. デプロイ（2分）

```bash
npx wrangler deploy
```

→ `https://the-1000-bot.<your-subdomain>.workers.dev` が払い出される。

### Step 4. LINE Webhook URL 登録（1分）

LINE Developers Console → 該当チャネル → **Messaging API設定** → **Webhook URL**:

```
https://the-1000-bot.<your-subdomain>.workers.dev/webhook
```

「検証」ボタン → **200 OK** → **Webhook利用 ON** → 完了。

### Step 5. ADMIN_LINE_USER_ID 取得（初回のみ）

1. 殿の個人LINEで Bot を友だち追加（SETUP.md ステップ5の友だち追加URLから）
2. Bot に「help」と送る
3. `npx wrangler tail` でログを開き、`source.userId` をコピー
4. `npx wrangler secret put ADMIN_LINE_USER_ID` で投入し直し

これ以降、殿のメッセージは admin として処理される。

## 動作確認

| アクション | 期待挙動 |
|----------|---------|
| 殿が `help` 送信 | コマンド一覧返信 |
| 殿が `状態` 送信 | 現在数・次マイルストーン返信 |
| 殿が `確認 田中太郎 名前OK` 送信 | killers.json更新 + 完了通知 + サイト反映30秒 |
| 殿が `配信 "テスト"` 送信 | 全友だちへBroadcast |
| 殿が `削除 #0004` 送信 | killers.jsonから該当エントリ削除 |
| 一般友だちが「払った」送信 | 自動御礼Reply + 殿に通知push |
| Bot を友だち追加 | Welcomeメッセージ自動Reply |

## ローカル開発

```bash
npx wrangler dev          # http://localhost:8787 で起動
# .dev.vars にローカル用 Secrets を書く（gitignore対象）
```

`.dev.vars` 例:
```
LINE_CHANNEL_ACCESS_TOKEN=xxx
LINE_CHANNEL_SECRET=xxx
ADMIN_LINE_USER_ID=Uxxxxx
GITHUB_PAT=ghp_xxx
ANTHROPIC_API_KEY=sk-ant-xxx
OPENCHAT_INVITE_URL=https://line.me/ti/g2/xxx
```

## トラブルシュート

- **Webhook 検証失敗** → CHANNEL_SECRET の貼り間違い。再投入。
- **killers.json 更新失敗** → GITHUB_PAT の scope 不足。`repo` 権限を確認。
- **メッセが届かない** → Webhook URL の `/webhook` 末尾が抜けてないか確認。
- **Reply token expired** → Webhookから1分以内に応答必須。Cloudflare Workers は通常<10ms。
- **403 from Anthropic** → ANTHROPIC_API_KEY 無効・残高不足。Bot は Claude 不要でも厳密構文で動作する。

## 料金見積もり

| サービス | 想定使用量（1000人運営想定） | 月額 |
|---------|------------------------------|------|
| Cloudflare Workers | < 10万req/月 | 無料 |
| LINE Messaging API | Reply 無制限・Broadcast 月数百通 | 無料〜¥5,000 |
| GitHub API | killers.json更新数十回/月 | 無料 |
| Anthropic API (Haiku) | 数百コール/月（自然言語パース） | < ¥500 |
| **合計** | | **月¥5,000以下** |
