"use strict";

const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const { once } = require("node:events");
const fs = require("node:fs/promises");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { promisify } = require("node:util");

async function main() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "omp-ac-"));
  const workspace = path.join(directory, "workspace");
  const privateFile = path.join(directory, "private.txt");
  const listener = net.createServer((socket) => socket.end());
  listener.listen(0, "127.0.0.1");
  try {
    await once(listener, "listening");
    await fs.mkdir(workspace);
    await fs.writeFile(privateFile, "private fixture");
    const args = [workspace, privateFile, String(listener.address().port), "omp.probe." + randomUUID()];
    const result = await promisify(execFile)(path.resolve(process.argv[2]), args, { timeout: 25000 });
    assert.ok(await fs.stat(path.join(workspace, "allowed.txt")));
    assert.equal(await fs.readFile(privateFile, "utf8"), "private fixture");
    process.stdout.write(result.stdout);
    console.log("AppContainer: workspace write, private file denial, loopback denial and child token passed");
  } finally {
    listener.close();
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 3 });
  }
}

main().catch((error) => {
  console.error(error.message, error.stdout, error.stderr);
  process.exitCode = 1;
});
