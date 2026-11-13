// 시스템 정보: 전체 CPU%(2초 표본), 메모리, C: 디스크, 가동 시간.
"use strict";

const fs = require("fs");
const os = require("os");

const cpuTimes = () => os.cpus().map((c) => ({ idle: c.times.idle, total: Object.values(c.times).reduce((a, b) => a + b, 0) }));
let cpuPrev = cpuTimes();
let cpuPct = 0;
setInterval(() => {
  const cur = cpuTimes();
  let idle = 0, total = 0;
  cur.forEach((c, i) => {
    const p = cpuPrev[i] || c;
    idle += c.idle - p.idle;
    total += c.total - p.total;
  });
  cpuPrev = cur;
  if (total > 0) cpuPct = Math.round((1 - idle / total) * 100);
}, 2000).unref();

function sysInfo() {
  const totalMB = Math.round(os.totalmem() / 1048576);
  const freeMB = Math.round(os.freemem() / 1048576);
  let disk = null;
  try {
    const st = fs.statfsSync("C:");
    const totalB = st.blocks * st.bsize;
    const freeB = st.bavail * st.bsize;
    disk = { totalGB: +(totalB / 1073741824).toFixed(1), freeGB: +(freeB / 1073741824).toFixed(1), usedPct: Math.round((1 - freeB / totalB) * 100) };
  } catch { /* statfs unavailable */ }
  return {
    at: Date.now(),
    cpu: { pct: cpuPct, cores: os.cpus().length, model: (os.cpus()[0] || {}).model || "" },
    mem: { totalMB, freeMB, usedMB: totalMB - freeMB, usedPct: Math.round(((totalMB - freeMB) / totalMB) * 100) },
    disk,
    uptimeSec: Math.round(os.uptime()),
  };
}

module.exports = { sysInfo };
