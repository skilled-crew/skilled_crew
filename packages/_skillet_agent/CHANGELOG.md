# Changelog

All notable changes to the `_skillet_agent` package (published on npm as
`skilled_crew`) are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Each released version corresponds to a commit that changed the `version` field of
`packages/_skillet_agent/package.json`. Entries are drawn from the commits touching
the package between consecutive version bumps; commits scoped to other packages and
pure chore/docs noise are omitted.

## [Unreleased]

### Added

- Preflight check that `SKILLET_MODEL_RUNNER` is runnable before starting (#265).

## [1.0.11] - 2026-06-08

_Release/version bump only; no functional changes._

## [1.0.10] - 2026-06-08

### Added

- Ollama provider support (#268).
- Basic `generic_assistant` crew (#267).

## [1.0.9] - 2026-06-08

### Added

- Resolve `-c` as either a filesystem path or a skillet id, default to the
  `todo_list` crew, and ship bundled crews (#266).

## [1.0.8] - 2026-06-08

### Added

- Seed a default user on `cli run` and during postinstall (#261).
- `intel_brief` job template for daily intelligence reporting.
- `competitor_analysis` job template in `crew_news_brief` (#240).
- Out-of-band notifications on approval-needed / blocked states via Resend (#238).
- Code-worker jobs; move `crew_social_share`'s human gate to the editor (#216).
- Human-readable job and run ids with an assignee slug (#225).
- Default the CLI user to `john@example.com` via `--user-email` (#223).
- Mirror dispatcher terminal output to `outputs/job_dispatcher.log` (#220).
- `cli run` logs a startup banner and skips empty session replay for job workers (#220).
- Tag and bracket per-job worker output in the dispatcher terminal (#220).
- Include the worker command line and reason in the job `spawned` event (#226).

### Changed

- Unify runtime paths into a single `SkilletPaths` resolver (#256).
- Split the job/workflow lane into a new `_skillet_workflow` package (#247).
- Rename `.skillet.yaml` → `.skilled_crew.yaml` and the `skillet_yaml` identifier family (#243).
- Rename the job template concept to workflow (`.job_workflow.yaml` + `JobWorkflow` class) (#242).
- Rename `foobar_agent.md` → `foobar.agent.md` (#236).
- Centralize the openai-cost `bucketId` format (#225).
- Run `crew_social_share`'s gather and drafter stages on `gpt-4.1-nano` (#193).

### Fixed

- Update stale `MIXED_PROFILE` keys to `.agent.md` (#236).
- Allow heredoc bodies past the script-runner security gate (#219).
- Install data sub-project dependencies in postinstall so typecheck resolves them (#212).
- Declare `@types/mdast` as a dev dependency (#230).
- Declare `openai` as a direct dependency (#230).
- Spawn the worker via `node` for the built `dist` install (#213).

### Security

- Enforce `run_command_line` security checks by default (#194).
- Sandbox skill commands to the crew root rather than the skill folder.

## [1.0.6] - 2026-06-04

### Changed

- Emit the build to `dist/` and ship an `outputs/` placeholder.

## [1.0.3] - 2026-06-04

### Changed

- Publish the package as `skilled_crew` on npm.

### Fixed

- Add `json5` and `rss-parser` dev dependencies to fix the CI typecheck.

## [1.0.0] - 2026-06-04

### Added

- Initial release.

<!--
  Compare-style link references (e.g. [1.0.11]: .../compare/v1.0.10...v1.0.11) are
  intentionally omitted: no vX.Y.Z git tags exist yet, and the package mirrors to a
  separate public repository with different commit SHAs. Add tag-based links here
  once release tags are created.
-->
