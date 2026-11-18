// 검증용 런처: PATH 앞에 가짜 claude(bin/claude.exe → fake-claude.js)와 가짜 omp를 두고 맵 서버를 띄운다.
// 진짜 claude/omp 가 잡히면 중단한다. 사용: node tests/fake-claude/launch.js 7830
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const dir = __dirname;
const bin = path.join(dir, "bin");
const exe = path.join(bin, "claude.exe");
const src = path.join(bin, "claude-launcher.cs");
const ompBin = path.join(dir, "..", "fake-omp", "bin");
const realClaude = path.join(process.env.USERPROFILE || "", ".local", "bin", "claude.exe").toLowerCase();

function findCsc() {
  const base = "C:\\Windows\\Microsoft.NET\\Framework64";
  if (!fs.existsSync(base)) return "";
  for (const v of fs.readdirSync(base).filter((x) => /^v4\./.test(x)).sort().reverse()) {
    const p = path.join(base, v, "csc.exe");
    if (fs.existsSync(p)) return p;
  }
  return "";
}

function build(script, out, force) {
  if (!force && fs.existsSync(out) && fs.statSync(out).mtimeMs > fs.statSync(script).mtimeMs) return;
  const csc = findCsc();
  if (!csc) throw new Error("csc.exe 를 찾지 못했습니다(.NET Framework 4.x 필요)");
  const r = spawnSync(csc, ["/nologo", "/target:exe", "/out:" + out, script], { encoding: "utf8" });
  if (r.status !== 0) throw new Error("csc 컴파일 실패: " + (r.stdout || "") + (r.stderr || ""));
}

build(src, exe, false);
// 가짜 omp.exe 가 없으면 같은 방식으로 만든다(fake-omp/launch.js 와 같은 소스).
const ompExe = path.join(ompBin, "omp.exe");
const ompSrc = path.join(ompBin, "omp-launcher.cs");
if (fs.existsSync(ompSrc)) build(ompSrc, ompExe, false);

process.env.PATH = bin + ";" + ompBin + ";" + process.env.PATH;

// 맵과 가짜 실행 파일이 같은 가짜 홈을 본다. 실제 ~/.claude·~/.omp 는 읽지도 쓰지도 않는다.
const home = path.join(dir, "home");
fs.mkdirSync(path.join(home, ".omp", "agent", "sessions", "--C--fake--"), { recursive: true });
fs.mkdirSync(path.join(home, ".claude", "projects"), { recursive: true });
process.env.USERPROFILE = home;
process.env.HOME = home;
// 계보·모델 저장도 가짜 홈 아래로 격리한다(운영 data/ 를 건드리지 않는다).
process.env.OMP_MAP_STATE = path.join(home, "data");

function firstOf(name) {
  try { return execFileSync("where", [name], { encoding: "utf8" }).split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0] || ""; }
  catch { return ""; }
}
const gotClaude = firstOf("claude");
const gotOmp = firstOf("omp");
console.log("claude: " + (gotClaude || "(찾지 못함)"));
console.log("omp: " + (gotOmp || "(찾지 못함)"));
const under = (p, base) => path.resolve(p).toLowerCase().startsWith(base.toLowerCase() + path.sep);
if (!gotClaude || !under(gotClaude, bin) || path.resolve(gotClaude).toLowerCase() === realClaude) {
  console.error("가짜 claude 가 PATH 앞에 잡히지 않습니다. 중단합니다.");
  process.exit(1);
}
if (!gotOmp || !under(gotOmp, ompBin)) {
  console.error("가짜 omp 가 PATH 앞에 잡히지 않습니다. 중단합니다.");
  process.exit(1);
}

// 가짜 Claude 기록 한 개를 심고(읽기 확인용) 로그를 새로 시작한다.
require(path.join(dir, "seed.js"));
try { fs.unlinkSync(process.env.FAKE_CLAUDE_LOG || path.join(dir, "fake-claude.log.jsonl")); } catch {}
try { fs.unlinkSync(process.env.FAKE_OMP_LOG || path.join(dir, "..", "fake-omp", "fake-omp.log.jsonl")); } catch {}

const args = process.argv.slice(2);
const pi = args.indexOf("--port");
const port = pi >= 0 && args[pi + 1] ? args[pi + 1] : args[0] && !args[0].startsWith("--") ? args[0] : "7830";
process.argv = [process.argv[0], path.join(dir, "..", "..", "server.js"), "--port", port, "--hours", "24"];
require(path.join(dir, "..", "..", "server.js"));
