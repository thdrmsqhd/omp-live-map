// 확장 설치: extension/live-map.ts 를 omp 사용자 확장 폴더(~/.omp/agent/extensions/)로 복사한다.
// omp 는 이 폴더의 .ts/.js 를 시작할 때 자동으로 불러오므로 설정 파일을 건드리지 않는다. 적용은 새 세션부터.
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const src = path.join(__dirname, "live-map.ts");
const agentDir = process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".omp", "agent");
const destDir = path.join(agentDir, "extensions");
const dest = path.join(destDir, "live-map.ts");

fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(src, dest);
console.log(`installed: ${dest}`);
