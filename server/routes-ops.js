// 운영 API: 셸 exec, 백그라운드 잡, 디렉터리 트리, 자원 조회·정리, WSL/Docker.
"use strict";

const { HOME } = require("./config");
const { json, withJson } = require("./edge/http");
const { requireOps } = require("./edge/ops-token");
const { exec, treeOf, startBg, bgJobs, bgJob } = require("./shell");
const { resFor, releaseSet, procState, findProc, reloadProc } = require("./proc");
const { sysInfo } = require("./sys");
const { getInfra, infraAction } = require("./infra");
const lineage = require("./lineage");
const { queryDb } = require("./db");

// 상태를 바꾸거나 명령·SQL 을 실행하는 경로는 requireOps 로 감싼다(조회 경로는 기존 가드만).
module.exports = {
  "* /api/infra": async (req, res) => json(res, await getInfra()),
  "POST /api/infra/action": requireOps((req, res) => withJson(req, res, async (p) => {
    json(res, await infraAction(String(p.target || ""), String(p.kind || "")));
  })),
  "* /api/tree": (req, res, url) => {
    const target = url.searchParams.get("p") || HOME;
    json(res, treeOf(target, Number(url.searchParams.get("d") || 2)));
  },
  "POST /api/bg/start": requireOps((req, res) => withJson(req, res, (p) => {
    const cmd = String(p.cmd || "").trim();
    if (!cmd) return json(res, { ok: false, out: "빈 명령" });
    const job = startBg(String(p.node || ""), String(p.cwd || ""), cmd);
    json(res, { ok: true, id: job.id, cwd: job.cwd });
  })),
  "* /api/bg/list": (req, res, url) => {
    const node = url.searchParams.get("node") || "";
    const jobs = bgJobs()
      .filter((j) => !node || j.node === node)
      .slice(-12)
      .map((j) => ({ id: j.id, node: j.node, cmd: j.cmd, cwd: j.cwd, done: j.done, code: j.code,
        startedAt: j.startedAt, endedAt: j.endedAt, lines: j.lines.slice(-80) }));
    json(res, { at: Date.now(), jobs });
  },
  "POST /api/bg/stop": requireOps((req, res) => withJson(req, res, (p) => {
    const job = bgJob(String(p.id || ""));
    if (!job) return json(res, { ok: false, out: "없는 잡" });
    try { job.proc.kill(); } catch {}
    json(res, { ok: true });
  })),
  "* /api/bg/all": (req, res) => {
    const list = bgJobs().map((j) => ({
      id: j.id, node: j.node, cmd: j.cmd, cwd: j.cwd, done: j.done, code: j.code,
      startedAt: j.startedAt, tail: j.lines.slice(-4).map((l) => l.t),
    }));
    json(res, { at: Date.now(), jobs: list });
  },
  "POST /api/release": requireOps((req, res) => withJson(req, res, (p) => {
    const node = String(p.node || "");
    // 기록이 이미 없어도(세션을 열지 못한 카드) 맵이 이 노드에서 띄운 잡은 정리한다.
    const r = releaseSet(node);
    const killed = [], skipped = [];
    for (const pid of r.all || []) {
      if (pid <= 0 || pid === process.pid) { skipped.push(pid); continue; }
      const proc = findProc(pid);
      if (!proc) { skipped.push(pid); continue; }
      // omp 본체와 에이전트 실행기(__omp_worker)는 죽이지 않는다.
      if (/^omp(\.exe)?$/i.test(proc.name) || proc.cmd.includes("__omp_worker")) { skipped.push(pid); continue; }
      try { process.kill(pid); killed.push({ pid, name: proc.name }); }
      catch (e) { skipped.push(pid); }
    }
    reloadProc();
    json(res, { ok: true, killed, skipped, freedMB: killed.length ? r.mb : 0 });
  })),
  "* /api/sys": (req, res) => json(res, sysInfo()),
  "* /api/res": (req, res, url) => json(res, resFor(lineage.resolve(url.searchParams.get("node") || ""))),
  "* /api/proc": (req, res) => json(res, procState()),
  // DB 조회: 프로필(user·password 포함)과 SQL 한 문장. 비밀번호는 저장하지 않는다.
  "POST /api/db/query": requireOps((req, res) => withJson(req, res, async (p) => {
    json(res, await queryDb(p, String(p.sql || "")));
  })),
  "POST /api/exec": requireOps((req, res) => withJson(req, res, async (payload) => {
    json(res, await exec(String(payload.cwd || ""), String(payload.cmd || "")));
  })),
};
