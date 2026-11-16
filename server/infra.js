// WSL·Docker 인벤토리: INFRA 상태 소유, wsl 실행, 컨테이너/배포판 동작.
"use strict";

const { spawn } = require("child_process");
const { startComposeProject } = require("./infra-compose");

let INFRA = { at: 0, distros: [], projects: [], error: null, loading: false };

function decodeWsl(chunks) {
  const buf = Buffer.concat(chunks);
  const utf8 = buf.toString("utf8");
  return utf8.includes("\u0000") ? buf.toString("utf16le").replace(/\uFEFF/g, "") : utf8;
}

function wslRun(args, timeout = 8000) {
  return new Promise((resolve) => {
    const child = spawn("wsl", args, { windowsHide: true });
    const outChunks = [], errChunks = [];
    let done = false;
    const finish = (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code, out: decodeWsl(outChunks), err: decodeWsl(errChunks) });
    };
    const timer = setTimeout(() => { try { child.kill(); } catch {} finish(124); }, timeout);
    child.stdout.on("data", (d) => outChunks.push(d));
    child.stderr.on("data", (d) => errChunks.push(d));
    child.on("error", (e) => { errChunks.push(Buffer.from(e.message)); finish(127); });
    child.on("close", (code) => finish(code));
  });
}

function parseDistros(raw) {
  const text = raw.replace(/\0/g, "").replace(/\r/g, "");
  return text.split("\n").slice(1).map((line) => line.trim()).filter(Boolean).map((line) => {
    const m = line.match(/^\*?\s*(.+?)\s{2,}(\w+)\s+(\d+)\s*$/);
    return m ? { name: m[1].trim(), state: m[2], version: Number(m[3]) } : null;
  }).filter(Boolean);
}

function parseContainers(out) {
  const containers = [];
  for (const line of out.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    try {
      const c = JSON.parse(t);
      const label = c.Labels || "";
      const proj = (label.match(/com\.docker\.compose\.project=([^,]+)/) || [])[1] || "standalone";
      const svc = (label.match(/com\.docker\.compose\.service=([^,]+)/) || [])[1] || "";
      containers.push({
        id: c.ID,
        name: c.Names,
        image: c.Image,
        state: String(c.State || "").toLowerCase(),
        status: c.Status,
        ports: c.Ports,
        command: (c.Command || "").slice(0, 90),
        project: proj,
        service: svc,
      });
    } catch { /* partial line */ }
  }
  return containers;
}

async function refreshInfra() {
  if (INFRA.loading) return INFRA;
  INFRA.loading = true;
  try {
    const list = await wslRun(["-l", "-v"], 6000);
    const distros = parseDistros(list.out || "");
    const running = distros.filter((d) => d.state.toLowerCase() === "running");
    let containers = [], error = null;
    if (!distros.length) error = (list.err || "wsl 목록을 읽을 수 없음").trim().slice(0, 200);
    if (running.length) {
      const ps = await wslRun(["-e", "docker", "ps", "-a", "--format", "{{json .}}"], 12000);
      if (ps.code !== 0) error = (ps.err || ps.out || "docker 조회 실패").trim().split("\n").pop().slice(0, 200);
      containers = parseContainers(ps.out);
    }
    const projects = new Map();
    for (const c of containers) {
      if (!projects.has(c.project)) projects.set(c.project, []);
      projects.get(c.project).push(c);
    }
    INFRA = {
      at: Date.now(),
      distros,
      containers,
      projects: [...projects.entries()].map(([name, items]) => ({
        name,
        up: items.filter((c) => c.state === "running").length,
        total: items.length,
        // 서비스 라벨은 compose가 만든 컨테이너에만 있다. 합성된 'standalone' 묶음은 false.
        compose: items.some((c) => c.service),
      })),
      error,
      loading: false,
    };
  } catch (exc) {
    INFRA = { ...INFRA, error: String(exc).slice(0, 200), loading: false, at: Date.now() };
  }
  return INFRA;
}

// GET /api/infra: 4초보다 오래된 인벤토리면 다시 읽는다.
async function getInfra() {
  if (Date.now() - INFRA.at > 4000) await refreshInfra();
  return INFRA;
}

// POST /api/infra/action: 알려진 컨테이너/배포판/Compose 프로젝트에만 동작을 허용한다.
async function infraAction(target, kind) {
  // Compose 프로젝트 시작은 합성 묶음이 아니라 실제 compose 라벨을 확인한 뒤에만 실행한다.
  if (kind === "project-start") {
    await getInfra();
    const members = (INFRA.containers || []).filter((c) => c.project === target);
    const result = members.length
      ? await startComposeProject(target, members, wslRun)
      : { ok: false, out: (INFRA.error ? `Docker 인벤토리 조회 실패: ${INFRA.error}\n` : "") + "Compose 프로젝트를 찾을 수 없음: " + target };
    INFRA.at = 0;
    await refreshInfra();
    return result;
  }
  const known =
    (INFRA.containers || []).some((c) => c.id === target) || INFRA.distros.some((d) => d.name === target);
  if (!known) return { ok: false, out: "알 수 없는 대상: " + target };
  const args =
    kind === "container-start" ? ["-e", "docker", "start", target] :
    kind === "container-stop" ? ["-e", "docker", "stop", target] :
    kind === "container-restart" ? ["-e", "docker", "restart", target] :
    kind === "distro-start" ? ["-d", target, "-e", "true"] :
    kind === "distro-stop" ? ["--terminate", target] : null;
  if (!args) return { ok: false, out: "알 수 없는 동작: " + kind };
  const result = await wslRun(args, 30000);
  INFRA.at = 0;
  await refreshInfra();
  return { ok: result.code === 0, code: result.code, out: (result.out + result.err).trim().slice(0, 4000) };
}

module.exports = { getInfra, infraAction };
