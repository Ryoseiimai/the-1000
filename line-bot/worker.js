/**
 * THE THOUSAND · LINE Bot · Cloudflare Workers
 *
 * 役割:
 *   1. LINE Webhook 受信 → 署名検証 → イベント分岐
 *   2. 殿の admin コマンド処理（厳密構文 + Claude API による自然言語フォールバック）
 *   3. killers.json を GitHub API で更新 → GitHub Pages 自動再ビルド
 *   4. 入金者へ御礼 Reply / マイルストーン到達時 Broadcast
 *
 * Secrets (wrangler secret put で投入):
 *   LINE_CHANNEL_ACCESS_TOKEN    SETUP.md ステップ3
 *   LINE_CHANNEL_SECRET          SETUP.md ステップ3
 *   ADMIN_LINE_USER_ID           殿のLINEユーザーID（初回Webhookログから取得）
 *   GITHUB_PAT                   killers.json更新権限のPAT（repo scope）
 *   ANTHROPIC_API_KEY            自然言語コマンドパース用
 *   OPENCHAT_INVITE_URL          オープンチャット招待URL（SETUP.md ステップ6）
 */

const GH_OWNER = "imai-design";
const GH_REPO = "the-1000";
const GH_PATH = "data/killers.json";
const SITE_URL = "https://imai-design.github.io/the-1000/";
const MAX = 1000;
const MILESTONES = [10, 20, 50, 200, 500, 1000];
const MS_LABELS = {
  10: "第1回オフライン会合・最初の10人",
  20: "第2回オフライン会合・二桁の壁",
  50: "第3回オフライン会合・五十名",
  200: "第4回オフライン会合・¥2M到達",
  500: "第5回オフライン会合・半数",
  1000: "FINAL会合・借金完済の日",
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/healthz") {
      return new Response("ok", { status: 200 });
    }
    if (url.pathname === "/webhook" && request.method === "POST") {
      return handleWebhook(request, env, ctx);
    }
    return new Response("THE THOUSAND Bot", { status: 200 });
  },
};

/* ============================================================
 *  WEBHOOK ENTRY
 * ============================================================ */
async function handleWebhook(request, env, ctx) {
  const body = await request.text();
  const signature = request.headers.get("x-line-signature");

  if (!signature || !(await verifyLineSignature(body, signature, env.LINE_CHANNEL_SECRET))) {
    return new Response("invalid signature", { status: 401 });
  }

  const payload = JSON.parse(body);
  const events = payload.events || [];

  // 並列処理（各イベントは独立、互いに待たない）
  ctx.waitUntil(Promise.allSettled(events.map((ev) => handleEvent(ev, env))));

  return new Response("ok", { status: 200 });
}

async function verifyLineSignature(body, signature, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const computed = btoa(String.fromCharCode(...new Uint8Array(mac)));
  return signature === computed;
}

/* ============================================================
 *  EVENT ROUTER
 * ============================================================ */
async function handleEvent(ev, env) {
  const userId = ev.source?.userId;
  if (!userId) return;

  switch (ev.type) {
    case "follow":
      return sendWelcomeReply(ev.replyToken, env);

    case "message":
      if (ev.message.type !== "text") return;
      if (userId === env.ADMIN_LINE_USER_ID) {
        return handleAdminCommand(ev, env);
      }
      return handleVisitorMessage(ev, env);

    case "unfollow":
      // 退会者は静かに見送る（ログのみ）
      console.log("unfollow", userId);
      return;

    default:
      console.log("ignored event", ev.type);
  }
}

/* ============================================================
 *  VISITOR (一般の友だち) MESSAGE
 *    入金検討中の人 / 入金後の人 から来た自由文 → 殿に転送 + 自動返信
 * ============================================================ */
async function handleVisitorMessage(ev, env) {
  const text = (ev.message.text || "").trim();

  // 入金完了報告らしきキーワードを軽く検知
  const looksLikePaid = /払った|振込|入金|paypay|paid/i.test(text);

  if (looksLikePaid) {
    await replyText(ev.replyToken, env, [
      "🩸 ご入金、ありがとうございます。",
      "",
      "涼晴が確認次第、あなたのお名前を名簿に刻み、",
      "御礼メッセージとオープンチャット招待URLをお送りします。",
      "",
      "確認まで少々お時間を頂きます（最短数分・最長半日）。",
      "",
      "— THE THOUSAND Bot",
    ].join("\n"));
  } else {
    await replyText(ev.replyToken, env, [
      "メッセージありがとうございます。",
      "涼晴本人が拝読し、必要に応じてお返事いたします。",
      "",
      "ご入金前のご質問でしたら、サイトもご確認ください:",
      SITE_URL,
    ].join("\n"));
  }

  // 殿に通知（push）
  await pushText(env.ADMIN_LINE_USER_ID, env, [
    `📬 [from ${userId8(ev.source.userId)}]`,
    text,
  ].join("\n"));
}

/* ============================================================
 *  ADMIN COMMAND (殿)
 *    厳密構文を優先で試し、外れたら Claude API でパース
 * ============================================================ */
async function handleAdminCommand(ev, env) {
  const text = (ev.message.text || "").trim();

  // help
  if (/^(help|ヘルプ|\?)/i.test(text)) {
    return replyText(ev.replyToken, env, helpMessage());
  }

  // 状態
  if (/^(状態|status|state)/i.test(text)) {
    const killers = await loadKillers(env);
    return replyText(ev.replyToken, env, statusMessage(killers));
  }

  // 名簿
  if (/^(名簿|list|一覧)/i.test(text)) {
    const killers = await loadKillers(env);
    return replyText(ev.replyToken, env, listMessage(killers));
  }

  // 配信 "本文"
  const broadcastMatch = text.match(/^配信\s+["「](.+?)["」]/s);
  if (broadcastMatch) {
    await broadcastText(env, broadcastMatch[1]);
    return replyText(ev.replyToken, env, `📡 全友だちへ配信完了。\n本文プレビュー: ${broadcastMatch[1].slice(0, 60)}...`);
  }

  // 削除 #0004
  const delMatch = text.match(/^削除\s+#?(\d{1,4})/);
  if (delMatch) {
    const id = parseInt(delMatch[1], 10);
    const result = await deleteKiller(env, id);
    return replyText(ev.replyToken, env, result.ok ? `🗑️ #${pad4(id)} を名簿から削除しました。` : `❌ ${result.error}`);
  }

  // 確認 [#NNNN] 名前 [公開可否] [一言...]
  const parsed = parseConfirmStrict(text);
  if (parsed) {
    return executeConfirm(ev.replyToken, env, parsed);
  }

  // フォールバック: Claude API で自然言語パース
  try {
    const aiParsed = await parseWithClaude(env, text);
    if (aiParsed && aiParsed.intent === "confirm") {
      return executeConfirm(ev.replyToken, env, aiParsed.payload);
    }
    if (aiParsed && aiParsed.intent === "unknown") {
      return replyText(ev.replyToken, env, [
        "🤔 殿、その御指示は私の理解の外にござります。",
        "",
        helpMessage(),
      ].join("\n"));
    }
  } catch (e) {
    console.error("claude parse failed", e);
  }

  return replyText(ev.replyToken, env, helpMessage());
}

function parseConfirmStrict(text) {
  // 例: 確認 #0004 田中太郎 名前OK 夢を笑わせない経済を作りたい
  // 例: 確認 田中太郎 匿名
  const m = text.match(/^確認(?:\s+#?(\d{1,4}))?\s+(.+?)(?:\s+(名前OK|匿名|公開OK|公開|匿名希望))?(?:\s+(.+))?$/s);
  if (!m) return null;
  const [, idStr, name, publicFlag, msg] = m;
  return {
    id: idStr ? parseInt(idStr, 10) : null,
    name: name.trim(),
    public: publicFlag ? /OK|公開/.test(publicFlag) : true,
    msg: (msg || "").trim(),
  };
}

async function parseWithClaude(env, text) {
  if (!env.ANTHROPIC_API_KEY) return null;

  const systemPrompt = `あなたは「THE THOUSAND」コミュニティ運営のBotパーサーです。
殿（運営者）の自然言語コマンドを構造化JSONに変換してください。

可能なintent:
- "confirm": 入金確認・名簿追加
- "broadcast": 全員配信
- "delete": 名簿削除
- "unknown": 不明

confirm の場合の payload:
{ "id": null|number, "name": string, "public": boolean, "msg": string }

JSON以外の出力は禁止。`;

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 256,
      system: systemPrompt,
      messages: [{ role: "user", content: text }],
    }),
  });
  if (!r.ok) return null;
  const j = await r.json();
  const content = j.content?.[0]?.text;
  if (!content) return null;
  try {
    const jsonStart = content.indexOf("{");
    const jsonEnd = content.lastIndexOf("}");
    if (jsonStart < 0 || jsonEnd < 0) return null;
    const parsed = JSON.parse(content.slice(jsonStart, jsonEnd + 1));
    if (parsed.intent === "confirm" && parsed.payload) {
      return { intent: "confirm", payload: parsed.payload };
    }
    return { intent: parsed.intent || "unknown" };
  } catch {
    return null;
  }
}

async function executeConfirm(replyToken, env, payload) {
  const killers = await loadKillers(env);
  const id = payload.id || (killers.length + 1);
  const today = new Date().toISOString().slice(0, 10);

  const newEntry = {
    id,
    name: payload.public ? payload.name : "優しい人",
    msg: payload.msg || "",
    date: today,
  };

  killers.push(newEntry);
  killers.sort((a, b) => a.id - b.id);

  const saveResult = await saveKillers(env, killers, `feat: add #${pad4(id)} ${newEntry.name}`);
  if (!saveResult.ok) {
    return replyText(replyToken, env, `❌ killers.json 更新失敗: ${saveResult.error}`);
  }

  // マイルストーン検知
  const reached = MILESTONES.find((m) => m === killers.length);
  if (reached) {
    await broadcastMilestone(env, killers.length, reached);
  }

  return replyText(replyToken, env, [
    `✅ #${pad4(id)} ${newEntry.name} を名簿に追加しました。`,
    `公開: ${payload.public ? "OK" : "匿名"}／メッセ: ${newEntry.msg || "（なし）"}`,
    `📜 現在 ${killers.length} / ${MAX} 名`,
    `🌐 ${SITE_URL} に30秒で反映`,
    reached ? `\n🏯 ${MS_LABELS[reached]} 到達！全友だちへ告知配信しました。` : "",
  ].filter(Boolean).join("\n"));
}

async function deleteKiller(env, id) {
  const killers = await loadKillers(env);
  const idx = killers.findIndex((k) => k.id === id);
  if (idx < 0) return { ok: false, error: `#${pad4(id)} は名簿に存在しません` };
  killers.splice(idx, 1);
  const saveResult = await saveKillers(env, killers, `revert: remove #${pad4(id)}`);
  return saveResult;
}

/* ============================================================
 *  GITHUB API: killers.json 読み書き
 * ============================================================ */
async function loadKillers(env) {
  const r = await fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${GH_PATH}`, {
    headers: {
      "Authorization": `Bearer ${env.GITHUB_PAT}`,
      "User-Agent": "THE-THOUSAND-Bot",
      "Accept": "application/vnd.github+json",
    },
  });
  if (!r.ok) {
    console.error("loadKillers failed", await r.text());
    return [];
  }
  const j = await r.json();
  const decoded = atob(j.content.replace(/\n/g, ""));
  const parsed = JSON.parse(decoded);
  return parsed.killers || [];
}

async function saveKillers(env, killers, commitMessage) {
  // GET to fetch current SHA
  const getR = await fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${GH_PATH}`, {
    headers: {
      "Authorization": `Bearer ${env.GITHUB_PAT}`,
      "User-Agent": "THE-THOUSAND-Bot",
      "Accept": "application/vnd.github+json",
    },
  });
  if (!getR.ok) return { ok: false, error: `GET sha failed: ${getR.status}` };
  const getJ = await getR.json();

  const newContent = JSON.stringify({
    _comment: "1万円払った1000人 名簿。LINE Bot 経由で自動更新。",
    killers,
  }, null, 2) + "\n";

  // PUT to update
  const putR = await fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${GH_PATH}`, {
    method: "PUT",
    headers: {
      "Authorization": `Bearer ${env.GITHUB_PAT}`,
      "User-Agent": "THE-THOUSAND-Bot",
      "Accept": "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: commitMessage,
      content: btoa(unescape(encodeURIComponent(newContent))),
      sha: getJ.sha,
      committer: {
        name: "THE THOUSAND Bot",
        email: "bot@imai-design.github.io",
      },
    }),
  });
  if (!putR.ok) {
    return { ok: false, error: `PUT failed: ${putR.status} ${await putR.text()}` };
  }
  return { ok: true };
}

/* ============================================================
 *  LINE API: REPLY / PUSH / BROADCAST
 * ============================================================ */
async function replyText(replyToken, env, text) {
  return lineRequest(env, "/v2/bot/message/reply", {
    replyToken,
    messages: [{ type: "text", text: text.slice(0, 4900) }],
  });
}

async function pushText(toUserId, env, text) {
  return lineRequest(env, "/v2/bot/message/push", {
    to: toUserId,
    messages: [{ type: "text", text: text.slice(0, 4900) }],
  });
}

async function broadcastText(env, text) {
  return lineRequest(env, "/v2/bot/message/broadcast", {
    messages: [{ type: "text", text: text.slice(0, 4900) }],
  });
}

async function broadcastMilestone(env, current, milestone) {
  const label = MS_LABELS[milestone] || `${milestone}名到達`;
  const text = [
    `🏯 ${label} 到達！`,
    "",
    `ついに **${current}名** が集まりました。`,
    "信用も金もなかった涼晴に、それでも¥10,000を払ってくれた優しい人たち。",
    "",
    `【次の動き】`,
    `📅 オフライン会合の日時調整に入ります`,
    `📍 場所候補は参加者投票で決定（東京 or バンコク or リモート併設）`,
    "",
    `参加希望は本トークに「参加」とお返事ください。`,
    "",
    `🌐 名簿: ${SITE_URL}`,
    "",
    "— THE THOUSAND Bot",
  ].join("\n");
  return broadcastText(env, text);
}

async function lineRequest(env, path, body) {
  const r = await fetch(`https://api.line.me${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    console.error("LINE API failed", path, r.status, await r.text());
  }
  return r;
}

/* ============================================================
 *  WELCOME (follow event)
 * ============================================================ */
async function sendWelcomeReply(replyToken, env) {
  const text = [
    "🩸 ありがとうございます。",
    "",
    "「1万円払った1000人」へ、ようこそ。",
    "このBotは涼晴の直属の家来です。",
    "",
    "ご入金確認後、あなたの名前は #0XXX として",
    "永久に名簿に刻まれます。",
    "",
    "【次の手順】",
    "1. PayPay or 銀行振込で ¥10,000 を払う",
    "2. 払った旨をこのトークに送る（スクショ歓迎）",
    "3. 涼晴が確認次第、御礼メッセと名簿登録の通知が届きます",
    "4. オープンチャット「THE THOUSAND」への招待URLを送ります",
    "",
    `🌐 サイト: ${SITE_URL}`,
    "",
    "— THE THOUSAND Bot",
  ].join("\n");
  return replyText(replyToken, env, text);
}

/* ============================================================
 *  HELPERS
 * ============================================================ */
function pad4(n) {
  return String(n).padStart(4, "0");
}
function userId8(uid) {
  return (uid || "").slice(-8);
}

function helpMessage() {
  return [
    "🤖 殿用コマンド一覧",
    "",
    "【入金確認＆名簿追加】",
    "  確認 #0004 田中太郎 名前OK 夢を見続けたい",
    "  確認 田中太郎 匿名",
    "  ※自然言語でもOK: 「たなかさん入金確認、名前公開OK」",
    "",
    "【削除】",
    "  削除 #0004",
    "",
    "【配信】",
    `  配信 "本文を「」または\"\"で括る"`,
    "",
    "【閲覧】",
    "  名簿 — 全名簿表示",
    "  状態 — 現在数・残・次マイルストーン",
    "",
    "【その他】",
    "  help — このメッセージ",
  ].join("\n");
}

function statusMessage(killers) {
  const cur = killers.length;
  const next = MILESTONES.find((m) => m > cur) || MAX;
  return [
    `📊 THE THOUSAND 現況`,
    "",
    `現在: ${cur} / ${MAX} 名`,
    `集金: ¥${(cur * 10000).toLocaleString()}`,
    `残席: ${MAX - cur}`,
    `次の壁: ${next} 名（残り ${next - cur} 名）`,
    `次の節目: ${MS_LABELS[next] || "—"}`,
  ].join("\n");
}

function listMessage(killers) {
  if (killers.length === 0) return "📜 名簿はまだ空にござります。";
  const lines = killers.slice(-20).map((k) =>
    `#${pad4(k.id)} ${k.name}${k.msg ? ` — ${k.msg.slice(0, 30)}` : ""}`
  );
  return [
    `📜 名簿（直近20名）`,
    "",
    ...lines,
    "",
    `全${killers.length}名は ${SITE_URL} を参照`,
  ].join("\n");
}
