// Compose 프로젝트 시작: 컨테이너 inspect의 라벨 JSON을 신뢰 원본으로 삼아 docker compose up -d를 셸 없이 실행한다.
"use strict";

// 이미지 pull·build까지 기다린다. 초과하면 실패로 보고하고 성공으로 꾸미지 않는다.
const START_TIMEOUT = 240000;
const NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

// docker 데몬이 본 리눅스 절대 경로만 받는다. 상대 경로·NUL은 신뢰할 수 없다.
const isAbs = (p) => typeof p === "string" && p.startsWith("/") && !p.includes("\0");

// 요약 라벨 문자열을 정규식으로 푸는 대신 inspect의 Config.Labels JSON 객체를 그대로 쓴다.
async function inspectLabels(run, id) {
  const r = await run(["-e", "docker", "inspect", "--format", "{{json .Config.Labels}}", id], 10000);
  if (r.code !== 0) return null;
  const text = (r.out || "").trim();
  if (!text || text === "null") return null;
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

// 라벨에서 compose 실행 정보를 뽑는다. project 라벨이 요청과 정확히 같을 때만 유효하다.
// config_files는 compose가 콤마로 잇는 단일 라벨 값이라, 그 값만 정확히 읽고 콤마로 나눈다.
function composeInfoFrom(labels, target) {
  if (!labels) return null;
  const project = labels["com.docker.compose.project"];
  if (typeof project !== "string" || project !== target || !NAME.test(project)) return null;
  const files = String(labels["com.docker.compose.project.config_files"] || "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  const workdir = String(labels["com.docker.compose.project.working_dir"] || "").trim();
  if (!files.length || !files.every(isAbs)) {
    return { project, error: "compose 설정 파일 라벨이 없거나 절대 경로가 아닙니다" };
  }
  if (!isAbs(workdir)) {
    return { project, error: "compose 작업 디렉터리 라벨이 없거나 절대 경로가 아닙니다" };
  }
  return { project, files: [...new Set(files)], workdir };
}

function summarize(fields, r, ok, text) {
  return {
    ok,
    code: r.code,
    out: text,
    project: fields.project,
    workingDir: fields.workdir,
    configFiles: fields.files,
  };
}

// members: INFRA.containers에서 project 이름으로 추린 컨테이너 목록(정지 상태 포함).
// 실제 compose 라벨을 가진 멤버가 하나도 없으면 실패한다. docker start 같은 대체 동작은 하지 않는다.
async function startComposeProject(target, members, run) {
  if (!NAME.test(target)) return { ok: false, out: "잘못된 프로젝트 이름: " + target };

  let info = null, errorInfo = null;
  for (const c of members || []) {
    const candidate = composeInfoFrom(await inspectLabels(run, c.id), target);
    if (!candidate) continue;
    if (!candidate.error) { info = candidate; break; }
    errorInfo = errorInfo || candidate;
  }
  if (!info) {
    return {
      ok: false,
      out: errorInfo
        ? `Compose 프로젝트 ${target}를 시작할 수 없음: ${errorInfo.error}`
        : `Compose 프로젝트가 아님: ${target} (compose 라벨을 가진 컨테이너 없음)`,
    };
  }

  const args = ["-e", "docker", "compose"];
  for (const file of info.files) args.push("-f", file);
  args.push("--project-directory", info.workdir, "--project-name", target, "up", "-d");

  const r = await run(args, START_TIMEOUT);
  const tail = (r.out + r.err).trim().slice(-4000);
  if (r.code === 124) {
    return summarize(info, r, false,
      `docker compose up -d가 ${START_TIMEOUT / 1000}초 안에 끝나지 않아 중단했습니다. 컨테이너 상태를 다시 확인하세요.` +
      (tail ? "\n" + tail : ""));
  }
  if (r.code !== 0) {
    return summarize(info, r, false, `docker compose up -d 실패 (종료 코드 ${r.code})` + (tail ? "\n" + tail : ""));
  }
  return summarize(info, r, true, tail || "docker compose up -d 완료");
}

module.exports = { startComposeProject };
