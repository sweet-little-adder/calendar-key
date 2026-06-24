#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v gh >/dev/null 2>&1; then
	echo "Install GitHub CLI: brew install gh"
	exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
	echo "Log in first: gh auth login --hostname github.com --git-protocol ssh --web"
	exit 1
fi

gh repo create sweet-little-adder/elgato-calendar-key \
	--public \
	--source=. \
	--remote=origin \
	--description "Stream Deck plugin: month calendar on LCD keys" \
	--push

echo "Published: https://github.com/sweet-little-adder/elgato-calendar-key"
