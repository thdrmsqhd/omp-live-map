"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const childProcess = require("node:child_process");
const shell = require("../server/shell");

// 프로세스 목록만 고정하고 실제 PID에는 신호를 보내지 않는다.
test("세션의 맵 백그라운드 잡만 정리하고 같은 폴더의 다른 터미널은 보존한다", async () => {
  const originalSpawn = childProcess.spawn;
  const originalJobs = shell.bgJobs;
  const procs = [
    { ProcessId: 100, ParentProcessId: 1, Name: "bash.exe", CommandLine: "bash job", WorkingSetSize: 1048576 },
    { ProcessId: 101, ParentProcessId: 100, Name: "node.exe", CommandLine: "node child", WorkingSetSize: 2097152 },
    { ProcessId: 200, ParentProcessId: 1, Name: "terminal.exe", CommandLine: "terminal C:/workspace/project/tool", WorkingSetSize: 4194304 },
    { ProcessId: 201, ParentProcessId: 200, Name: "node.exe", CommandLine: "node server.js", WorkingSetSize: 8388608 },
    { ProcessId: 300, ParentProcessId: 1, Name: "bash.exe", CommandLine: "bash other job", WorkingSetSize: 1048576 },
  ];
  childProcess.spawn = () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    process.nextTick(() => { child.stdout.emit("data", JSON.stringify(procs)); child.emit("close", 0); });
    return child;
  };
  shell.bgJobs = () => [
    { node: "session-a", done: false, proc: { pid: 100 } },
    { node: "session-b", done: false, proc: { pid: 300 } },
  ];
  try {
    const proc = require("../server/proc");
    await proc.refreshProc();
    assert.deepEqual(new Set(proc.releaseSet("session-a").all), new Set([100, 101]));
  } finally {
    childProcess.spawn = originalSpawn;
    shell.bgJobs = originalJobs;
  }
});
