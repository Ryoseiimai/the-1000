# THE THOUSAND · LINE Bot 動作設計

殿の4値（Channel Access Token / Channel Secret / 友だち追加URL / オープンチャット招待URL）が揃った瞬間、家来が即座に配備するBot本体の動作仕様。

---

## アーキテクチャ

```
┌─────────────────────────────────────────────────────────────┐
│ 殿の LINE (個人アカウント)                                   │
│   └─ THE THOUSAND Bot 公式アカウントと1対1                  │
└──────────────────┬──────────────────────────────────────────┘
                   │ 「確認 #0004 田中太郎 名前OK 名簿に夢を書いた」
                   ▼
┌─────────────────────────────────────────────────────────────┐
│ LINE Messaging API                                          │
│   └─ Webhook → Cloudflare Workers                          │
└──────────────────┬──────────────────────────────────────────┘
                   ▼
┌─────────────────────────────────────────────────────────────┐
│ Cloudflare Workers (the-1000-bot.workers.dev)               │
│   ├─ /webhook  : LINE からのイベント受信                    │
│   ├─ /admin    : 殿用テキストコマンド処理                  │
│   └─ /healthz  : 死活監視                                   │
└──────────────────┬──────────────────────────────────────────┘
                   ▼
┌─────────────────────────────────────────────────────────────┐
│ アクション分岐                                               │
│   ┌─ A. killers.json を GitHub API で更新                  │
│   │     → GitHub Pages 自動ビルド (30秒)                   │
│   ├─ B. 入金者（友だち登録者）へ御礼 Reply 送信            │
│   │     → リッチカード「あなたは #0004 として永久に刻まれました」│
│   │     → オープンチャット招待URL                          │
│   ├─ C. オープンチャットへ「新メンバー歓迎」自動投稿       │
│   │     ※公式アカ→オプチャ投稿はAPI制約あり。代替:       │
│   │     殿の手動コピペ用テンプレを Reply で渡す            │
│   └─ D. マイルストーン到達検知                              │
│         (10/20/50/200/500/1000)                            │
│         → 全友だちに Broadcast 告知                         │
│         → リッチカード「第N回オフライン会合 開催！」        │
└─────────────────────────────────────────────────────────────┘
```

---

## 殿のコマンド体系

Bot に1対1で打つテキストでBot制御。**自然言語フォールバック**＋**厳密構文**の二段構え。

### 厳密構文（高速・確実）

```
確認 #0004 田中太郎 名前OK 夢を笑わせない経済を作りたい
```

| 位置 | 意味 | 例 |
|------|------|-----|
| 動詞 | `確認` (入金確認＆名簿追加) | `確認` |
| #ID | 4桁ゼロパディング ID（省略可・自動採番） | `#0004` |
| 名前 | 公開名（匿名希望なら `優しい人`） | `田中太郎` |
| 公開可否 | `名前OK` / `匿名` | `名前OK` |
| 一言（任意） | スペース区切り以降全部 | `夢を笑わせない経済を作りたい` |

### 自然言語フォールバック（Claude API 経由でパース）

```
殿: たなかさん入金確認した、名前公開OK
Bot: 殿、#0004 田中さんを名簿に追加し、御礼メッセを送信いたします。よろしいですか？ [はい/いいえ]
殿: はい
Bot: ✅ #0004 田中さん 反映完了。サイト反映まで30秒。御礼Reply送信済。
```

### その他コマンド

| コマンド | 機能 |
|---------|------|
| `名簿` または `list` | 現在の killers.json を一覧表示 |
| `削除 #0004` | 誤登録のロールバック |
| `編集 #0004 メッセ "夢を見続ける"` | 個別フィールド書き換え |
| `配信 "10人到達！第1回オフライン会合のお知らせ"` | 全友だちへBroadcast |
| `状態` | 現在の登録数・残り枠・次マイルストーン情報 |
| `招待 田中` | 田中宛のオプチャ招待URLを再送 |
| `help` | コマンド一覧 |

---

## 友だち追加時の自動応答

新規友だち登録者（=入金検討中の人）に自動送信:

```
🩸 ありがとうございます。

「1万円払った1000人」へ、ようこそ。
このBotは涼晴の直属の家来です。

ご入金確認後、あなたの名前は #0XXX として
永久に名簿に刻まれます。

【次の手順】
1. 下のPayPayリンク（または銀行振込）で ¥10,000 を払う
2. 払った旨をこのトークに送る（スクショ歓迎）
3. 涼晴が確認次第、御礼メッセと名簿登録の通知が届きます
4. 続いてオープンチャット「THE THOUSAND」への招待URLを送ります

[PayPayで払う]ボタン  [銀行振込口座を見る]ボタン

— THE THOUSAND Bot
```

LINEリッチメニューを下部固定:
- 🎯 PayPayで払う
- 🏦 銀行振込
- 📜 名簿を見る (the-1000.imai-design.github.io)
- 💬 オプチャ参加（入金済の人のみ）
- 🆘 涼晴に直接相談

---

## マイルストーン到達時のBroadcast自動配信

`killers.json` 更新時に長さチェック → `[10, 20, 50, 200, 500, 1000]` 到達時に全友だちへ:

```
🏯 第N回オフライン会合 開催決定！

ついに **NN名** に到達しました。
信用も金もなかった涼晴に、それでも¥10,000を払ってくれた、
NN名の優しい人たち。

【第N回 オフライン会合】
📅 日時: 殿の都合により後日確定
📍 場所: 東京 or タイ・バンコク（参加者投票で決定）
🍶 内容: 顔合わせ・夢の話・乾杯・記念撮影

参加表明は本トークに「参加」とお返事ください。
リモート参加枠も用意します（Zoom併設）。

— THE THOUSAND Bot
```

---

## 環境変数（Cloudflare Workers Secrets）

```bash
wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
wrangler secret put LINE_CHANNEL_SECRET
wrangler secret put GITHUB_PAT_TO_WRITE_KILLERS_JSON
wrangler secret put ADMIN_LINE_USER_ID  # 殿のLINEユーザーID（殿以外のadminコマンドを拒否するため）
wrangler secret put ANTHROPIC_API_KEY   # 自然言語フォールバック用
wrangler secret put OPENCHAT_INVITE_URL
```

`ADMIN_LINE_USER_ID` は初回 Webhook 受信時に Bot が殿の userId をログ出力するので、その値を `wrangler secret put` で固定化。

---

## 配備ファイル構成（家来が一気に作る）

```
line-bot/
├── SETUP.md              ★ 既存（殿の30分手順）
├── BLUEPRINT.md          ★ 既存（このファイル・Bot設計）
├── worker.js             ❒ 殿4値後・家来配備（Webhook処理・Claude/GitHub API連携）
├── wrangler.toml         ❒ Cloudflare Workers デプロイ設定
├── package.json          ❒ dependencies（@line/bot-sdk, @octokit/rest）
├── rich-menu.json        ❒ LINE リッチメニュー定義
├── messages/
│   ├── welcome.json      ❒ 友だち追加時カード
│   ├── thanks.json       ❒ 入金確認御礼カード
│   └── milestone.json    ❒ マイルストーン告知カード
└── README.md             ❒ Bot本体README（デプロイ手順）
```

---

## デプロイ後の Webhook URL 例

```
https://the-1000-bot.imai-design.workers.dev/webhook
```

これを殿が LINE Developers Console の Webhook URL欄に貼る（1クリック）→ 検証ボタン → 200 OK → 稼働開始。

---

## なぜ Cloudflare Workers を選んだか

| 候補 | 料金 | 起動時間 | 設計 | 採否 |
|------|------|---------|------|------|
| **Cloudflare Workers** | **無料枠 日10万req** | **<10ms (Edge)** | **stateless OK** | **✅ 採用** |
| Vercel Serverless | 無料枠あり | 200ms cold | stateless OK | △ Edge遅め |
| AWS Lambda | 無料枠100万req | 500ms cold | stateless OK | △ 設定重い |
| 自前 VPS | ¥600/月〜 | 安定 | プロセス常駐 | △ 保守必要 |
| GCP Cloud Run | 無料枠あり | 1000ms cold | stateless OK | △ Edge無し |

**LINE Webhook は1秒以内応答必須（タイムアウト失敗で再送される）** → Edge 起動の Cloudflare Workers が最適解。

---

## 殿の次アクション

1. `line-bot/SETUP.md` を読む（10分）
2. ステップ1〜7を実行（殿の手 約42分）
3. 4値を `line-bot/.secrets.local.yml`（gitignore対象）にメモ
4. 家来に「LINE 4値揃ったぞ」と伝える → 家来が一気に配備

**配備時間目安: 約30分で稼働開始**。
