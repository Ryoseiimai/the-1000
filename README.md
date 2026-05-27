# 1万円払った1000人 · THE THOUSAND

**LIVE:** https://imai-design.github.io/the-1000/

信用も金もない今井涼晴に、それでも¥10,000払ってくれた1000人だけのコミュニティ。
1000人 × ¥10,000 = ¥10,000,000 で涼晴の借金を完済する。

## 編集ポイント
`index.html` 冒頭 `CONFIG` を編集:
- `PAYPAY_URL` — PayPay請求リンク貼り込み
- `LINE_INVITE_URL` — LINE オープンチャット招待URL
- `FORM_ENDPOINT` — Googleフォーム等の送信先

## 新メンバー追加
`data/killers.json` の `killers` 配列に `{id, name, msg, date}` 追記 → git push → 30秒で反映

