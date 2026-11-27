"use strict";

// 화면 계층 규칙: core → model → viewmodel → view → app.
// core·model·viewmodel 은 view 의 전역(함수·변수)을 부르거나 읽지 않는다. 화면 갱신은 core/state.js 의 viewUpdates 로 알린다.
// index.html 의 일반 스크립트는 계층 순서대로 적재되고 app.js 가 마지막이다.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const UI = path.resolve(__dirname, "../ui");
const read = (rel) => fs.readFileSync(path.join(UI, rel), "utf8");
const files = (dir) => fs.readdirSync(path.join(UI, dir)).filter((name) => name.endsWith(".js")).map((name) => dir + "/" + name);

// 주석만 지운다. 문자열 안의 이름은 드물고, 정규식 리터럴까지 정확히 다루려면 파서가 필요하므로 문자열은 그대로 둔다.
function code(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[\s;{}(),])\/\/[^\n]*/g, "$1");
}

// 소비자 파일이 같은 이름을 지역 변수·매개변수로 선언하면 view 전역을 가리키지 않는다.
function declaresLocally(body, name) {
  const id = name.replace(/\$/g, "\\$");
  return [
    new RegExp(`\\b(?:const|let|var)\\s+[^;=\\n]*?(?<![\\w$])${id}(?![\\w$])`),
    new RegExp(`\\bfunction\\b[^(\\n]*\\([^)\\n]*(?<![\\w$])${id}(?![\\w$])[^)\\n]*\\)`),
    new RegExp(`\\(([^()\\n]*(?<![\\w$])${id}(?![\\w$])[^()\\n]*)\\)\\s*=>`),
    new RegExp(`(?<![\\w$.])${id}\\s*=>`),
    new RegExp(`\\bfor\\s*\\(\\s*(?:const|let|var)\\s+[^;\\n]*?(?<![\\w$])${id}(?![\\w$])`),
  ].some((pattern) => pattern.test(body));
}

function topLevelNames(source) {
  const names = new Set();
  for (const line of code(source).split("\n")) {
    const fn = line.match(/^(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/);
    if (fn) names.add(fn[1]);
    const decl = line.match(/^(?:let|const|var)\s+(.+)/);
    if (decl) for (const [, name] of decl[1].matchAll(/(?:^|,)\s*([A-Za-z_$][\w$]*)\s*=/g)) names.add(name);
  }
  return names;
}

test("core, model and viewmodel do not reach into view globals", () => {
  const viewNames = new Set();
  for (const file of files("js/view")) for (const name of topLevelNames(read(file))) viewNames.add(name);
  const problems = [];
  for (const file of [...files("js/core"), ...files("js/model"), ...files("js/viewmodel")]) {
    // 객체 리터럴의 키({ lines: … })는 전역 참조가 아니다.
    const body = code(read(file)).replace(/([{,]\s*)[A-Za-z_$][\w$]*\s*:(?!:)/g, "$1:");
    const own = topLevelNames(read(file));
    for (const name of viewNames) {
      if (own.has(name) || declaresLocally(body, name)) continue;
      if (new RegExp(`(?<![\\w$.])${name.replace(/\$/g, "\\$")}(?![\\w$])`).test(body)) problems.push(`${file} → ${name}`);
    }
  }
  assert.deepEqual(problems, []);
});

test("index.html loads classic scripts in layer order with app.js last", () => {
  const html = read("index.html");
  const scripts = [...html.matchAll(/<script(?![^>]*type="module")[^>]*src="([^"]+)"/g)].map(([, src]) => src);
  const rank = (src) => src.startsWith("js/core/") ? 0 : src.startsWith("js/model/") ? 1 : src.startsWith("js/viewmodel/") ? 2 : src === "js/app.js" ? 4 : 3;
  const ranks = scripts.map(rank);
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b), "scripts out of layer order");
  assert.equal(scripts.at(-1), "js/app.js");
});
