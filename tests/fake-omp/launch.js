// 검증용 런처: PATH 앞에 가짜 omp(bin/omp.exe, node fake-omp.js)를 두고 맵 서버를 띄운다.
// 진짜 omp(C:\Users\...\AppData\Local\omp\omp.exe)가 잡히면 중단한다. 사용: node launch.js 7808 [--scenario scenarios/ask-basic.json]
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const dir = __dirname;
const bin = path.join(dir, "bin");
const exe = path.join(bin, "omp.exe");
const src = path.join(bin, "omp-launcher.cs");
const realOmp = path.join(process.env.LOCALAPPDATA || "", "omp", "omp.exe").toLowerCase();

// csc 로 래퍼를 만든다(소스보다 오래됐거나 없을 때만).
function findCsc() {
  const base = "C:\\Windows\\Microsoft.NET\\Framework64";
  if (!fs.existsSync(base)) return "";
  const vers = fs.readdirSync(base).filter((v) => /^v4\./.test(v)).sort().reverse();
  for (const v of vers) {
    const p = path.join(base, v, "csc.exe");
    if (fs.existsSync(p)) return p;
  }
  return "";
}

function build() {
  if (fs.existsSync(exe) && fs.statSync(exe).mtimeMs > fs.statSync(src).mtimeMs) return;
  const csc = findCsc();
  if (!csc) throw new Error("csc.exe 를 찾지 못했습니다(.NET Framework 4.x 필요)");
  const r = spawnSync(csc, ["/nologo", "/target:exe", "/out:" + exe, src], { encoding: "utf8" });
  if (r.status !== 0) throw new Error("csc 컴파일 실패: " + (r.stdout || "") + (r.stderr || ""));
}

build();
process.env.PATH = bin + ";" + process.env.PATH;

// 맵과 가짜 omp 가 같은 가짜 홈을 본다.
const home = path.join(dir, "home");
fs.mkdirSync(path.join(home, ".omp", "agent", "sessions", "--C--fake--"), { recursive: true });
process.env.USERPROFILE = home;
process.env.HOME = home;

// 실제로 잡힐 omp 경로를 확인하고, 가짜가 아니면 진짜 세션을 건드리지 않도록 중단한다.
let found = "";
try {
  found = execFileSync("where", ["omp"], { encoding: "utf8" });
} catch {}
const first = found.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0] || "";
console.log("omp: " + (first || "(찾지 못함)"));
const resolved = first ? path.resolve(first).toLowerCase() : "";
if (!resolved || !resolved.startsWith(bin.toLowerCase() + path.sep) || resolved === realOmp) {
  console.error("가짜 omp 가 PATH 앞에 잡히지 않습니다. 중단합니다(진짜 omp: " + (realOmp || "?") + ").");
  process.exit(1);
}

// 받은 프레임 로그는 실행마다 새로 쌓는다.
try {
  fs.unlinkSync(process.env.FAKE_OMP_LOG || path.join(dir, "fake-omp.log.jsonl"));
} catch {}

const args = process.argv.slice(2);
const si = args.indexOf("--scenario");
if (si >= 0 && args[si + 1]) process.env.FAKE_OMP_SCENARIO = path.resolve(args[si + 1]);
const pi = args.indexOf("--port");
const port = pi >= 0 && args[pi + 1] ? args[pi + 1] : args[0] && !args[0].startsWith("--") ? args[0] : "7808";

process.argv = [process.argv[0], path.join(dir, "..", "..", "server.js"), "--port", port, "--hours", "24"];
require(path.join(dir, "..", "..", "server.js"));
