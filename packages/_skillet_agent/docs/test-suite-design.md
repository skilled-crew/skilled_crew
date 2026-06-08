# skillet_agent — Test Suite Design

*Created: 2026-04-18*

---

## Goals

1. Catch regressions in parsing, routing, and execution logic without hitting the OpenAI API.
2. Cover the known issues flagged in `status-report.md`.
3. Enable CI without credentials or external services.

---

## Test Framework

**Node.js built-in test runner** (`node:test`) — zero dependencies, native ESM, ships with Node 18+. Run TypeScript directly via `tsx`.

```bash
npm install --save-dev tsx
```

Add to `package.json`:

```json
"scripts": {
  "test": "tsx --test 'tests/**/*.test.ts'",
  "test:watch": "tsx --test --watch 'tests/**/*.test.ts'",
  "test:coverage": "tsx --test --experimental-test-coverage 'tests/**/*.test.ts'"
}
```

Test file structure:

```ts
import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

describe('MyModule', () => {
        it('does something', () => {
                assert.equal(actual, expected);
        });
});
```

Mocking uses `node:test`'s built-in `mock` API:

```ts
import { mock } from 'node:test';

mock.method(obj, 'methodName', () => 'stubbed');
```

---

## Test Areas

### 1. Config Parsing ([src/config/](../src/config/))

These modules are pure, stateless, and take file content as input — ideal for unit tests.

#### 1a. AGENTS.md parser

Sources: [agent_config_helper.ts](../src/config/agent/agent_config_helper.ts) · [agent_types.ts](../src/config/agent/agent_types.ts) · [agent_zod.ts](../src/config/agent/agent_zod.ts)

Test file: `src/config/agent/agent_config_helper.test.ts`

| Test case | What to assert |
|-----------|---------------|
| Valid frontmatter + body | `AgentsDoc` fields match expected values |
| Missing required field (`name`) | Throws / returns error |
| Extra unknown fields in YAML | Passes (Zod strips extras) or errors per schema |
| Empty body | Returns empty string for instructions |
| UTF-8 content | No corruption |

#### 1b. SKILL.md parser

Sources: [skill_config_helper.ts](../src/config/skill/skill_config_helper.ts) · [skill_types.ts](../src/config/skill/skill_types.ts) · [skill_zod.ts](../src/config/skill/skill_zod.ts)

Test file: `src/config/skill/skill_config_helper.test.ts`

| Test case | What to assert |
|-----------|---------------|
| Valid skill with `allowed_tools` list | Parsed `SkillDoc` includes tools |
| Skill without `allowed_tools` | Defaults apply |
| Invalid frontmatter YAML | Throws descriptive error |
| Name field with spaces | Normalised or rejected per spec |

#### 1c. Command template parser

Sources: [command_config_helper.ts](../src/config/command/command_config_helper.ts) · [command_types.ts](../src/config/command/command_types.ts) · [command_zod.ts](../src/config/command/command_zod.ts)

Test file: `src/config/command/command_config_helper.test.ts`

| Test case | What to assert |
|-----------|---------------|
| Template with `{{variable}}` | Substitution replaces placeholder |
| Missing variable in context | Throws / leaves placeholder or errors |
| No template variables | Returns body unchanged |

#### 1d. MCP server config

Sources: [mcp_server_config_helper.ts](../src/config/mcp_server/mcp_server_config_helper.ts) · [mcp_server_types.ts](../src/config/mcp_server/mcp_server_types.ts) · [mcp_server_zod.ts](../src/config/mcp_server/mcp_server_zod.ts)

Test file: `src/config/mcp_server/mcp_server_config_helper.test.ts`

| Test case | What to assert |
|-----------|---------------|
| `stdio` transport with command + args | Parsed correctly |
| `http` transport with URL | Parsed correctly |
| `sse` transport | Parsed correctly |
| Unknown transport type | Zod union rejects with error |

#### 1e. Skilled Crew YAML loader

Sources: [skilled_crew_yaml_config_helper.ts](../src/config/skilled_crew_yaml/skilled_crew_yaml_config_helper.ts) · [skilled_crew_yaml_types.ts](../src/config/skilled_crew_yaml/skilled_crew_yaml_types.ts) · [skilled_crew_yaml_zod.ts](../src/config/skilled_crew_yaml/skilled_crew_yaml_zod.ts)

Test file: `src/config/skilled_crew_yaml/skilled_crew_yaml_config_helper.test.ts`

| Test case | What to assert |
|-----------|---------------|
| Minimal valid YAML (agents only) | Returns `SkilledCrewYamlConfig` |
| YAML with agents + skills + MCP servers | All sections populated |
| File not found | Throws with clear path in message |
| Malformed YAML | Throws parse error |

---

### 2. Script Runner

Source: [script_runner.ts](../src/libs/script_runner.ts) · [script_runner_schemas.ts](../src/libs/script_runner_schemas.ts) · [script_runner_types.ts](../src/libs/script_runner_types.ts)

Test file: `src/libs/script_runner.test.ts`

The security check (`_checkCommandSecurity`) and output parsing are pure functions — test them directly. Subprocess execution tests use real processes (no mock needed for `echo`).

| Test case | What to assert |
|-----------|---------------|
| `echo hello` | Output contains `hello`, exit code 0 |
| Command with `&&` chaining | Rejected by security check |
| Command with `;` chaining | Rejected by security check |
| Command with `|` pipe | Rejected by security check (if policy) |
| Path traversal `../../etc/passwd` | Rejected by security check |
| Non-zero exit code | `ScriptRunnerOutput.exitCode !== 0` |
| Timeout exceeded | Rejects with timeout error |
| stdout + stderr captured | Both present in output |
| **Known issue**: `shell: true` | Validates mitigation via `_checkCommandSecurity` |

---

### 3. Agent Runner Schemas

Source: [agent_runner_schemas.ts](../src/runner/agent_runner_schemas.ts)

Test file: `src/runner/agent_runner_schemas.test.ts`

Covers the known schema mismatch bug (`AgentRunnerToolRunScriptInputSchema`).

| Test case | What to assert |
|-----------|---------------|
| Input schema accepts `{ command: string }` | Parses without error |
| Input schema rejects output-shaped data | Rejects (catches the mismatch bug) |
| Output schema accepts valid script output | Parses correctly |
| Step result union covers all variants | Each variant parses independently |

---

### 4. AI Session Store

Source: [ai_session_store.ts](../src/session/ai_session_store.ts)

Test file: `src/session/ai_session_store.test.ts`

Uses a temp-file SQLite database — no external service needed.

| Test case | What to assert |
|-----------|---------------|
| Create store with temp path | No errors, DB file created |
| Save conversation turn | Round-trips correctly |
| Load non-existent session | Returns empty / null |
| Multiple sessions coexist | No cross-contamination |
| Store closed and reopened | Data persisted |

---

### 5. Eval Framework

Sources: [eval_config_helper.ts](../src/evals/eval_config_helper.ts) · [eval_grader.ts](../src/evals/eval_grader.ts) · [eval_runner.ts](../src/evals/eval_runner.ts) · [eval_schemas.ts](../src/evals/eval_schemas.ts) · [eval_types.ts](../src/evals/eval_types.ts)

Test files: `src/evals/eval_config_helper.test.ts`, `src/evals/eval_grader.test.ts`

#### Eval config loading

| Test case | What to assert |
|-----------|---------------|
| Valid eval folder | Returns `EvalDefinition[]` |
| Folder with no eval files | Returns empty array |
| Invalid eval file format | Throws or skips with warning |

#### Eval grader (mock the LLM call)

| Test case | What to assert |
|-----------|---------------|
| Grade response matches expectation | Returns `pass` result |
| Grade response mismatches | Returns `fail` with reason |
| LLM returns malformed JSON | Handles gracefully (Zod parse error) |

---

### 6. Markdown Chalk renderer

Source: [markdown_chalk.ts](../src/libs/markdown_chalk.ts)

Test file: `src/libs/markdown_chalk.test.ts`

| Test case | What to assert |
|-----------|---------------|
| Plain text | Returned unchanged (no ANSI codes in stripped form) |
| `**bold**` | Contains bold ANSI escape |
| Fenced code block | Formatted distinctly |
| Empty string | Returns empty string, no crash |

---

## Test Fixtures

Place reusable fixture files under `tests/_fixtures/`:

```
tests/_fixtures/
├── agents/
│   ├── valid-agents.md           # Full valid AGENTS.md
│   └── missing-name-agents.md    # Missing required field
├── skills/
│   ├── valid-skill.md
│   └── invalid-yaml-skill.md
├── commands/
│   └── template-command.md       # Contains {{variable}}
├── runner/
│   ├── minimal-runner.yaml
│   └── full-runner.yaml
└── evals/
    └── sample-eval.yaml
```

---

## Mocking Strategy

| Boundary | Approach |
|----------|----------|
| OpenAI API (`@openai/agents`) | Mock with `mock.module()` from `node:test`; return deterministic streamed events |
| MCP servers | Mock `AgentRunnerInit._connectMcpServer()` in [agent_runner_init.ts](../src/runner/agent_runner_init.ts) |
| SQLite DB | Use `tmpdir()` path per test; delete in `afterEach` |
| Child process ([script_runner.ts](../src/libs/script_runner.ts)) | Use real `echo` / `true` / `false` for simple cases; mock `spawn` for error paths |
| File system (config loading) | Use real temp directories with fixture content |

---

## Coverage Targets

| Module | Target |
|--------|--------|
| [src/config/](../src/config/) | 90%+ (pure parsing) |
| [script_runner.ts](../src/libs/script_runner.ts) | 85%+ |
| [markdown_chalk.ts](../src/libs/markdown_chalk.ts) | 80%+ |
| [ai_session_store.ts](../src/session/ai_session_store.ts) | 80%+ |
| [src/evals/](../src/evals/) | 70%+ |
| [agent_runner_schemas.ts](../src/runner/agent_runner_schemas.ts) | 95%+ |
| [agent_runner.ts](../src/runner/agent_runner.ts) | 50%+ (integration-heavy; mock OpenAI) |

---

## Integration Tests (Optional, Requires API Key)

Gate behind `process.env.OPENAI_API_KEY` check:

```ts
const itWithKey = (name: string, fn: () => void) =>
        process.env.OPENAI_API_KEY ? it(name, fn) : it.skip(name, fn);
```

| Test case | What to assert |
|-----------|---------------|
| Load todo-list agent folder, run one-shot | Returns non-empty text response |
| Handoff from orchestrator to skill agent | `AgentRunnerConstants.HANDOFF` event emitted |
| Tool call `run_command_line` | Tool start/end events emitted, command output captured |
| Eval run on bluesky agent | `EvalResponseLog` written to disk |

---

## Known Issues to Regression-Test

From [status-report.md](./status-report.md):

| Issue | Test file | Test description |
|-------|-----------|-----------------|
| Schema mismatch in `AgentRunnerToolRunScriptInputSchema` ([agent_runner_schemas.ts](../src/runner/agent_runner_schemas.ts)) | `agent_runner_schemas.test.ts` | Input schema rejects output-shaped data |
| `shell: true` in `ScriptRunner` ([script_runner.ts](../src/libs/script_runner.ts)) | `script_runner.test.ts` | `_checkCommandSecurity` blocks `&&`, `;`, `|` |
| Eval non-streaming loses step results ([eval_runner.ts](../src/evals/eval_runner.ts)) | `eval_runner.test.ts` | Non-streaming run still returns final text |
| Hardcoded `openai/gpt-4.1-nano` fallback ([agent_runner_init.ts](../src/runner/agent_runner_init.ts)) | `agent_runner_init.test.ts` | Missing env var uses fallback, logs warning |

---

## Implementation Order

1. Install `tsx` dev dependency, add `test` scripts to `package.json`
2. Add fixtures under `tests/_fixtures/`
3. Config parsers (1a–1e) — highest ROI, no mocks needed
4. [script_runner.ts](../src/libs/script_runner.ts) security tests
5. [agent_runner_schemas.ts](../src/runner/agent_runner_schemas.ts) tests (catches known bug)
6. [ai_session_store.ts](../src/session/ai_session_store.ts) with temp SQLite
7. Eval config loading
8. [markdown_chalk.ts](../src/libs/markdown_chalk.ts) renderer
9. Agent runner integration tests (gated on API key)
