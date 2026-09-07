#!/usr/bin/env bash
set -euo pipefail

base_ref="${1:-origin/${GITHUB_BASE_REF:-master}}"
paths_file=$(mktemp)
trap 'rm -f "$paths_file"' EXIT

# Capture the diff before reading it: process substitution would hide git diff failures.
git diff --name-only -z --diff-filter=AM "${base_ref}...HEAD" >"$paths_file"

files=()
while IFS= read -r -d '' file; do
  # Prefix paths as defense in depth, and terminate options below. NUL-delimited input
  # preserves spaces and newlines in filenames.
  files+=("./$file")
done <"$paths_file"

if [ "${#files[@]}" -eq 0 ]; then
  echo 'No changed files to check'
  exit 0
fi

# `--` prevents PR-controlled filenames from being parsed as Prettier options.
npx --no-install prettier --check --ignore-unknown -- "${files[@]}"
