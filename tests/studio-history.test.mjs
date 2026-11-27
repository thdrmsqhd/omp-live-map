// 노드 캔버스 되돌리기: 조작 전후가 다를 때만 이력에 남고, 되돌리기·다시 실행이 노드·연결·이름을 함께 복원한다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bindStudioHistory } from "../ui/js/studio-history.js";

function fixture() {
  const nodes = new Map();
  const model = { key: "def:m", kind: "model", draft: { name: "모델" }, ref: {}, x: 0, y: 0, collapsed: false };
  const step = { key: "step:a", kind: "step", data: { id: "a", label: "계획" }, ref: {}, x: 10, y: 20, collapsed: false };
  nodes.set(model.key, model);
  nodes.set(step.key, step);
  const record = { id: "wf" };
  const S = { nodes, workflowName: { value: "버그 수정" }, wf: { record, edges: [{ from: "start", to: "a" }] }, renders: 0, said: "",
    render() { this.renders++; }, say(text) { this.said = text; }, updateToolbar() {} };
  return { S, model, step, history: bindStudioHistory(S) };
}

test("an interaction that changes nothing leaves no history", () => {
  const { history } = fixture();
  history.begin();
  history.commit();
  assert.equal(history.canUndo(), false);
});

test("undo and redo restore added nodes, positions, edges and the workflow name", () => {
  const { S, step, history } = fixture();
  history.begin();
  const added = { key: "def:new", kind: "harness", draft: { name: "새 하네스" }, ref: { model: "def:m" }, x: 5, y: 5, isNew: true };
  S.nodes.set(added.key, added);
  step.x = 300;
  S.wf.edges.push({ from: "a", to: "end" });
  S.workflowName.value = "바뀐 이름";
  history.commit();
  assert.equal(history.canUndo(), true);

  assert.equal(history.undo(), true);
  assert.equal(S.nodes.has("def:new"), false);
  assert.equal(S.nodes.get("step:a").x, 10);
  assert.deepEqual(S.wf.edges, [{ from: "start", to: "a" }]);
  assert.equal(S.workflowName.value, "버그 수정");
  assert.equal(history.canRedo(), true);

  assert.equal(history.redo(), true);
  assert.equal(S.nodes.get("def:new"), added);
  assert.equal(S.nodes.get("step:a").x, 300);
  assert.equal(S.workflowName.value, "바뀐 이름");
});

test("a new edit clears redo and clear() empties both stacks", () => {
  const { S, model, history } = fixture();
  history.begin(); model.x = 50; history.commit();
  history.undo();
  history.begin(); model.y = 70; history.commit();
  assert.equal(history.canRedo(), false);
  history.clear();
  assert.equal(history.canUndo(), false);
  assert.equal(S.nodes.size, 2);
});

test("history does not cross into another workflow", () => {
  const { S, model, history } = fixture();
  history.begin();
  model.x = 99;
  S.wf = { record: { id: "other" }, edges: [] };
  history.commit();
  assert.equal(history.canUndo(), false);
});
