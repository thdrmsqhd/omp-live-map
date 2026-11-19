// pyright-langserver 실행 파일 찾기(PATH·알려진 설치 경로)와 Python 프로젝트 루트 판별.
"use strict";

const fs = require("fs");
const path = require("path");

const LOCAL = process.env.LOCALAPPDATA || "";
const KNOWN = [
  path.join(LOCAL, "Programs", "Python", "Python39", "Scripts", "pyright-langserver.exe"),
  "C:/Users/op383/AppData/Local/Programs/Python/Python39/Scripts/pyright-langserver.exe",
];
const MARKERS = ["pyproject.toml", "setup.py", "setup.cfg", "pyrightconfig.json", ".git"];

let cached; // undefined = 아직 찾지 않음, null = 없음, 문자열 = 경로
function findPyright() {
  if (cached !== undefined) return cached;
  cached = null;
  const names = process.platform === "win32" ? ["pyright-langserver.exe"] : ["pyright-langserver"];
  for (const p of [process.env.OMP_PYRIGHT, ...KNOWN]) {
    if (p && fs.existsSync(p)) return (cached = p);
  }
  for (const dir of String(process.env.PATH || "").split(path.delimiter)) {
    if (!dir) continue;
    for (const n of names) {
      const f = path.join(dir, n);
      try {
        if (fs.statSync(f).isFile()) return (cached = f);
      } catch { /* 다음 후보 */ }
    }
  }
  return cached;
}

// 파일에서 위로 올라가며 프로젝트 루트 표식을 찾는다. 없으면 파일의 폴더.
function rootOf(file) {
  const start = path.dirname(file);
  let dir = start;
  for (let i = 0; i < 40; i++) {
    for (const m of MARKERS) if (fs.existsSync(path.join(dir, m))) return dir;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return start;
}

module.exports = { findPyright, rootOf };
