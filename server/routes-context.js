// 컨텍스트 API: 지금 컨텍스트 보기, 작업 가이드·압축으로 편집.
"use strict";

const { json, withJson } = require("./http");
const { view, guide, compact } = require("./session-context");

module.exports = {
  "* /api/context": (req, res, url) => json(res, view(url.searchParams.get("node") || "")),
  "POST /api/context": (req, res) => withJson(req, res, async (p) => {
    const node = String(p.node || "");
    const mode = String(p.mode || "");
    if (mode === "guide") return json(res, await guide(node, p.text));
    if (mode === "compact") return json(res, await compact(node, p.text, p.omit));
    json(res, { ok: false, out: "mode 는 guide 또는 compact 여야 합니다" });
  }),
};
