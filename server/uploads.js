// 프롬프트 첨부: 작은 이미지는 omp RPC images 로 싣고, 일반 파일·큰 이미지는 %TEMP%\omp-live-map-uploads\ 에 저장해
// 저장 경로를 메시지 끝에 붙인다(에이전트가 read 로 읽는다). 모듈 상태는 저장 폴더 번호뿐이다.
"use strict";

const fs = require("fs");
const path = require("path");
const { UPLOADS } = require("./config");

const DIR = UPLOADS;
const MAX_FILE = 20 * 1024 * 1024; // 파일당
const MAX_FILES = 10;
const MAX_BODY = 100 * 1024 * 1024; // 첨부가 실린 요청 본문(base64 로 4/3 배가 된다)
// omp rpc v1 입력 프레임은 1MiB 안이어야 한다. 이미지 base64 합계를 그 아래로 두고 넘치는 이미지는 파일로 보낸다.
const INLINE_MAX = 900 * 1024;
const INLINE_MIME = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

let seq = 0;

const safeName = (n) => String(n || "").replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").replace(/^[.\s]+|[.\s]+$/g, "").slice(0, 120) || "file";

// files: [{ name, mimeType, data(base64) }]. 반환: { message, images } 또는 { error }.
// mode "claude" 면 저장한 일반 파일을 Claude 의 @경로 참조로 적는다.
function prepare(text, files, mode) {
  const list = Array.isArray(files) ? files : [];
  if (list.length > MAX_FILES) return { error: `첨부는 ${MAX_FILES}개까지입니다` };
  const items = [];
  for (const f of list) {
    const name = safeName(f && f.name);
    const buf = Buffer.from(String((f && f.data) || ""), "base64");
    if (!buf.length) return { error: "빈 첨부: " + name };
    if (buf.length > MAX_FILE) return { error: "20MB 초과 첨부: " + name };
    items.push({ name, mime: String((f && f.mimeType) || "").toLowerCase(), buf });
  }
  const images = [], saved = [];
  let inline = 0, dir = "";
  try {
    for (const it of items) {
      const data = INLINE_MIME.has(it.mime) ? it.buf.toString("base64") : "";
      if (data && inline + data.length <= INLINE_MAX) {
        inline += data.length;
        images.push({ type: "image", data, mimeType: it.mime });
        continue;
      }
      if (!dir) {
        dir = path.join(DIR, `${Date.now()}-${process.pid}-${++seq}`);
        fs.mkdirSync(dir, { recursive: true });
      }
      let file = path.join(dir, it.name);
      for (let i = 2; fs.existsSync(file); i++) file = path.join(dir, `${i}-${it.name}`);
      fs.writeFileSync(file, it.buf);
      saved.push(file);
    }
  } catch (e) {
    return { error: "첨부 저장 실패: " + String((e && e.message) || e) };
  }
  let message = text;
  if (saved.length) {
    message = (text ? text + "\n\n" : "") + (mode === "claude" ? "첨부 파일:\n" + saved.map((p) => "@" + p).join("\n")
      : "첨부 파일(read 로 읽을 것):\n" + saved.map((p) => "- " + p).join("\n"));
  }
  // omp 는 빈 메시지를 받지 않으므로 이미지만 보낼 때 자리 표시 글을 둔다.
  if (!message && images.length) message = "(이미지 첨부)";
  return { message, images };
}

module.exports = { prepare, MAX_BODY };
