"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { app, safeStorage } = require("electron");

const location = () => path.join(app.getPath("userData"), "anthropic-key.dpapi");
const available = () => process.platform === "win32" && safeStorage.isEncryptionAvailable();

function load() {
  if (!available()) return null;
  try { return safeStorage.decryptString(fs.readFileSync(location())); }
  catch { return null; }
}

function save(value) {
  if (typeof value !== "string" || !/^sk-ant-[A-Za-z0-9_-]{15,240}$/.test(value)) {
    throw new Error("Anthropic API 키 형식을 확인해 주세요.");
  }
  if (!available()) throw new Error("Windows 사용자 비밀 저장소를 사용할 수 없습니다.");
  fs.mkdirSync(app.getPath("userData"), { recursive: true });
  const target = location();
  const temporary = target + "." + randomUUID() + ".tmp";
  try {
    fs.writeFileSync(temporary, safeStorage.encryptString(value), { flag: "wx", mode: 0o600 });
    fs.renameSync(temporary, target);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

function remove() {
  fs.rmSync(location(), { force: true });
}

module.exports = { load, save, remove };
