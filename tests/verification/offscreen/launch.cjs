// 검증 전용 Electron 런처: desktop/main.cjs 를 고치지 않고 그대로 실행하되, 창은 화면 밖(-32000,-32000)·포커스 불가·작업 표시줄 없음으로
// 만들어 검증 중에도 사용자의 마우스·키보드·창 포커스를 건드리지 않는다. 디버그 포트는 OLM_CDP_PORT(없으면 9334)로 연다.
// 시작 오류 대화상자도 띄우지 않고 표준 오류로 쓴다. tests/verification/desktop-launch.cjs 가 쓴다.
"use strict";
const Module = require("node:module");
const path = require("node:path");
const electron = require("electron");

electron.app.commandLine.appendSwitch("remote-debugging-port", process.env.OLM_CDP_PORT || "9334");
const Base = electron.BrowserWindow;
class OffscreenWindow extends Base {
  constructor(options = {}) {
    super({ ...options, x: -32000, y: -32000, width: 1440, height: 900, focusable: false, skipTaskbar: true });
  }
  focus() {}
}
const dialog = new Proxy(electron.dialog, {
  get: (target, key) => (key === "showErrorBox" ? (title, text) => process.stderr.write("[dialog] " + title + ": " + text + "\n") : target[key]),
});
const proxy = new Proxy(electron, { get: (target, key) => (key === "BrowserWindow" ? OffscreenWindow : key === "dialog" ? dialog : target[key]) });
const load = Module._load;
Module._load = function (request, ...rest) {
  if (request === "electron") return proxy;
  return load.call(this, request, ...rest);
};
require(path.resolve(__dirname, "../../../desktop/main.cjs"));
