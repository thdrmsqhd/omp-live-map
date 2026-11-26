"use strict";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const { projectContext } = require("../server/engineering/project-context");
const { withLegacyHttp } = require("./helpers/legacy-http");

async function fixture(t) {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "omp-context-"));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const root = await fs.realpath(await fs.mkdir(path.join(parent, "project"), { recursive: true }));
  return { parent, project: { id: "fixture", name: "Fixture", root } };
}

test("project context summarizes only selected local documents and reads live UTF-8 previews", async (t) => {
  const { project, parent } = await fixture(t);
  const write = (name, text) => fs.writeFile(path.join(project.root, name), text);
  const readme = "# Fixture\n\n## Purpose\n\nA local workspace for documentation.\n\n```md\n## Decisions\nThis is a code sample, not a decision.\n```\n\n## Decisions\n\n| Choice | Explanation |\n|---|---|\n| Worktree | Use a separate worktree for runs. |\n";
  await Promise.all([
    write("README.md", readme), write("PROGRESS.md", "# Status\n- [x] Finished the initial setup.\n- [ ] Verify the pending workspace change.\n"),
    write("DECISIONS.txt", "Local-only document access is intentional."), write("internal-notes.md", "not allowlisted"),
    write("README.txt", Buffer.from([0x61, 0x00, 0xff])), write("STATUS.txt", "한".repeat(40000)),
    fs.writeFile(path.join(parent, "PROJECT.md"), "must not appear from an ancestor"),
  ]);
  const data = await projectContext(project);
  assert.deepEqual(data.project, { id: "fixture", name: "Fixture" });
  assert.deepEqual(data.sources.map(({ id }) => id), ["README.md", "PROGRESS.md", "STATUS.txt", "DECISIONS.txt"]);
  assert.deepEqual(data.summary.purpose[0], { kind: "purpose", source: "README.md", heading: "Purpose", line: 5, text: "A local workspace for documentation." });
  assert.match(data.summary.progress[0].text, /Verify the pending/);
  assert.deepEqual(data.summary.decisions.map(({ text }) => text), ["Worktree · Use a separate worktree for runs.", "Local-only document access is intentional."]);
  assert.ok(!JSON.stringify(data).includes(project.root));
  assert.equal((await projectContext(project, "README.md")).text, readme);
  const long = await projectContext(project, "STATUS.txt");
  assert.equal(long.truncated, true);
  assert.equal(Buffer.byteLength(long.text), 32766);
  assert.doesNotMatch(long.text, /�/);
  for (const name of ["../PROJECT.md", "docs/../README.md", "readme.md", "README.md:secret", "internal-notes.md", "README.txt", project.root + "/README.md"]) {
    await assert.rejects(projectContext(project, name), { status: 404 });
  }
  await write("README.md", "# Updated\n\nA revised purpose in the same project.\n");
  const updated = await projectContext(project);
  assert.notEqual(updated.sources[0].version, data.sources[0].version);
  assert.match(updated.summary.purpose[0].text, /revised purpose/);
});

test("project context rejects linked directory paths, hardlinked files, and symlink targets", async (t) => {
  const { project, parent } = await fixture(t);
  const outside = await fs.mkdir(path.join(parent, "outside"), { recursive: true });
  const secret = path.join(outside, "status.txt");
  await fs.writeFile(secret, "An outside file that must not be returned.");
  await fs.writeFile(path.join(outside, "README.md"), "An outside README that must not be returned.");
  await fs.symlink(outside, path.join(project.root, "docs"), process.platform === "win32" ? "junction" : "dir");
  await fs.link(secret, path.join(project.root, "STATUS.txt"));
  try {
    await fs.symlink(path.join(outside, "README.md"), path.join(project.root, "README.md"), "file");
  } catch (error) {
    if (process.platform !== "win32" || !["EPERM", "EACCES"].includes(error.code)) throw error;
    t.diagnostic("Windows file symlinks need Developer Mode; junction and hardlink checks still ran.");
  }
  assert.deepEqual((await projectContext(project)).sources, []);
  assert.deepEqual((await projectContext({ ...project, root: path.join(project.root, "docs") })).sources, []);
  for (const name of ["docs/README.md", "STATUS.txt", "README.md"]) await assert.rejects(projectContext(project, name), { status: 404 });
});

test("document scope remains behind the existing desktop projects GET and does not change ordinary listing", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "omp-context-api-"));
  const token = randomBytes(32).toString("hex");
  process.env.OMP_MAP_ENGINEERING_TOKEN = token;
  process.env.OMP_MAP_ENGINEERING_DATA = directory;
  try {
    await withLegacyHttp(t, async ({ request, directory: work }) => {
      const endpoint = "/api/engineering/projects";
      const context = endpoint + "?context=1&project=";
      const headers = { "x-omp-engineering-token": token };
      assert.equal((await request(context + "unknown")).status, 403);
      assert.equal((await request(context + "unknown", { headers: { ...headers, origin: "https://example.invalid" } })).status, 403);
      assert.equal((await request(context + "unknown", { headers })).status, 404);
      assert.equal((await request(endpoint + "?context=1", { headers })).status, 400);
      for (const name of ["One", "Two"]) {
        const root = await fs.mkdtemp(path.join(work, "project-"));
        execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
        execFileSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "fixture", "--allow-empty"], { cwd: root });
        await fs.writeFile(path.join(root, "README.md"), `# ${name}\n\nDocumentation is scoped to project ${name}.\n`);
        const saved = await request(endpoint, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ name, root }) });
        assert.equal(saved.status, 200, saved.text);
      }
      const projects = JSON.parse((await request(endpoint, { headers })).text);
      assert.deepEqual(projects.map(({ name }) => name), ["One", "Two"]);
      const result = await request(context + projects[1].id, { headers });
      assert.equal(result.status, 200);
      assert.equal(result.headers["cache-control"], "no-store");
      assert.match(result.text, /scoped to project Two/);
      assert.doesNotMatch(result.text, /scoped to project One/);
      const source = await request(context + projects[1].id + "&source=README.md", { headers });
      assert.equal(source.status, 200);
      assert.match(JSON.parse(source.text).text, /project Two/);
    });
  } finally {
    delete process.env.OMP_MAP_ENGINEERING_TOKEN;
    delete process.env.OMP_MAP_ENGINEERING_DATA;
    // The route owns the SQLite handle until this isolated test process exits.
    if (process.platform !== "win32") await fs.rm(directory, { force: true, recursive: true });
  }
});

class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.handlers = {}; this.hidden = false; }
  set textContent(value) { this.replaceChildren(value); }
  get textContent() { return this.children.map((child) => typeof child === "string" ? child : child.textContent).join(""); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(key, value) { this[key] = value; }
  addEventListener(key, listener) { this.handlers[key] = listener; }
  getClientRects() { return this.hidden ? [] : [{}]; }
  find(tag) { return this.tag === tag ? this : this.children.filter((child) => child instanceof Element).map((child) => child.find(tag)).find(Boolean); }
  focus() {}
  scrollIntoView() {}
}

test("sidebar ignores stale projects, links readable source, refreshes on a visible interval, and stops when closed", async () => {
  const code = await fs.readFile(path.join(__dirname, "../ui/js/view/unified-project-context.js"), "utf8");
  const root = new Element("aside");
  const calls = [];
  let tick;
  const document = { createElement: (tag) => new Element(tag), getElementById: () => root, addEventListener() {} };
  const window = {
    setInterval(fn, delay) { assert.equal(delay, 5000); tick = fn; return 7; },
    clearInterval(id) { assert.equal(id, 7); tick = undefined; },
    engineeringDesktop: { request: (endpoint, params) => new Promise((resolve) => calls.push({ endpoint, params, resolve })) },
  };
  const settle = () => new Promise(setImmediate);
  const resolve = (index, value) => calls[index].resolve({ ok: true, value });
  const source = "README.md";
  const payload = (id, text, version) => ({ project: { id, name: id }, summary: { purpose: [{ text, source, line: 2 }] }, sources: [{ id: source, title: "README", version }] });
  vm.runInNewContext(code, { window, document });
  const { show, hide } = window.UnifiedProjectContext;
  show("first");
  show("second");
  assert.equal(calls[1].endpoint, "projects");
  assert.equal(calls[1].params.context, "1");
  resolve(1, payload("second", "<b>literal text</b>", "old"));
  await settle();
  resolve(0, payload("first", "stale project", "unused"));
  await settle();
  assert.match(root.textContent, /<b>literal text<\/b>/);
  assert.equal(root.find("b"), undefined);
  assert.doesNotMatch(root.textContent, /stale project/);
  root.find("a").handlers.click({ preventDefault() {} });
  assert.equal(calls[2].params.source, source);
  resolve(2, { id: source, text: "# README\nold text", version: "old" });
  await settle();
  assert.equal(root.find("mark").textContent, "old text");
  document.hidden = true;
  tick();
  assert.equal(calls.length, 3);
  document.hidden = false;
  tick();
  resolve(3, payload("second", "new excerpt", "new"));
  await settle();
  assert.equal(calls[4].params.source, source);
  resolve(4, { id: source, text: "# README\nnew text", version: "new" });
  await settle();
  assert.equal(root.find("mark").textContent, "new text");
  hide();
  assert.equal(root.hidden, true);
  assert.equal(tick, undefined);
  delete window.engineeringDesktop;
  show("second");
  assert.match(root.textContent, /데스크톱 앱/);
  assert.equal(calls.length, 5);
});
