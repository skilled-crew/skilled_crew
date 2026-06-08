#!/bin/sh
# Install the dependencies of the self-contained data sub-projects.
#
# Each sub-project under data/ ships its own package.json (its runtime
# dependencies were moved out of the agent package in #212). The agent
# typecheck (tsc --noEmit) still compiles data/**/*, so those dependencies
# must be present for the imports to resolve. This script is invoked from the
# agent's postinstall so a single `npm install`/`npm ci` of the agent sets up
# everything, including in CI.
#
# PUPPETEER_SKIP_DOWNLOAD avoids fetching a full Chromium for md-to-pdf, which
# is only needed at runtime, not for typechecking.
set -e

for sub_project in dotclaude_business_analyst dotclaude_todo_list; do
	if [ -d "data/$sub_project" ]; then
		echo "install_data_subprojects: data/$sub_project"
		PUPPETEER_SKIP_DOWNLOAD=1 npm install --prefix "data/$sub_project"
	fi
done
