# skilled_crew

> Markdown-driven AI agent orchestration engine — describe agents and skills in one `.skilled_crew.yaml` file, then run them interactively (CLI) or as durable, scheduled jobs.

You describe a system in a single `.skilled_crew.yaml` file; the runtime spins up one orchestrator plus one sub-agent per skill, routes each request to the right skill, and each skill runs shell scripts in its own folder to do real work.

## Packages

| Package | What it is |
|---------|------------|
| [`packages/_skillet_agent`](packages/_skillet_agent#readme) | **Core engine and CLI** — the orchestrator, skill agents, durable jobs, and evals. Published to npm as [`skilled_crew`](https://www.npmjs.com/package/skilled_crew). |
| [`packages/_skillet_docsite`](packages/_skillet_docsite) | Documentation site (Next.js + Nextra), published to GitHub Pages. |

## Quick start

```bash
# Show all commands and flags
npx skilled_crew help

# Interactive chat against a .skilled_crew.yaml config
npx skilled_crew chat -c ./my_agent.skilled_crew.yaml
```

Needs Node 22+ and an `OPENAI_API_KEY`. See the [`_skillet_agent` README](packages/_skillet_agent#readme) for the full CLI, the agent-folder format, and the supported environment variables.

## Documentation

Full docs — getting started, concepts, configuration, CLI, jobs and scheduling, and the API reference — live at **<https://skilled-crew.github.io/skilled_crew>** and are built from [`packages/_skillet_docsite`](packages/_skillet_docsite).

## Repository layout

```
packages/
  _skillet_agent/      core engine, CLI, jobs, evals (npm: skilled_crew)
  _skillet_docsite/    Next.js + Nextra docs (GitHub Pages)
```

## Development

Each package is installed and built on its own — `cd` into the one you are working on and run its scripts. CI type-checks and builds `_skillet_agent` and builds the docs on every push and pull request.

## License

[MIT](LICENSE)
