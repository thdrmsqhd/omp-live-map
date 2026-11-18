// 터미널 omp 가 세션을 쥐고 있는지 묻는다(`omp session lease --json`). 확인 실패는 쥐지 않음으로 본다.
"use strict";

const { execFile } = require("child_process");

function isHeld(id) {
  return new Promise((resolve) => {
    execFile("omp", ["session", "lease", "--json", "--", id], { windowsHide: true, timeout: 15000 }, (err, out) => {
      try {
        const text = String(out || "");
        resolve((JSON.parse(text.slice(text.indexOf("{"))).held || []).includes(id));
      } catch {
        resolve(false);
      }
    });
  });
}

module.exports = { isHeld };
