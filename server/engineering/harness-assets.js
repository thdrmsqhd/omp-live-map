"use strict";

const { problem } = require("./state");

function text(value, label, max) {
  if (typeof value !== "string" || value.length > max || value.includes("\0")) throw problem(400, "Invalid " + label);
  return value;
}

// Hooks and MCP settings are saved as review drafts. Execution permissions are owned by the runtime.
function checkedDraft(value, name) {
  if (value === undefined) return {};
  const serialized = JSON.stringify(value);
  if (!value || typeof value !== "object" || Array.isArray(value) || serialized.length > 12000) {
    throw problem(400, "Invalid " + name + " settings draft");
  }
  if (/"(?:env|headers|token|password|secret|api[_-]?key)"\s*:/i.test(serialized) ||
      /sk-ant-[\w-]{10,}|:\/\/[^/@"]+:[^/@"]+@/.test(serialized)) {
    throw problem(400, name + " settings drafts cannot contain credentials");
  }
  return value;
}

function harnessAssets(value) {
  if (value === undefined) return { agents: "", skills: [], mcp: {}, hooks: {} };
  if (!value || typeof value !== "object" || Array.isArray(value)) throw problem(400, "Invalid harness assets");
  const skills = value.skills ?? [];
  if (!Array.isArray(skills) || skills.length > 5) throw problem(400, "Provide up to five skill definitions");
  const parsed = skills.map((skill) => {
    if (!skill || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(skill.name)) throw problem(400, "Invalid skill name");
    return { name: skill.name, markdown: text(skill.markdown, "skill content", 4000) };
  });
  if (new Set(parsed.map((skill) => skill.name)).size !== parsed.length) throw problem(400, "Duplicate skill name");
  return {
    agents: text(value.agents ?? "", "AGENTS.md", 10000),
    skills: parsed,
    mcp: checkedDraft(value.mcp, "MCP"),
    hooks: checkedDraft(value.hooks, "Hooks"),
  };
}

function promptAssets(assets) {
  if (!assets) return "";
  return [assets.agents ? "Profile AGENTS.md:\n" + assets.agents : "",
    ...assets.skills.map(({ name, markdown }) => "Profile skill " + name + ":\n" + markdown)].filter(Boolean).join("\n\n");
}

module.exports = { harnessAssets, promptAssets };
