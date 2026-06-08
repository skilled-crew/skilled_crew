# skilled_crew

AI agent orchestration engine driven by Markdown. Point it at an **agent folder** (a directory with `AGENTS.md` + `skills/*/SKILL.md`) described by a `.skilled_crew.yaml` config — each skill becomes an OpenAI tool-calling sub-agent, and an orchestrator routes your messages to the right skill, via an interactive REPL or one-shot mode.

## Supported Formats

| Format | Purpose | Specification |
|--------|---------|---------------|
| **`AGENTS.md`** | Project context & triage instructions for the orchestrator agent | [mdskills AGENTS.md spec](https://www.mdskills.ai/specs) |
| **`SKILL.md`** | Modular capabilities for individual skill agents (YAML frontmatter + markdown instructions) | [mdskills SKILL.md spec](https://www.mdskills.ai/specs) |
| **`.prompt.md`** | Reusable prompts with template variables & YAML metadata | [GitHub Prompt Files](https://docs.github.com/en/copilot/tutorials/customization-library/prompt-files/your-first-prompt-file) |
| **MCP Servers** | External tools & services (stdio, http, sse transports) | [Model Context Protocol](https://modelcontextprotocol.io) |

## Install / Run

No install needed — run straight from npm:

```bash
# Show all commands and flags
npx skilled_crew help

# Interactive chat against a .skilled_crew.yaml config
npx skilled_crew chat -c ./my_agent.skilled_crew.yaml

# One-shot task
npx skilled_crew run -c ./my_agent.skilled_crew.yaml "what are my tasks?"
```

Or install it globally:

```bash
npm install -g skilled_crew
skilled_crew help
```

## Commands

| Command | Description |
|---------|-------------|
| `chat -c <path>` | Start an interactive chat REPL with the agent |
| `run -c <path> <task>` | Run a single one-shot task and exit |
| `eval_run -c <path> -f <folder>` | Run evals from an eval folder against a config |
| `eval_grade -f <folder>` | Grade eval run results using LLM-as-a-judge |
| `log stream` | Print and tail session logs |
| `schema_generate` / `schema_check` | Generate / verify the bundled JSON schemas |
| `jobs <subcommand>` | Durable job-lane board (queue, scheduler, cost) |

Run `npx skilled_crew help <command>` to see the flags for any command.

---

## Environment Variables & API keys

`skilled_crew` reads provider keys from **environment variables** — chiefly `OPENAI_API_KEY` for `openai/*` models. Provide them in any of these ways:

- **Export in your shell:** `export OPENAI_API_KEY=sk-...` then `npx skilled_crew chat -c ...`
- **Inline for one command:** `OPENAI_API_KEY=sk-... npx skilled_crew chat -c ...`
- **A `.env` file:** drop one in the directory where you run the command — it is auto-loaded via `dotenv` (already-set shell variables take precedence). See `.env-sample` for the full list.

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `OPENAI_API_KEY` | yes (for `openai/*` models) | — | API key read by the OpenAI SDK in [src/libs/utils_ai.ts](src/libs/utils_ai.ts). Not needed when running `lmstudio/*` models, which hit `LMSTUDIO_BASE_URL` (default `http://localhost:1234/v1`). |
| `OPENAI_BASE_URL` | no | OpenAI SDK default | Override the base URL for the `openai` provider. Useful for OpenAI-compatible proxies or gateways. |
| `LMSTUDIO_BASE_URL` | no | `http://localhost:1234/v1` | Override the base URL for the `lmstudio` provider. Point at a remote LMStudio host if needed. |
| `SKILLET_MODEL_RUNNER` | no | falls back to `agents.header.model` from the runner YAML, then `openai/gpt-4.1-nano` | Overrides the model used by the runner (triage + skill agents). Format is `<provider>/<model>`. Supported providers: `openai`, `lmstudio`. OpenAI examples: `openai/gpt-4.1-nano`, `openai/gpt-4.1-mini`, `openai/gpt-4.1`. LMStudio examples: `lmstudio/liquid/lfm2-1.2b`, `lmstudio/google/gemma-3-4b-it`. See [src/agent_runner/agent_runner_init.ts](src/agent_runner/agent_runner_init.ts). |
| `SKILLET_MODEL_EVAL` | no | `openai/gpt-4.1-nano` | Overrides the model used by the LLM-as-judge eval grader. Same `<provider>/<model>` format as `SKILLET_MODEL_RUNNER`. See [src/evals/eval_grader.ts](src/evals/eval_grader.ts). |

---

## Agent Folder Format

An agent folder is a directory with this structure:

```
my-agent/
├── AGENTS.md               # instructions for the triage/orchestrator agent
└── skills/
    └── <skill-name>/
        ├── SKILL.md        # frontmatter (name, description) + agent instructions
        └── scripts/        # scripts the skill agent can execute
            └── *.js / *.sh / ...
```

### `AGENTS.md`

Plain markdown. Describes the agent's purpose and guides the triage agent in routing tasks to the right skill.

### `SKILL.md`

Markdown with YAML frontmatter:

```markdown
---
name: create-task
description: Create a new task in the user's todo list.
---

## Purpose
This skill creates a new task in the todo list.

## Usage
Pass the task description as an argument:

    node scripts/create.js "Buy milk"
```

Required frontmatter fields: `name`, `description`.

Each skill agent gets a `run_command_line` tool that executes shell commands with `cwd` set to the skill's folder (30 s timeout).

---

## MCP Server Support

MCP servers can be declared in a config folder under `mcp_servers/`. Each server is a separate JSON file — one file per server.

```
.skillmd-runner/
└── mcp_servers/
    ├── mcp_datetime.json
    └── my-api.json
```

Pass the config folder with `-c`:

```bash
npx tsx ./src/cli.ts -a ./examples/agent_folders/todo_list -c ./.skillmd-runner
```

### JSON format

**`stdio` server** (subprocess over stdin/stdout):

```json
{
    "name": "mcp_datetime",
    "type": "stdio",
    "command": "npx",
    "args": ["tsx", "/path/to/mcp_datetime/src/index.ts"],
    "env": { "MY_VAR": "value" },
    "cwd": "/optional/working/dir"
}
```

**`http` server** (Streamable HTTP):

```json
{
    "name": "my-api",
    "type": "http",
    "url": "http://localhost:3000/mcp"
}
```

**`sse` server** (Server-Sent Events):

```json
{
    "name": "my-api",
    "type": "sse",
    "url": "http://localhost:3000/sse"
}
```

All declared servers are connected before any agent runs and are available to every skill agent and the triage agent.

---

## Architecture

```
cli.ts
  └── loadMcpServerConfigs()      reads .skillmd-runner/mcp_servers/*.json
  └── ConfigParser.parseFolder()  reads AGENTS.md + skills/*/SKILL.md
  └── createAgent()
        ├── per-skill Agent       tools: run_command_line + mcpServers
        └── Triage Agent          handoffs to skill agents + mcpServers
  └── runChat() / run()           readline REPL or one-shot
```

Key source files:

| File | Role |
|------|------|
| `src/cli.ts` | Entry point, agent wiring, REPL |
| `src/agent_folder/config_parser.ts` | Discovers and parses `AGENTS.md` + `SKILL.md` |
| `src/agent_folder/schema.ts` | Zod validation for SKILL.md frontmatter and MCP server configs |
| `src/agent_folder/types.ts` | Shared TypeScript types |
| `src/skillmd_runner_config/config_loader.ts` | Loads MCP server configs from config folder |
| `src/libs/script_helper.ts` | Executes skill scripts as child processes |

OpenAI API responses are cached in `.openai_cache.sqlite` (SQLite via `@keyv/sqlite`). Readline history is persisted in `.readline-history.json`.
