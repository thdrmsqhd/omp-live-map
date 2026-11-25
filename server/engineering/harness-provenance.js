"use strict";

function executionDefinitions(harness, model) {
  return {
    harness: { id: harness.id, name: harness.payload.name, version: harness.version, adapter: harness.payload.adapter },
    model: { id: model.id, name: model.payload.name, version: model.version, model: model.payload.model,
      provider: model.payload.provider, reasoning: model.payload.reasoning },
  };
}

module.exports = { executionDefinitions };
