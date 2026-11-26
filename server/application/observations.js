"use strict";

const { integer, string } = require("../engineering/definitions");

// 수행 기록·프로젝트 문서·독립 평가를 읽는 쪽만 모은다. 실행 상태를 바꾸는 함수는 두지 않는다.
function createObservationReads({ definitions, flowRuns, evaluation, observability, projectContext, workflowLive }) {
  return {
    async get(endpoint, url) {
      const query = (key) => string(url.searchParams.get(key), key);
      if (endpoint === "projects" && url.searchParams.get("context") === "1") {
        return { value: await projectContext(definitions.project(query("project")), url.searchParams.get("source")) };
      }
      if (endpoint === "workflow-approvals") return { value: observability.approvals(query("project")) };
      if (endpoint === "independent-evaluation") return { value: evaluation.inspect(query("project"), url.searchParams.get("id")) };
      if (endpoint === "workflow-dashboard") {
        return { value: observability.dashboard(query("project"), integer(Number(url.searchParams.get("days") ?? 30), "metrics period", 1, 90)) };
      }
      if (endpoint === "workflow-review") return { value: await observability.review(query("id")) };
      if (endpoint === "workflow-artifact") return { value: await observability.artifact(query("id"), query("node"), query("path")) };
      if (endpoint === "workflow-transcript") {
        flowRuns.get(query("id"));
        return { value: workflowLive.transcript(query("id"), query("node")) };
      }
      return null;
    },
    live(id) {
      return workflowLive.snapshot(id);
    },
  };
}

module.exports = { createObservationReads };
