"use strict";

// Engineering 모델 정의에서 고를 수 있는 Anthropic 모델 이름.
// 최신 모델을 앞에 둔다(모델 선택 목록이 이 순서로 나온다). 이전 모델은 이미 저장된 정의가 계속 실행되도록 남긴다.
const models = new Set(["claude-fable-5-2", "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5",
  "claude-sonnet-4-6", "claude-haiku-4-5-20251001"]);

module.exports = { models };
