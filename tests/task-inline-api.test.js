"use strict";

// Task 탭은 폼 없이 HTTP API 를 그대로 쓴다: 세션 폴더 → 프로젝트 자동 등록, 한 줄 Task(템플릿 Workflow),
// 칸 이름·순서·추가·삭제, 요약 줄의 예산·기간 제자리 수정, 프로젝트 이름 바꾸기.
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { withLegacyHttp } = require("./helpers/legacy-http");

test("a folder becomes a project on first use and the board, card and budget are edited in place", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "omp-task-inline-"));
  process.env.OMP_MAP_ENGINEERING_DATA = path.join(directory, "engineering");
  try {
    await withLegacyHttp(t, async ({ request }) => {
      async function send(endpoint, payload, expected = 200) {
        const response = await request("/api/engineering/" + endpoint, payload === undefined ? {} : {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
        });
        assert.equal(response.status, expected, endpoint + ": " + response.text);
        return JSON.parse(response.text);
      }
      const root = path.join(directory, "shop-api");
      await fs.mkdir(root);
      execFileSync("git", ["init", "-q", "-b", "trunk"], { cwd: root });
      execFileSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "init", "--allow-empty"], { cwd: root });

      // 1. 폴더를 고르면 프로젝트가 된다: 이름 = 폴더 이름, 브랜치 = 지금 브랜치. 다시 골라도 같은 프로젝트다.
      const project = await send("projects/ensure", { root });
      assert.equal(project.name, "shop-api");
      assert.equal(project.branch, "trunk");
      assert.equal((await send("projects/ensure", { root })).id, project.id);
      const plain = path.join(directory, "notes");
      await fs.mkdir(plain);
      assert.equal((await send("projects/ensure", { root: plain })).branch, "main", "a non-git folder still becomes a project");

      // 2. Backlog ＋ 한 줄: 글 + 템플릿 Workflow. 템플릿은 프로젝트 Workflow 로 한 번 만들어 고정한다.
      const card = await send("tasks", { project: project.id, text: "로그인 버튼이 반응하지 않는 문제 고치기", template: "bugfix" });
      assert.equal(card.status, "backlog");
      assert.equal(card.title, "로그인 버튼이 반응하지 않는 문제 고치기");
      const listed = (await send("tasks?project=" + project.id))[0];
      assert.equal(listed.workflow_name, "버그 수정");
      assert.deepEqual([listed.timeoutMs, listed.budgetCents], [20 * 60000, 6000]);
      const again = await send("tasks", { project: project.id, text: "두 번째", template: "bugfix" });
      assert.equal(again.workflow, card.workflow, "the template workflow is created once");
      await send("tasks", { project: project.id, text: "x", template: "nope" }, 400);
      // 카드에서 숫자·본문을 하나씩 고친다.
      let edited = await send("tasks", { project: project.id, id: card.id, revision: card.revision, budgetCents: 2500 });
      edited = await send("tasks", { project: project.id, id: card.id, revision: edited.revision, instruction: "원인부터\n완료 조건: 버튼을 누르면 로그인된다" });
      assert.equal(edited.budget_cents, 2500);

      // 3. 칸: 더하기 → 이름 바꾸기 → 순서 바꾸기 → 지우기.
      const added = await send("sdlc-stages/add", { project: project.id, label: "새 칸" });
      const custom = added.find(({ builtin }) => !builtin).status;
      const renamed = await send("sdlc-stages", { project: project.id, status: custom, label: "QA" });
      assert.equal(renamed.find(({ status }) => status === custom).label, "QA");
      const order = [custom, ...renamed.map(({ status }) => status).filter((status) => status !== custom)];
      assert.deepEqual((await send("sdlc-stages/order", { project: project.id, order })).map(({ status }) => status), order);
      await send("tasks/move", { id: card.id, status: custom, revision: edited.revision });
      await send("sdlc-stages/remove", { project: project.id, status: "ready" }, 409);
      await send("sdlc-stages/remove", { project: project.id, status: custom });
      assert.equal((await send("tasks?project=" + project.id)).find(({ id }) => id === card.id).status, "backlog");

      // 4. 요약 줄의 예산: 금액 → 기간 → 비우면 제한 없음.
      assert.equal((await send("project-budget?project=" + project.id)).current, null);
      assert.equal((await send("project-budget", { project: project.id, cap: 10000, days: 7 })).current.cap, 10000);
      const period = (await send("project-budget", { project: project.id, cap: 10000, days: 30 })).current;
      assert.deepEqual([period.cap, period.days], [10000, 30]);
      assert.equal((await send("project-budget", { project: project.id, remove: true })).current, null);

      // 5. 프로젝트 카드 ⋯: 이름 바꾸기.
      assert.equal((await send("projects/rename", { id: project.id, name: "쇼핑 API" })).name, "쇼핑 API");
      assert.equal((await send("projects")).find(({ id }) => id === project.id).root, project.root);
    });
  } finally {
    delete process.env.OMP_MAP_ENGINEERING_DATA;
    await fs.rm(directory, { recursive: true, force: true });
  }
});
