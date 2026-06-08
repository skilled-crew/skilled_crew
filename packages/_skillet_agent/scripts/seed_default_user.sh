#!/bin/sh
# TEMPORARY (issue #261): seed the default user on install so the first
# `chat`/`run` works without a manual step. Most users do not realise the agent
# is multi-user; this hands them a ready identity (the CLI also self-seeds on
# first run, so this is a convenience, not the sole guarantee).
#
# Best-effort by design: a failed seed must never fail the install. Prefer the
# TypeScript source via the locally installed tsx in a checkout (always fresh);
# fall back to the built dist/cli.js, which is all that ships to an npm install.
#
# Remove this script, its `files` entry, and its `postinstall` hook once real
# onboarding exists.

if [ -x "node_modules/.bin/tsx" ] && [ -f "src/cli.ts" ]; then
	./node_modules/.bin/tsx ./src/cli.ts postinstall || echo "seed_default_user: skipped (source run failed)"
elif [ -f "dist/cli.js" ]; then
	node ./dist/cli.js postinstall || echo "seed_default_user: skipped (dist run failed)"
else
	echo "seed_default_user: skipped (no runnable CLI found)"
fi
