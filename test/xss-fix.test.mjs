// 保存型XSS修正の回帰テスト (fingerprint: the-1000:stored-xss:killers-name-msg-innerHTML)
// 実行方法: node --test test/xss-fix.test.mjs
// ネットワーク・インストール不要。Node組み込みの test / assert だけを使う。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const indexHtml = readFileSync(join(here, "..", "index.html"), "utf8");

// index.html に埋め込まれている escHtml() 関数の本体をそのまま取り出して実行する。
// (コピーして再実装すると、本体側だけ直して修正漏れになるのを防ぐため)
function loadEscHtmlFromSource() {
  const m = indexHtml.match(/function escHtml\(s\)\{[\s\S]*?\n\}/);
  assert.ok(m, "index.html に escHtml() が見つからない(無害化関数が削除された疑い)");
  // eslint非対象: テスト専用のサンドボックス実行
  const fn = new Function(`${m[0]}\nreturn escHtml;`)();
  return fn;
}

test("escHtml: <script>タグを実行不能な文字列に変換する", () => {
  const escHtml = loadEscHtmlFromSource();
  const payload = '<img src=x onerror=alert(1)>';
  const out = escHtml(payload);
  assert.ok(!out.includes("<"), "エスケープ後に < が残っている");
  assert.ok(!out.includes(">"), "エスケープ後に > が残っている");
  assert.equal(out, "&lt;img src=x onerror=alert(1)&gt;");
});

test("escHtml: & \" ' も実体参照に変換する", () => {
  const escHtml = loadEscHtmlFromSource();
  assert.equal(escHtml(`A&B"C'D`), "A&amp;B&quot;C&#39;D");
});

test("escHtml: null/undefinedは空文字になる(例外を投げない)", () => {
  const escHtml = loadEscHtmlFromSource();
  assert.equal(escHtml(null), "");
  assert.equal(escHtml(undefined), "");
});

// 表示箇所(ツールチップ・名簿一覧カード)が k.name / k.msg を escHtml() 経由で
// innerHTML に差し込んでいることをソース上で確認する。
// ここが生の ${k.name} / ${k.msg} に戻ると、保存型XSSが再発する。
test("tip.innerHTML の k.name / k.msg は escHtml() を通している(mouseenterハンドラ)", () => {
  const m = indexHtml.match(/tip\.innerHTML = `<b>[\s\S]*?<\/div>`;/);
  assert.ok(m, "mouseenterハンドラのtip.innerHTML代入が見つからない");
  assert.match(m[0], /escHtml\(k\.name/, "k.name がescHtml()を通っていない");
  assert.match(m[0], /escHtml\(k\.msg/, "k.msg がescHtml()を通っていない");
});

test("名簿一覧カード(n-card)の k.name / k.msg は escHtml() を通している", () => {
  const m = indexHtml.match(/div\.innerHTML = `<div class="id">[\s\S]*?<\/div>`;/);
  assert.ok(m, "n-cardのdiv.innerHTML代入が見つからない");
  assert.match(m[0], /escHtml\(k\.name/, "k.name がescHtml()を通っていない");
  assert.match(m[0], /escHtml\(k\.msg/, "k.msg がescHtml()を通っていない");
});

// --- line-bot/worker.js 側の保存時無害化(defense in depth) ---
const { stripAngleBrackets } = await import("../line-bot/worker.js");

test("stripAngleBrackets: < > を取り除く(タグとして組み立てられなくする)", () => {
  assert.equal(stripAngleBrackets('<img src=x onerror=alert(1)>'), "img src=x onerror=alert(1)");
});

test("stripAngleBrackets: null/undefined/通常文字列も安全に扱う", () => {
  assert.equal(stripAngleBrackets(null), "");
  assert.equal(stripAngleBrackets(undefined), "");
  assert.equal(stripAngleBrackets("田中太郎"), "田中太郎");
});
