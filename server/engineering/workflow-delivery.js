"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { event, git } = require("./catalog");
const { problem } = require("./state");
const { string } = require("./definitions");
const { githubCli } = require("./github-cli");
const { artifactPath } = require("./graph-definition");
const { copyFile } = require("./workflow-parallel");
const shadow = require("./shadow-repo");

function githubRepository(remote) {
  const prefix = /^(?:https:\/\/github\.com\/|git@github\.com:)/;
  if (!prefix.test(remote)) throw problem(409, "The project origin must point to GitHub");
  const repository = remote.replace(prefix, "").replace(/\.git$/, "");
  if (!/^[a-z\d][a-z\d-]{0,38}\/[a-z\d_.-]{1,100}$/i.test(repository)) throw problem(409, "Invalid GitHub repository");
  return repository;
}

function workflowDelivery(db, runs, catalog, workspaceRoot, gh = githubCli, gitCall = git) {
  const locks = new Set();
  const get = (id) => db.prepare("SELECT * FROM workflow_delivery WHERE run=?").get(id) ?? null;
  async function withRun(id, action) {
    if (locks.has(id)) throw problem(409, "Another delivery operation is in progress");
    locks.add(id);
    try { return await action(); } finally { locks.delete(id); }
  }

  async function owned(id, message) {
    const run = runs.get(id);
    if (run.status !== "succeeded" || !run.workspace) throw problem(409, message);
    const workspace = await fs.realpath(run.workspace), root = await fs.realpath(workspaceRoot);
    if (path.dirname(workspace) !== root || path.basename(workspace) !== id) throw problem(409, "Invalid workflow worktree");
    return { run, workspace };
  }
  async function commit(id) {
    const { run, workspace } = await owned(id, "Complete the workflow before approving its commit");
    const [changes, head, remote] = await Promise.all([
      gitCall(workspace, ["--no-optional-locks", "status", "--porcelain=v1", "--untracked-files=all"]),
      gitCall(workspace, ["rev-parse", "--verify", "HEAD"]),
      gitCall(workspace, ["remote", "get-url", "origin"]).catch(() => {
        throw problem(409, "GitHub remote(origin)가 없어 PR을 만들 수 없습니다. ‘폴더에 반영’으로 작업 폴더에 바로 반영하세요.");
      }),
    ]);
    if (changes || !/^[a-f0-9]{40}$/i.test(head)) throw problem(409, "Review and commit every worktree change before approval");
    return { run, workspace, sha: head, repository: githubRepository(remote), base: catalog.project(run.project).branch };
  }
  function approved(id) {
    const row = get(id);
    if (!row) throw problem(409, "Approve the reviewed commit first");
    return row;
  }
  async function assertCurrent(id, row) {
    const latest = await commit(id);
    if (latest.sha !== row.sha || latest.repository !== row.repository || latest.base !== row.base) {
      throw problem(409, "The approved commit, repository, or base changed");
    }
  }

  function checkPR(row, item) {
    if (item?.head?.sha !== row.sha || item?.head?.ref !== row.head || item?.base?.ref !== row.base ||
        item?.head?.repo?.full_name?.toLowerCase() !== row.repository.toLowerCase() ||
        item?.base?.repo?.full_name?.toLowerCase() !== row.repository.toLowerCase() ||
        !Number.isSafeInteger(item.number) || item.html_url !== `https://github.com/${item.base.repo.full_name}/pull/${item.number}`) {
      throw problem(409, "GitHub PR does not match the approved commit and branch");
    }
    return item;
  }

  async function ci(row) {
    if (row.state !== "created") throw problem(409, "Create or reconcile the pull request first");
    const [item, checks, statuses] = await Promise.all([
      gh(`repos/${row.repository}/pulls/${row.pr_number}`),
      gh(`repos/${row.repository}/commits/${row.sha}/check-runs?per_page=100`),
      gh(`repos/${row.repository}/commits/${row.sha}/status?per_page=100`),
    ]);
    checkPR(row, item);
    const list = checks.check_runs;
    let result = "pending";
    if (list.some((check) => check.status === "completed" && !["success", "neutral", "skipped"].includes(check.conclusion)) ||
        (statuses.total_count && ["failure", "error"].includes(statuses.state))) result = "failed";
    else if (checks.total_count <= list.length && list.every((check) => check.status === "completed") &&
        (!statuses.total_count || statuses.state === "success") &&
        (list.some((check) => check.conclusion === "success") || statuses.state === "success")) result = "passed";
    db.prepare(`UPDATE workflow_delivery SET ci_status=?,ci_checked=?,
      release_approved=CASE WHEN ?='passed' THEN release_approved ELSE NULL END WHERE run=?`).run(result, Date.now(), result, row.run);
    return result;
  }

  async function remoteHead(row) {
    const branch = row.head.split("/").map(encodeURIComponent).join("/");
    const remote = await gh(`repos/${row.repository}/git/ref/heads/${branch}`);
    if (remote?.object?.sha !== row.sha) throw problem(409, "Push the exact approved commit to the named GitHub branch");
  }
  return {
    get,
    withStaging(id, action) { return withRun(id, async () => {
      const row = approved(id);
      if (!row.release_approved) throw problem(409, "Approve the release candidate before staging deployment");
      return action(row, async () => {
        await assertCurrent(id, row);
        if (await ci(row) !== "passed") throw problem(409, "CI must still pass before staging deployment");
        await remoteHead(row);
      });
    }); },
    approve(id, branch) { return withRun(id, async () => {
      const candidate = await commit(id);
      const head = string(branch, "head branch", 200);
      if (head === candidate.base || head.startsWith("-")) throw problem(400, "Choose a branch different from the base");
      try { await gitCall(candidate.workspace, ["check-ref-format", "refs/heads/" + head]); } catch { throw problem(400, "Invalid head branch"); }
      if (get(id)?.state && get(id).state !== "approved") throw problem(409, "This run already has a PR request; use a new run");
      db.prepare(`INSERT INTO workflow_delivery (run,repository,base,head,sha,approved,state) VALUES (?,?,?,?,?,?,'approved')
        ON CONFLICT(run) DO UPDATE SET repository=excluded.repository,base=excluded.base,head=excluded.head,
        sha=excluded.sha,approved=excluded.approved`).run(id, candidate.repository, candidate.base, head, candidate.sha, Date.now());
      event(db, "workflow.commit.approved", { id, sha: candidate.sha });
      return get(id);
    }); },
    createPR(id) { return withRun(id, async () => {
      const row = approved(id);
      await assertCurrent(id, row);
      if (row.state === "created") return row;
      await remoteHead(row);
      const owner = row.repository.split("/")[0];
      const existing = await gh(`repos/${row.repository}/pulls`, "GET", { state: "all", head: owner + ":" + row.head, base: row.base });
      if (existing.length > 1) throw problem(409, "More than one pull request matches this head and base");
      let pr = existing[0];
      if (!pr) {
        if (row.state === "creating") throw problem(409, "Previous PR attempt is uncertain; this operation will only reconcile an existing PR");
        const claim = db.prepare("UPDATE workflow_delivery SET state='creating' WHERE run=? AND state='approved' AND approved=?")
          .run(id, row.approved);
        if (!claim.changes) throw problem(409, "PR request already claimed; reconcile the existing request");
        pr = await gh(`repos/${row.repository}/pulls`, "POST", { title: runs.get(id).title, head: row.head, base: row.base,
          body: "Created for the approved workflow commit " + row.sha });
      }
      checkPR(row, pr);
      db.prepare("UPDATE workflow_delivery SET state='created',pr_number=?,pr_url=? WHERE run=?").run(pr.number, pr.html_url, id);
      event(db, "workflow.pr.linked", { id, url: pr.html_url });
      return get(id);
    }); },
    // 충돌 하나면 전부 쓰지 않는다: 일부만 반영하면 사용자 폴더가 실행 결과도 원래 상태도 아닌 채로 남기 때문이다.
    // ponytail: 반영 여부를 저장하지 않아 다시 눌러도 같은 결과가 되는 것으로 충분하다. 반영 표시가 필요하면 workflow_delivery 에 열을 추가한다.
    applyToFolder(id) { return withRun(id, async () => {
      const { run, workspace } = await owned(id, "실행이 성공한 뒤에 폴더에 반영할 수 있습니다");
      const root = catalog.project(run.project).root;
      const [tracked, added] = await Promise.all([
        gitCall(workspace, ["diff", "--name-only", "-z", "--no-renames", "HEAD"]),
        // 실행 보고서(.workflow-output)는 앱에서 보는 산출물이라 작업 폴더에 쓰지 않는다.
        gitCall(workspace, ["ls-files", "-z", "--others", "--exclude-standard", "--", ".", ":(exclude).workflow-output"]),
      ]);
      const names = [...new Set([...tracked.split("\0"), ...added.split("\0")].filter(Boolean))];
      if (names.length > 5000) throw problem(409, "폴더에 반영할 파일이 5,000개를 넘습니다");
      const kind = (file) => fs.lstat(file).then((stat) => stat.isFile() ? "file" : "other",
        (error) => { if (["ENOENT", "ENOTDIR"].includes(error.code)) return ""; throw error; });
      const blob = async (file, p) => await kind(file) === "file" ? gitCall(workspace, ["hash-object", "--path=" + p, "--", file]) : "";
      const changes = [], conflicts = [];
      for (const name of names) {
        const p = artifactPath(name), file = path.join(workspace, p), target = path.join(root, p);
        const [before, after, current] = [
          await gitCall(workspace, ["rev-parse", "--verify", "-q", "HEAD:" + p]).catch(() => ""),
          await blob(file, p),
          await blob(target, p),
        ];
        if ([await kind(file), await kind(target)].includes("other") || (current !== before && current !== after)) conflicts.push(p);
        else changes.push({ p, after, skip: current === after });
      }
      if (conflicts.length) {
        throw problem(409, "실행 뒤 작업 폴더에서 바뀐 파일이 있어 반영하지 않았습니다: " + conflicts.slice(0, 20).join(", ") +
          (conflicts.length > 20 ? ` 외 ${conflicts.length - 20}개` : ""));
      }
      for (const { p, after, skip } of changes) {
        if (skip) continue;
        if (after === "") await fs.rm(path.join(root, p), { force: true });
        else await copyFile(workspace, root, p);
      }
      await shadow.snapshot(root);
      event(db, "workflow.folder.applied", { id, files: names.length });
      return { root, files: names.map(artifactPath) };
    }); },
    checkCI(id) { return withRun(id, async () => { await ci(approved(id)); return get(id); }); },
    approveRelease(id) { return withRun(id, async () => {
      const row = approved(id);
      await assertCurrent(id, row);
      if (await ci(row) !== "passed") throw problem(409, "Required CI checks have not passed");
      db.prepare("UPDATE workflow_delivery SET release_approved=? WHERE run=?").run(Date.now(), id);
      event(db, "workflow.release.approved", { id, sha: row.sha });
      return get(id);
    }); },
  };
}
module.exports = { workflowDelivery };
