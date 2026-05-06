#!/bin/sh
# Combined Claude statusline wrapper.
# Runs the preserved user command first, then the Autopus statusline.

set -eu

payload=$(cat)
user_command=""

if [ -f ".claude/statusline-user-command.txt" ]; then
  user_command=$(cat ".claude/statusline-user-command.txt")
fi

user_output=""
if [ -n "$user_command" ]; then
  user_output=$(printf '%s' "$payload" | sh -lc "$user_command" 2>/dev/null || true)
fi

autopus_output=$(printf '%s' "$payload" | .claude/statusline.sh 2>/dev/null || true)

if [ -n "$user_output" ] && [ -n "$autopus_output" ]; then
  printf "%s\n%s\n" "$user_output" "$autopus_output"
  exit 0
fi

if [ -n "$user_output" ]; then
  printf "%s\n" "$user_output"
  exit 0
fi

printf "%s\n" "$autopus_output"
