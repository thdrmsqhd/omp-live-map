"use strict";

// Engineering 실행기가 이 PC 에 설치된 CLI(omp·claude)와 검증 명령을 고른 작업 폴더에서 바로 띄운다.
// 터미널에서 직접 실행하는 것과 같다: 사용자 계정 권한, 호스트 네트워크, CLI 가 이미 가진 로그인·모델 설정을 쓴다.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { killTree } = require("../rpc");

// 검증 명령은 이 표와 인자까지 정확히 같은 것만 실행한다. Windows 에는 python3 가 없을 수 있어 python 도 둔다.
const permitted = [
  { command: "npm", args: ["test"] }, { command: "node", args: ["--test"] },
  { command: "python3", args: ["-m", "unittest", "discover"] },
  { command: "python", args: ["-m", "unittest", "discover"] },
];

const windows = process.platform === "win32";

// PATH(와 Windows PATHEXT)에서 실행 파일을 찾는다. omp 는 bun 전역 설치 위치(~/.bun/bin)도 본다.
function findExecutable(name, env = process.env) {
  const dirs = String(env.PATH ?? env.Path ?? "").split(path.delimiter).filter(Boolean);
  if (name === "omp") dirs.push(path.join(os.homedir(), ".bun", "bin"));
  const extensions = windows ? String(env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean) : [""];
  for (const dir of dirs) {
    for (const extension of extensions) {
      const file = path.join(dir, name + extension);
      try { if (fs.statSync(file).isFile()) return file; } catch { /* 다음 후보 */ }
    }
  }
  return null;
}

// .cmd/.bat(예: npm.cmd)은 셸로만 띄울 수 있다. 셸 해석 문자가 든 인자는 거절해 명령이 바뀌지 않게 한다.
const shellMeta = /[&|<>^%!"`\r\n]/;
function commandLine(file, args) {
  const quote = (value) => /[\s]/.test(value) ? '"' + value + '"' : value;
  return ['"' + file + '"', ...args.map((arg) => quote(String(arg)))].join(" ");
}

function hostProcesses({ find = findExecutable, launchProcess = spawn, terminate = killTree, problem } = {}) {
  const children = new Set();
  function launch(program, args, options = {}, { signal } = {}) {
    signal?.throwIfAborted();
    const file = find(program);
    if (!file) throw problem(409, program + " 실행 파일을 PATH 에서 찾지 못했습니다");
    let cwd;
    try { cwd = fs.realpathSync(options.cwd); } catch { cwd = null; }
    if (!cwd || !fs.statSync(cwd).isDirectory()) throw problem(409, "작업 폴더를 찾을 수 없습니다");
    const script = windows && /\.(cmd|bat)$/i.test(file);
    if (script && args.some((arg) => shellMeta.test(String(arg)))) {
      throw problem(409, program + " 인자에 셸 특수 문자가 있어 실행하지 않았습니다");
    }
    const settings = { ...options, cwd, windowsHide: true };
    const child = script ? launchProcess(commandLine(file, args), { ...settings, shell: true })
      : launchProcess(file, args, settings);
    children.add(child);
    child.once("close", () => children.delete(child));
    child.once("error", () => children.delete(child));
    return child;
  }
  return {
    locate: (program) => find(program),
    launch,
    terminate: (child) => terminate(child),
    shutdown() { for (const child of children) terminate(child); },
  };
}

module.exports = { hostProcesses, findExecutable, permitted };
