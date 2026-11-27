"use strict";

// 카드를 닫으면 대화·컨텍스트·DB 비밀번호 같은 화면 상태를 놓고, 잃을 것이 있는 대화는 남긴다.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Windows 체크아웃(core.autocrlf)은 CRLF 로 받으므로 줄 끝을 맞춘 뒤 함수를 잘라 낸다.
const read = (name) => fs.readFileSync(path.join(__dirname, "../ui/js", name), "utf8").replace(/\r\n/g, "\n");
const pick = (source, start) => {
  const at = source.indexOf(start);
  assert.ok(at >= 0, start);
  const end = source.indexOf("\n}\n", at);
  return source.slice(at, end + 3);
};

function context() {
  const revoked = [];
  const saved = [];
  const sandbox = {
    CHAT: new Map(), CTX: new Map(), DBUI: new Map(),
    URL: { revokeObjectURL: (url) => revoked.push(url) },
    persistPromptDraft: (id, st) => saved.push([id, st.draft]),
    revoked, saved,
  };
  vm.createContext(sandbox);
  const chat = read("viewmodel/chat.js");
  const map = read("viewmodel/map.js");
  vm.runInContext([pick(chat, "function revokePreviews("), pick(chat, "function releaseChatState("), pick(map, "function releaseCardState(")].join("\n")
    + "\nthis.releaseCardState = releaseCardState;", sandbox);
  return sandbox;
}

test("closing an idle card frees its chat previews, context data and DB password", () => {
  const box = context();
  box.CHAT.set("a", { draft: "keep me", previews: new Map([[1, ["blob:1", "blob:2"]]]), log: [{ previews: ["blob:3"] }], files: [], queue: [] });
  box.CTX.set("a", { data: { items: [1, 2, 3] } });
  box.DBUI.set("a", { password: "secret", res: { rows: [1] }, form: { host: "db" } });
  box.releaseCardState("a");
  assert.equal(box.CHAT.has("a"), false);
  assert.deepEqual(box.revoked, ["blob:1", "blob:2", "blob:3"]);
  assert.deepEqual(box.saved, [["a", "keep me"]], "draft is persisted before release");
  assert.equal(box.CTX.has("a"), false);
  assert.equal(box.DBUI.get("a").password, "");
  assert.equal(box.DBUI.get("a").res, null);
  assert.deepEqual(box.DBUI.get("a").form, { host: "db" }, "the connection form stays for reopening");
});

test("a card that is still sending or holds attachments keeps its chat state", () => {
  const box = context();
  box.CHAT.set("busy", { busy: true, previews: new Map(), log: [], files: [] });
  box.CHAT.set("queued", { queue: ["next"], previews: new Map(), log: [], files: [] });
  box.CHAT.set("files", { files: [{ url: "blob:f" }], previews: new Map(), log: [] });
  for (const id of ["busy", "queued", "files"]) box.releaseCardState(id);
  assert.deepEqual([...box.CHAT.keys()], ["busy", "queued", "files"]);
  assert.deepEqual(box.revoked, []);
});
