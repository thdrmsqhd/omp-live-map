// 셸 실행: Git Bash exec(cwd 는 클라이언트가 들고 다닌다), 디렉터리 트리, 백그라운드 잡(BG) 소유.
"use strict";

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { HOME, BASH } = require("./config");

const isDir = (p) => {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
};

// 명령 한 줄을 cwd 에서 실행한다. `cd` 는 프로세스를 띄우지 않고 새 cwd 만 계산해 돌려준다.
function exec(cwd, cmd) {
  const base = cwd && isDir(cwd) ? cwd : HOME;
  const trimmed = cmd.trim();
  const cd = trimmed.match(/^cd(?:\s+(.+))?$/);
  if (cd) {
    let target = (cd[1] || HOME).trim().replace(/^["']|["']$/g, "");
    if (target === "~") target = HOME;
    const next = path.resolve(base, target);
    const ok = isDir(next);
    return Promise.resolve({ cwd: ok ? next : base, code: ok ? 0 : 1, out: ok ? next : `cd: no such directory: ${target}` });
  }
  return new Promise((resolve) => {
    const child = spawn(BASH, ["-lc", trimmed], { cwd: base, env: { ...process.env, TERM: "dumb" } });
    let out = "";
    let done = false;
    const finish = (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ cwd: base, code: code, out: out.slice(-20000) });
    };
    const timer = setTimeout(() => {
      out += "\n[timeout 20s — process killed]";
      try {
        child.kill();
      } catch {}
      finish(124);
    }, 20_000);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("error", (err) => {
      out += `spawn failed: ${err.message}`;
      finish(127);
    });
    child.on("close", (code) => finish(code));
  });
}

const IGNORE = new Set(["node_modules", ".git", "__pycache__", ".venv", "venv", "dist", "build", ".next", ".cache", "target", "bin", "obj", ".idea", ".vs"]);

function treeOf(dir, depth) {
  const root = path.resolve(dir);
  const walk = (d, left) => {
    let ents;
    try {
      ents = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return [];
    }
    const items = ents
      .filter((e) => !IGNORE.has(e.name) && !e.name.startsWith("."))
      .map((e) => {
        const full = path.join(d, e.name);
        let size = 0, mtime = 0;
        try {
          const st = fs.statSync(full);
          size = st.size;
          mtime = st.mtimeMs;
        } catch {}
        return { name: e.name, dir: e.isDirectory(), size, mtime, path: full };
      })
      .sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name))
      .slice(0, 200);
    if (left > 1) for (const it of items) if (it.dir) it.children = walk(it.path, left - 1);
    return items;
  };
  return { path: root, entries: walk(root, Math.max(1, Math.min(3, depth))) };
}

const BG = new Map();
let bgSeq = 0;

function startBg(node, cwd, cmd) {
  const id = "job_" + (++bgSeq);
  const dir = fs.existsSync(cwd || "") ? cwd : HOME;
  const child = spawn(BASH, ["-lc", cmd], { cwd: dir, env: { ...process.env, TERM: "dumb" } });
  const job = { id, node, cwd: dir, cmd, lines: [], done: false, code: null, startedAt: Date.now(), proc: child };
  BG.set(id, job);
  const push = (txt, cls) => {
    for (const line of String(txt).split(/\r?\n/)) {
      if (line.trim() === "") continue;
      job.lines.push({ t: line.slice(0, 2000), c: cls });
    }
    if (job.lines.length > 1200) job.lines = job.lines.slice(-1200);
  };
  child.stdout.on("data", (d) => push(d));
  child.stderr.on("data", (d) => push(d, "err"));
  child.on("close", (code) => {
    job.done = true;
    job.code = code;
    job.endedAt = Date.now();
    push("[exit " + code + "]", code ? "err" : "sys");
  });
  child.on("error", (err) => {
    job.done = true;
    job.code = 127;
    push("spawn failed: " + err.message, "err");
  });
  return job;
}

function bgJobs() {
  return [...BG.values()];
}

function bgJob(id) {
  return BG.get(id) || null;
}

module.exports = { exec, treeOf, startBg, bgJobs, bgJob };
