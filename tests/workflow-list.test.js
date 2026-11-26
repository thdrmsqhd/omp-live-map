"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { generatedTemplate } = require("../server/engineering/workflow-catalog");

test("템플릿 빠른 실행이 만든 자동 사본만 템플릿 이름으로 구분한다", () => {
  assert.equal(generatedTemplate("코드 리뷰 · 8596a554f652"), "코드 리뷰");
  assert.equal(generatedTemplate("버그 수정 · 0123456789ab"), "버그 수정");
  // 저장된 Workflow 이름, 해시 길이가 다른 이름, 템플릿이 아닌 이름은 사본으로 보지 않는다.
  assert.equal(generatedTemplate("코드 리뷰"), null);
  assert.equal(generatedTemplate("코드 리뷰 · 8596a554f65"), null);
  assert.equal(generatedTemplate("내 리뷰 · 8596a554f652"), null);
  assert.equal(generatedTemplate("코드 리뷰 · 8596A554F652"), null);
});
