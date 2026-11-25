# V5 Claude harness

Initial implementation: bounded JSONL reader, truncation/inode reset, cache TTL, run limit, guarded process cleanup, stderr diagnostics, configurable permission/effort, CLI status probe, CLI default model. Retain per-turn process to avoid idle memory. Persistent protocol, server queue, native approvals, OAuth login UI, live authenticated tests and remaining CC requirements are open. No real credentials used in CI.
