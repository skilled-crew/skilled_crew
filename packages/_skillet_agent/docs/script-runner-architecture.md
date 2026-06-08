# Script Runner Architecture

This document describes how skill scripts (the `run_command_line` tool invoked by skill agents) are executed in `_skillet_agent`. The runner has two interchangeable backends — **local** (host process) and **container** (Docker/OrbStack) — sharing one API and one security check. Selection is per-bot, declared in `.skilled_crew.yaml`.

## 1. Module Layout

All files live in [`src/script_runner/`](../src/script_runner/).

| File | Role |
|---|---|
| [`script_runner_types.ts`](../src/script_runner/script_runner_types.ts) | `ScriptRunnerOutput` — the single result shape returned by both backends. |
| [`script_runner_security.ts`](../src/script_runner/script_runner_security.ts) | `ScriptRunnerSecurity` — shell-metachar / path-traversal / `allowed-tools` checks. Reused by both backends. |
| [`script_runner_local.ts`](../src/script_runner/script_runner_local.ts) | `ScriptRunnerLocal.runCommand()` — spawns a host child process via `child_process.spawn` with `cwd = skillFolderPath`. |
| [`script_runner_container.ts`](../src/script_runner/script_runner_container.ts) | `ScriptRunnerContainer.runCommand()` — shells out to `docker exec` against a long-lived container. |
| [`container_helper.ts`](../src/script_runner/container_helper.ts) | `ContainerHelper` — owns all stateful Docker operations: image build, container provisioning, volume creation, cleanup. |
| [`script_runner_schemas.ts`](../src/script_runner/script_runner_schemas.ts) | (Currently empty — placeholder for future runtime-config Zod schemas.) |

Both runners expose the same static method:

```ts
runCommand(
  commandLine: string,
  skillFolderPath: string,
  allowedTools: SkillDocAllowedTool[],
  opts: { timeoutMs?: number; bypassSecurity?: boolean; /* + container-only fields */ },
): Promise<ScriptRunnerOutput>
```

`ScriptRunnerOutput` is `{ exitCode, stdout, stderr, timedOut }`. The container backend adds `containerName` and `botFolderPath` to `opts` — needed to address the live container and translate host paths into the container's `/bot/...` namespace.

## 2. Runtime Selection

A `.skilled_crew.yaml` file (parsed by [`SkilledCrewYamlConfigHelper`](../src/config/skilled_crew_yaml/skilled_crew_yaml_config_helper.ts), schema in [`skilled_crew_yaml_zod.ts`](../src/config/skilled_crew_yaml/skilled_crew_yaml_zod.ts)) carries an optional `script_runtime` block:

```yaml
script_runtime:
  kind: container        # "local" (default) | "container"
  dockerfile: ../dotclaude_todo_list/Dockerfile  # relative to .skilled_crew.yaml; required when kind=container
```

When the block is absent or `kind: local`, behavior is the host-process default. When `kind: container`, the runner uses Docker. There are **no CLI flags** for this — execution mode is a property of the bot, not the invocation.

## 3. Wire-in Through Agent Runner Init

[`agent_runner_init.ts`](../src/agent_runner/agent_runner_init.ts) is the glue between the config and the runners. It defines a discriminated union:

```ts
type ScriptRuntimeContext =
  | { kind: 'local' }
  | { kind: 'container'; containerName: string; botFolderPath: string };
```

Flow at startup:

```
createAgentRunnerContextFromConfig()
  │
  ├─ _buildScriptRuntimeContext(skilledCrewYamlConfig, userId)
  │     │
  │     ├─ kind=local        → return { kind: 'local' }
  │     └─ kind=container    → ContainerHelper.provision(botFolder, botId, userId, dockerfile)
  │                            return { kind: 'container', containerName, botFolderPath }
  │
  ├─ _createRoleAgent(..., { scriptRuntimeContext })
  │     └─ _createSkillAgent(..., { scriptRuntimeContext })
  │           └─ _createToolRunCommandLine(skillDoc, configSkill, verboseLevel, scriptRuntimeContext)
  │                 │
  │                 └─ execute(commandLine):
  │                       if context.kind === 'container'
  │                         → ScriptRunnerContainer.runCommand(... containerName, botFolderPath)
  │                       else
  │                         → ScriptRunnerLocal.runCommand(...)
```

The context is built once per agent run, then plumbed down to each skill agent's `run_command_line` tool. Provisioning is **idempotent**: if the image and container already exist, `provision()` is a fast no-op.

## 4. Container Architecture

When `kind: container`, every `(user_id, bot_id)` pair gets its own running container; image and (optionally) data volume are scoped distinctly.

### 4.1 Naming

Computed by `ContainerHelper`. All inputs are slugified to satisfy Docker's `[a-zA-Z0-9_.-]` constraint.

| Resource | Format | Example |
|---|---|---|
| Image | `skillet-img-{botId}` | `skillet-img-todo_list` |
| Container | `skillet-{botId}-{userId}` | `skillet-todo_list-alice` |
| node_modules volume | `skillet-nm-{botId}-{userId}` | `skillet-nm-todo_list-alice` |
| _data volume | `skillet-data-{botId}-{userId}` | `skillet-data-todo_list-alice` |

The image is **shared across users** of the same bot — the Dockerfile only depends on `botId`. The container and volumes are **per (bot, user)**.

### 4.2 Image

Built once via `docker build -t skillet-img-{botId} -f {absoluteDockerfilePath} {botFolderPath}`. The Dockerfile lives at the bot's root and is the install recipe — it `COPY package.json` + `RUN npm install` (and any other system setup), then `CMD ["sleep", "infinity"]` so the container stays alive for `docker exec`.

> **Why `-f` is an absolute path**: docker resolves a relative `-f` against the CLI's cwd, **not** the build context. Using an absolute path is the difference between "works from anywhere" and "silently fails when invoked from outside the bot folder."

### 4.3 Container Mounts

A running container has up to three mounts:

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Mount                                                Source              │
├──────────────────────────────────────────────────────────────────────────┤
│ /bot                ← bind mount                     {botFolderPath}     │
│ /bot/node_modules   ← named volume (per-user)        skillet-nm-…        │
│ /bot/_data          ← named volume (per-user)        skillet-data-…      │
│                       (only if host has _data/)                          │
└──────────────────────────────────────────────────────────────────────────┘
```

- **`/bot` (bind mount)** keeps the bot's source code, configs, and the `Dockerfile` live from the host. Editing a skill file on the host is immediately visible in the container.
- **`/bot/node_modules` (named volume)** preserves the image's installed dependencies. Without it, the `/bot` bind mount would shadow the image's `node_modules` with an empty host directory, and `require('commander')` would fail.
- **`/bot/_data` (named volume, optional)** isolates bot state per-user. See §5.

The bind mount means all skill scripts can use the same relative paths they'd use locally (e.g., `npx tsx ../../_src/todo_script.ts`) — they resolve identically inside and outside the container.

### 4.4 Path Translation

`ScriptRunnerContainer.runCommand()` receives the host's absolute `skillFolderPath`. It computes the path relative to `botFolderPath`, then prepends `/bot`:

```
skillFolderPath:  /Users/jerome/repo/.../dotclaude_todo_list/skills/list-tasks
botFolderPath:    /Users/jerome/repo/.../dotclaude_todo_list
                  ────────────────────────────────────────── strip prefix
                  → skills/list-tasks
container cwd:    /bot/skills/list-tasks
```

It then invokes `docker exec -w /bot/skills/list-tasks {containerName} sh -c "{commandLine}"`. If the relative path escapes the bot folder (`startsWith('..')`), the runner throws — security guard against misconfigured skill paths.

## 5. Per-User `_data/` Isolation

The bot folder is shared across users via the bind mount, but bots usually have a `_data/` directory holding mutable state (e.g., a todo list's `tasks.json`). Sharing that across users is wrong — different users should not see each other's data.

The solution: if the host bot folder contains `_data/`, the container provisioner adds a per-user named volume mounted at `/bot/_data`. Because Docker only seeds a named volume from **image** content (and the image has no `/bot/_data` — the bot folder isn't `COPY`'d), the volume starts **empty**. Each user begins with a clean `_data/`; their writes persist to their own volume across container restarts; the host's `_data/` is shadowed and never modified by container scripts.

Bots without `_data/` get no extra mount. The directory name `_data` is a convention defined as `PRIVATE_DATA_DIR` in `container_helper.ts`. Generalizing to a configurable list is future work.

## 6. Security Validation

Both backends run the same checks before executing any command, unless `bypassSecurity: true` is passed (test-only escape hatch). The checks live in [`ScriptRunnerSecurity`](../src/script_runner/script_runner_security.ts):

| Check | Rule |
|---|---|
| `checkCommandSecurity` | Reject shell metacharacters (`&&`, `\|\|`, `\|`, `;`, `$()`, backticks, newline). Reject any token containing `..`. Reject absolute paths that resolve outside the skill folder. |
| `checkAllowedTools` | Enforce `SKILL.md`'s `allowed-tools:` frontmatter. Currently supports `Bash(<cmd>:*)` — the command line must start with `<cmd> `. Unknown tool names throw. |

The container backend keeps these checks even though Docker's isolation already constrains damage — the goal is **command intent**, not blast radius. A skill calling `rm -rf /` should be rejected before it ever reaches `docker exec`.

## 7. Container Lifecycle

`ContainerHelper` exposes three operations:

| Method | Effect |
|---|---|
| `provision(botFolder, botId, userId, dockerfile)` | Idempotent. Builds the image if missing; runs the container if not running; mounts the bot folder, node_modules volume, and (if applicable) data volume. |
| `destroy(botId, userId)` | **Destructive.** Removes the container AND both per-user volumes (including `_data/`). Not called by `provision`; only via explicit cleanup. |
| `isRunning(botId, userId)` | `docker inspect -f '{{.State.Running}}'` check. Returns `false` for missing containers. |

State transitions during a normal run:

```
absent ──────────────── provision() ───────────► running
                       (build + run)             │
                                                 │
                       ◄──── destroy() ──────────┘
                       (rm container + volumes)
```

The container is **never stopped** automatically — it stays alive between agent runs to avoid cold-start cost on `docker exec`. State machine elaboration (auto-stop on idle, `failed` state, etc.) is out of scope; see #29 for tracked future work.

## 8. End-to-End Sequence

Below is a single `chat` invocation routed to the `list-tasks` skill on the `todo_list` bot, `--user-email alice@example.com`, container runtime:

```
1. CLI: cli.ts chat -c ./data/skillets/todo_list.skilled_crew.yaml --user-email alice@example.com
2. AgentRunnerInit.createAgentRunnerContext()
   ├─ SkilledCrewYamlConfigHelper.loadConfig() → reads .skilled_crew.yaml, resolves dockerfile path
   ├─ _buildScriptRuntimeContext(): script_runtime.kind === 'container'
   │  └─ ContainerHelper.provision(botFolder, "todo_list", "alice@example.com", dockerfile)
   │     ├─ docker build -t skillet-img-todo_list (first run only)
   │     └─ docker run -d --name skillet-todo_list-alice_example_com   (userId slugified)
   │           -v {botFolder}:/bot
   │           -v skillet-nm-todo_list-alice_example_com:/bot/node_modules
   │           -v skillet-data-todo_list-alice_example_com:/bot/_data    (host has _data/)
   │           skillet-img-todo_list
   └─ Build skill agents, each with run_command_line tool bound to
      ScriptRuntimeContext { kind: 'container', containerName, botFolderPath }
3. User: "what are my tasks?"
4. Orchestrator hands off to list-tasks skill agent
5. Skill agent calls run_command_line({ commandLine: "npx tsx ../../_src/todo_script.ts list" })
   └─ ScriptRunnerContainer.runCommand()
      ├─ ScriptRunnerSecurity.checkCommandSecurity()  (chain chars, traversal)
      ├─ ScriptRunnerSecurity.checkAllowedTools()
      ├─ Translate: skillFolderPath → /bot/skills/list-tasks
      └─ docker exec -w /bot/skills/list-tasks skillet-todo_list-alice_example_com
           sh -c "npx tsx ../../_src/todo_script.ts list"
6. Script reads /bot/_data/tasks.json (alice@example.com's volume) → returns JSON
7. ScriptRunnerOutput { exitCode: 0, stdout: "[]", stderr: "", timedOut: false }
8. Tool result returned to skill agent → text response → CLI
```

## 9. Verification

Manual end-to-end checks (run from `packages/_skillet_agent/`, OrbStack/Docker up). The `--user-email` values must exist in the user store — seed `alice@example.com` and `bob@example.com` first, or substitute the default `john@example.com`:

```bash
# Container path with per-user isolation
npx tsx ./src/cli.ts run -c ./data/skillets/todo_list.skilled_crew.yaml \
  --user-email alice@example.com 'add task: buy bread'
npx tsx ./src/cli.ts run -c ./data/skillets/todo_list.skilled_crew.yaml \
  --user-email bob@example.com 'what are my tasks?'      # expected: empty

# Confirm volumes exist
docker volume ls --filter name=skillet-data-

# Confirm host _data/ is untouched
cat ./data/dotclaude_todo_list/_data/tasks.json

# Cleanup
docker rm -f skillet-todo_list-alice skillet-todo_list-bob
docker volume rm -f skillet-nm-todo_list-alice skillet-nm-todo_list-bob \
                    skillet-data-todo_list-alice skillet-data-todo_list-bob
```

Unit tests for `ScriptRunnerLocal` and the security checks live in [`tests/libs/script_runner_local.test.ts`](../tests/libs/script_runner_local.test.ts). The container backend has no automated tests yet — it requires a live Docker daemon and is exercised manually.

## 10. Out of Scope

The current implementation deliberately leaves the following for future work:

- **State machine**: explicit `installing` / `failed` states, auto-stop on idle, restart policy.
- **Resource limits**: `--memory`, `--cpus`, ulimits.
- **Image registry**: bots share images per machine, not across machines.
- **Threat-model hardening**: rootless containers, dropped capabilities, network policies, read-only root FS.
- **Configurable private paths**: only `_data/` is isolated; a `private_paths:` list would generalize this.
- **Container runtime choice in config**: `kind: container` works against any Docker-compatible daemon (Docker Desktop, OrbStack, Colima); there's no explicit selector.

See [GitHub issue #29](https://github.com/jeromeetienne/skillet_agent/issues/29) for tracked follow-ups.
