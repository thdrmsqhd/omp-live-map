"use strict";

const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const version = "2.13.0";
const digest = "b5f3899d80e6ad46e8551563c05b1b84b276460deb27bb786ebc83c84309bb6f";
const url = `https://github.com/anthropics/anthropic-cli/releases/download/v${version}/ant_${version}_windows_amd64.zip`;

async function prepare() {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "omp-ant-"));
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error(`Claude Platform CLI download failed (HTTP ${response.status})`);
    const zip = Buffer.from(await response.arrayBuffer());
    if (createHash("sha256").update(zip).digest("hex") !== digest) {
      throw new Error("Claude Platform CLI archive checksum mismatch");
    }
    const archive = path.join(temporary, "ant.zip");
    await fs.writeFile(archive, zip);
    const files = ["ant.exe", "LICENSE", "LICENSE-MIT"];
    if (process.platform === "win32") execFileSync("tar.exe", ["-xf", archive, "-C", temporary, ...files]);
    else execFileSync("unzip", ["-q", archive, ...files, "-d", temporary]);
    const destination = path.join(__dirname, ".vendor", "ant");
    await fs.mkdir(destination, { recursive: true });
    for (const file of files) await fs.copyFile(path.join(temporary, file), path.join(destination, file));
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}

prepare().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
