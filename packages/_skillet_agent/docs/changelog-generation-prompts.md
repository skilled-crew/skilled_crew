# CHANGELOG generation prompts

Reusable prompts for maintaining [`../CHANGELOG.md`](../CHANGELOG.md). The changelog
is driven by the version history of `packages/_skillet_agent/package.json`: each
commit that changes the `version` field marks a release, and the commits between two
consecutive version bumps become that release's entries, formatted per
[Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/).

Two knobs, set as defaults in both prompts:

- Output file: `packages/_skillet_agent/CHANGELOG.md`.
- Entry scope: commits touching `packages/_skillet_agent/` (drop the pathspec to go repo-wide).

---

## Prompt 1 — initial generation

```text
Generate packages/_skillet_agent/CHANGELOG.md in the Keep a Changelog 1.1.0 format
(https://keepachangelog.com/en/1.1.0/), driven by the version history of
packages/_skillet_agent/package.json. Inspect git directly — do not guess.

Definitions:
- A "version-commit" is a commit where the "version" field INSIDE
  packages/_skillet_agent/package.json changed value. Commits that touch
  package.json only for dependencies/scripts are NOT version-commits.
- The entries for a version are all commits in the range
  (previous-version-commit, this-version-commit] that modified anything under
  packages/_skillet_agent/, EXCLUDING the pure release/version-bump commits
  themselves (messages like "update version to X").

Steps:
1. Detect version-commits. Start from:
     git log -p --follow --date=short --format='@@ %H %ad %s' -- packages/_skillet_agent/package.json
   Pick each commit whose diff changes the "version": line; record (sha, date, old→new).
   Order newest→oldest. Versions skip numbers — only list versions that actually appear.
2. For each consecutive pair of version-commits, collect the in-between commits that
   touched the package:
     git log --date=short --format='%h %ad %s' <prevVerSha>..<verSha> -- packages/_skillet_agent/
   For the OLDEST version, range from that commit back to the repo's first commit.
3. Exclude noise: pure version-bump/release commits, merge commits, commits whose
   conventional-commit scope is another package (e.g. _skillet_webclient, _skillet_docsite),
   and pure docs/test/chore/ci unless clearly user-facing.
4. Map each remaining commit to a Keep a Changelog category by its conventional-commit type:
     feat → Added (Changed if it alters existing behavior)
     fix → Fixed
     refactor / perf / build → Changed
     a removal → Removed; a deprecation → Deprecated; a security fix → Security
   Rewrite each as a short sentence: strip the "type(scope):" prefix, keep the issue
   reference as (#NNN).
5. Write the file: standard Keep a Changelog header/intro, then "## [Unreleased]" at the
   top holding any commits AFTER the newest version-commit, then one
   "## [X.Y.Z] - YYYY-MM-DD" section per version (newest first), date = the
   version-commit's author date. Only include category subsections that have entries.
   For a release whose only commit is the version bump, write a one-line note instead.
6. There are no git tags and the package mirrors to a separate public repo with different
   SHAs, so do NOT emit the bottom "compare" link references — they'd be broken. Leave an
   HTML comment noting they can be added once vX.Y.Z tags exist.
7. Write to packages/_skillet_agent/CHANGELOG.md. Show me the result; do not commit.
```

---

## Prompt 2 — incremental update (last recorded version → now)

```text
Update packages/_skillet_agent/CHANGELOG.md to cover everything from the most recently
documented version up to HEAD, WITHOUT rewriting older sections. Inspect git directly.

Use the same rules as the initial changelog:
- "version-commit" = a commit where the "version" field in
  packages/_skillet_agent/package.json changed value.
- conventional-commit → category mapping: feat→Added (Changed if behavior-altering),
  fix→Fixed, refactor/perf/build→Changed, removal→Removed, deprecation→Deprecated,
  security→Security; drop pure docs/test/chore/ci unless user-facing, and drop commits
  scoped to other packages.
- clean each message: strip "type(scope):", keep the issue ref as (#NNN).
- exclude pure version-bump/release commits and merge commits.

Steps:
1. Read the existing CHANGELOG.md. Find the newest released version already documented
   (topmost "## [X.Y.Z]" heading) and any existing "## [Unreleased]" block.
2. Anchor it in git: prefer the tag vX.Y.Z if it exists; otherwise re-detect version-commits
   (as above) and find the one whose version became X.Y.Z. Call its sha <anchorSha>.
3. Collect new commits:
     git log --date=short --format='%h %ad %s' <anchorSha>..HEAD -- packages/_skillet_agent/
4. Detect any NEW version-commits in that range. For each, build a
   "## [X.Y.Z] - YYYY-MM-DD" section (date = version-commit author date) using the grouping
   and categorization rules above.
5. Put commits AFTER the newest version-commit (not yet released) into "## [Unreleased]"
   — create it if missing, replace its contents if present.
6. Insert in place: [Unreleased] at top, then any new version sections directly below it,
   ABOVE the previously-newest version section. Do NOT touch already-documented sections.
7. If there are no new version-commits AND no new packages/_skillet_agent/ commits since the
   last documented version, report that and make no changes.
8. Show me the diff; do not commit.
```
