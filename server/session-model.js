// 대화 도중 모델 바꾸기: omp rpc 의 get_available_models·get_state·set_model 을 감싼다. 모듈 상태는 없다.
"use strict";

const { acquire } = require("./sessions");
const harness = require("./harness");
const claudeModel = require("./harness/claude-model");

const errText = (e) => String((e && e.message) || e);
const slim = (m) => (m ? { provider: m.provider || "", id: m.id || "", name: m.name || m.id || "" } : null);

// rpc 명령 하나를 보내 data 를 돌려준다. 실패 응답은 오류로 던진다.
async function call(s, cmd) {
  const r = await s.rpc.send(cmd);
  if (!r.success) throw new Error(r.error || "omp 가 " + cmd.type + " 을 받지 않았습니다");
  return r.data;
}

// 사용 가능한 모델 목록과 지금 모델. 맵이 쥐지 않은 세션은 이어 붙인다(터미널이 쥐면 거부).
async function listModels(node) {
  if (harness.of(node) === "claude") return claudeModel.list(node);
  const { s, err } = await acquire(node);
  if (err) return err;
  try {
    const [list, st] = await Promise.all([call(s, { type: "get_available_models" }), call(s, { type: "get_state" })]);
    return { ok: true, models: ((list && list.models) || []).map(slim), current: slim(st && st.model), busy: s.busy };
  } catch (e) {
    return { ok: false, out: errText(e) };
  }
}

// 모델을 바꾼다. 에이전트가 도는 중이면 omp 는 다음 요청부터 새 모델을 쓴다.
async function setModel(node, provider, id) {
  if (harness.of(node) === "claude") return claudeModel.set(node, id);
  if (!provider || !id) return { ok: false, out: "provider·id 가 필요합니다" };
  const { s, err } = await acquire(node);
  if (err) return err;
  try {
    const m = await call(s, { type: "set_model", provider, modelId: id });
    return { ok: true, model: slim(m) || { provider, id, name: id }, busy: s.busy };
  } catch (e) {
    return { ok: false, out: errText(e) };
  }
}

module.exports = { listModels, setModel };
