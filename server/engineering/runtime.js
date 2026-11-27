"use strict";

const path = require("node:path");
const { hostProcesses, permitted } = require("../infrastructure/host-process");
const { adaptersFor } = require("./adapters");
const { commandRunner } = require("./command-runner");
const { secureRunner } = require("./runner");
const { problem } = require("./state");
const { adapterSpec, adapterIds } = require("./adapter-registry");

// Engineering 실행은 이 PC 에서 고른 작업 폴더에 바로 실행한다(터미널에서 omp·claude 를 직접 띄우는 것과 같다).
// 로그인·모델 설정은 각 CLI 가 이미 가진 것을 그대로 쓴다.
function hostBackend(processes) {
  return {
    enforced: true,
    ompPrompt: path.join(__dirname, "omp-run-prompt.md"),
    supports: (name, model) => Boolean(processes.locate(name)) && (!model?.reasoning || adapterSpec(name)?.reasoning === true),
    launch: (program, args, options, context) => processes.launch(program, args, options, context),
    terminate: (child) => processes.terminate(child),
  };
}

function hostRunner(processes = hostProcesses({ problem })) {
  const backend = hostBackend(processes);
  return { ...secureRunner(adaptersFor(backend), commandRunner(backend, permitted)), backend, shutdown: () => processes.shutdown() };
}

function runtime({ processes = hostProcesses({ problem }) } = {}) {
  let status = "unchecked";
  let detail = "실행 환경 확인이 필요합니다.";
  let found = {};
  let pending;
  const delegate = hostRunner(processes);
  const available = (name) => status === "ready" && Boolean(found[name]) && delegate.available(name);
  async function discover() {
    found = Object.fromEntries(adapterIds.map((id) => [id, processes.locate(id)]));
    const names = adapterIds.filter((id) => found[id]).map((id) => adapterSpec(id).label);
    status = names.length ? "ready" : "unavailable";
    detail = names.length
      ? "이 PC에서 바로 실행 · " + names.join(", ") + " 사용 가능 · 고른 작업 폴더에서 내 계정 권한으로 실행합니다."
      : "omp 또는 claude CLI를 PATH에서 찾지 못했습니다. 터미널에서 omp 나 claude 가 실행되는지 확인해 주세요.";
  }
  function prepare() {
    if (pending) return pending;
    status = "checking";
    detail = "이 PC에 설치된 omp·claude CLI를 확인하는 중입니다.";
    pending = discover().catch(() => {
      status = "unavailable";
      detail = "omp·claude CLI를 확인하지 못했습니다.";
    }).finally(() => { pending = null; });
    return pending;
  }
  return {
    available,
    requireAdapter: (...args) => delegate.requireAdapter(...args),
    verify: (...args) => delegate.verify(...args),
    prepare,
    snapshot: () => delegate,
    shutdown: () => delegate.shutdown(),
    status: () => ({ status, detail, ...Object.fromEntries(adapterIds.map((id) => [id, available(id)])) }),
  };
}

module.exports = { runtime, hostRunner };
