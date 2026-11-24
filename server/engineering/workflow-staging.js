"use strict";

const { event } = require("./catalog");
const { githubCli } = require("./github-cli");
const { problem } = require("./state");

const filename = "omp-staging.yml";

function workflowStaging(db, delivery, gh = githubCli) {
  const get = (id) => db.prepare("SELECT * FROM workflow_staging WHERE run=?").get(id) ?? null;

  async function reconcile(row) {
    const state = get(row.run);
    const endpoint = `repos/${row.repository}/actions/workflows/${filename}/runs`;
    const result = await gh(endpoint, "GET", { event: "workflow_dispatch", branch: row.head, head_sha: row.sha, per_page: "100" });
    const matches = (result.workflow_runs ?? []).filter((item) => item.display_title === "omp-" + row.run &&
      item.head_sha === row.sha && item.head_branch === row.head && Number.isSafeInteger(item.id) &&
      item.html_url === `https://github.com/${row.repository}/actions/runs/${item.id}`);
    if (matches.length > 1) throw problem(409, "More than one staging run matches this deployment approval");
    if (!matches.length) return state;
    const [run] = matches;
    db.prepare("UPDATE workflow_staging SET state='linked',workflow_run=?,url=?,conclusion=? WHERE run=?")
      .run(run.id, run.html_url, run.conclusion ?? null, row.run);
    if (!state.workflow_run) event(db, "workflow.staging.linked", { id: row.run, url: run.html_url });
    return get(row.run);
  }

  return {
    get,
    dispatch(id, environment) {
      if (!["test", "staging"].includes(environment)) throw problem(400, "Choose test or staging");
      return delivery.withStaging(id, async (row, check) => {
        const existing = get(id);
        if (existing) return reconcile(row);
        await check();
        const file = await gh(`repos/${row.repository}/contents/.github/workflows/${filename}`, "GET", { ref: row.sha });
        if (file.type !== "file" || file.path !== ".github/workflows/" + filename) throw problem(409, "Approved staging workflow is missing");
        db.prepare("INSERT INTO workflow_staging (run,environment,state,approved) VALUES (?,?,'dispatching',?)")
          .run(id, environment, Date.now());
        event(db, "workflow.staging.approved", { id, environment, sha: row.sha });
        await gh(`repos/${row.repository}/actions/workflows/${filename}/dispatches`, "POST", {
          ref: row.head, inputs: { environment, approved_sha: row.sha, deployment_id: id },
        });
        db.prepare("UPDATE workflow_staging SET state='dispatched' WHERE run=?").run(id);
        return get(id);
      });
    },
  };
}

module.exports = { workflowStaging };
