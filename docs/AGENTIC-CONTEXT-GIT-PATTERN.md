# Agentic context + git pattern (proposal)

**Goal:** Commit planning and context markdown files so they live in git, give agents and humans a single source of truth, and survive across sessions and handoffs.

---

## What's out there

- **AGENTS.md** ([agents.md](https://agents.md/)) – Single root file for *project-wide* agent instructions (build, test, conventions). Not for feature-level planning.
- **.context/** ([Codebase Context Spec](https://github.com/Agentic-Insights/codebase-context-spec)) – Directory with `index.md` (and optional YAML/JSON) for architecture, conventions, design decisions. Tool-agnostic; can nest by area.
- **docs/** – Generic place for planning/design docs; we use it for `AI_ROOT_CONTEXT.md`, feature end-states, migrations.
- **Git as memory** – Letta "context repositories," GitHub repo-memory: context files in the repo, versioned with commits so agents (and people) get history and branching.

Common idea: **context and planning as normal files in the repo, committed on the same branch as the work**, so the next session or another agent can open the branch and read the plan.

---

## Our approach

### 1. Use `docs/` for context and planning

- **`docs/AI_ROOT_CONTEXT.md`** – Project overview, layout, deployment. "Start here" for agents and onboarding.
- **`docs/<FEATURE>-*.md`** or **`docs/<AREA>-*.md`** – Planning, end-state, or migration for a feature/area (e.g. `SHOP-EXPERIENCE-END-STATE.md`, `INFRA-NAMESPACE-MIGRATION.md`).
- Stay **flat in `docs/`** with descriptive names unless the number of files grows; then consider `docs/planning/` for planning-only.

### 2. When to commit context docs

- **With the work:** Commit the context/planning doc in the **same branch and PR** as the implementation (e.g. first commit: "docs: add SHOP-EXPERIENCE-END-STATE" then implement; or plan + implementation in one PR).
- Git history then carries "this branch is about X, and here's the plan."

### 3. Entry point for agents

- Root **`AGENTS.md`** points at `docs/AI_ROOT_CONTEXT.md` and `docs/`, and tells agents to check `docs/` for planning before starting a feature.

### 4. What to put in planning docs

- **End-state / vision:** Target UX, schema, APIs.
- **Migrations / big changes:** Steps, order, rollback.
- **Decisions:** "We chose X because Y" so future work doesn't reverse it by accident.

Keep them **short and directive**.

---

## Summary

| Decision | Choice |
|----------|--------|
| **Where** | `docs/`; optional `docs/planning/` later if needed. |
| **When** | Commit planning/context docs on the **same branch/PR** as the implementation. |
| **Entry point** | Root `AGENTS.md` → `docs/AI_ROOT_CONTEXT.md` and `docs/`. |
| **Naming** | Descriptive: `FEATURE-END-STATE.md`, `AREA-MIGRATION.md`, etc. |

---

## References

- [AGENTS.md](https://agents.md/) – Root-level agent instructions.
- [Codebase Context Specification](https://github.com/Agentic-Insights/codebase-context-spec) – `.context/` and index.md.
- [Tweag Agentic Coding Handbook – Project instructions](https://tweag.github.io/agentic-coding-handbook/PRJ_INSTRUCTIONS/).
- [Letta – Context Repositories (git-based memory)](https://www.letta.com/blog/context-repositories).
