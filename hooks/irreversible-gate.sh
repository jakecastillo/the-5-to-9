#!/usr/bin/env bash
# The 5 to 9 — PreToolUse gate. Block irreversible OUTWARD actions; everything
# reversible proceeds. This is the safety model: small, explicit, fail-loud.
#
# It is a best-effort DENY-LIST, not a sandbox: it classifies the pending shell
# command and hard-stops the named irreversible-outward classes (deploy/publish,
# force-push, deleting remote data, destroying/rotating secrets). It splits the
# command on shell separators (&& || ; | &) and classifies each segment, so a
# keyword in one command can't leak across into another. Local destruction
# (rm -rf, dd) is intentionally out of scope — work is isolated to a deletable
# shift branch, and the branch + human review are the real backstop.
#
# Input: PreToolUse JSON on stdin. Output: a deny decision (JSON) on a match,
# else nothing. Never exits non-zero (a crashing gate must not break the host).
# Git-Bash-compatible.

F9_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
# shellcheck source=../scripts/lib/common.sh
. "$F9_ROOT/scripts/lib/common.sh" 2>/dev/null || true

# Always-available JSON-string escaper, even if common.sh failed to source.
if ! command -v f9_json_string >/dev/null 2>&1; then
  f9_json_string() {
    awk 'BEGIN{ORS="";printf "\""}{if(NR>1)printf "\\n";s=$0;gsub(/\\/,"\\\\",s);gsub(/"/,"\\\"",s);gsub(/\t/,"\\t",s);printf "%s",s}END{printf "\""}'
  }
fi

payload="$(cat 2>/dev/null || true)"

# Pull the shell command out of the tool input (jq preferred; sed fallback that
# stops at the closing quote so it doesn't over-capture trailing JSON).
cmd=""
if command -v jq >/dev/null 2>&1; then
  cmd="$(printf '%s' "$payload" | jq -r '.tool_input.command // .tool_input.cmd // empty' 2>/dev/null)"
fi
if [[ -z "$cmd" ]]; then
  cmd="$(printf '%s' "$payload" | sed -n 's/.*"command"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)"
fi

# Nothing to classify → allow.
[[ -z "$cmd" ]] && exit 0

# Deny-list of irreversible OUTWARD tool actions (case-insensitive ERE; each rule
# is anchored at a word boundary so it matches the tool, not a substring). Built
# to NOT block normal shift work (npm test, make build, git push origin <branch>).
F9_TOOL_RE='(^| )(npm|pnpm|yarn) +publish( |$)'
F9_TOOL_RE="$F9_TOOL_RE|(^| )(npm|pnpm|yarn) +run +deploy( |$)"
F9_TOOL_RE="$F9_TOOL_RE|(^| )make +deploy( |$)"
F9_TOOL_RE="$F9_TOOL_RE|(^| )cargo +publish( |$)|(^| )gem +push( |$)|(^| )twine +upload( |$)|(^| )poetry +publish( |$)"
F9_TOOL_RE="$F9_TOOL_RE|(^| )(mvn|gradle) +(deploy|publish)( |$)|(^| )dotnet +nuget +push( |$)"
F9_TOOL_RE="$F9_TOOL_RE|(^| )(gh|hub) +release +(create|delete|edit)( |$)|(^| )gh +repo +(delete|archive)( |$)|(^| )gh +secret +(delete|remove)( |$)|(^| )gh +gist +delete( |$)"
F9_TOOL_RE="$F9_TOOL_RE|(^| )docker +push( |$)"
F9_TOOL_RE="$F9_TOOL_RE|(^| )(kubectl|k) +(apply|create|replace|delete|patch|rollout|scale|edit)( |$)|(^| )helm +(install|upgrade|uninstall|delete)( |$)"
F9_TOOL_RE="$F9_TOOL_RE|(^| )terraform +(apply|destroy)( |$)|(^| )pulumi +(up|destroy)( |$)|(^| )cdk +(deploy|destroy)( |$)"
F9_TOOL_RE="$F9_TOOL_RE|(^| )wrangler +(deploy|publish)( |$)|(^| )pm2 +deploy( |$)|(^| )railway +up( |$)|(^| )ansible-playbook( |$)"
F9_TOOL_RE="$F9_TOOL_RE|(^| )(serverless|sls) +deploy( |$)|(^| )netlify +deploy( |$)|(^| )firebase +deploy( |$)|(^| )(flyctl|fly) +deploy( |$)"
F9_TOOL_RE="$F9_TOOL_RE|(^| )vercel( +[^ ]+)* +(--prod|deploy)( |$)|(^| )gcloud( +[^ ]+)* +deploy( |$)|(^| )heroku +(deploy|releases|pg:reset)( |$)"
F9_TOOL_RE="$F9_TOOL_RE|(^| )aws +(deploy|s3 +(rm|rb)|s3api +delete-[a-z]+|ecr +batch-delete-image|secretsmanager +(delete-secret|rotate-secret)|rds +delete-db[a-z-]*)( |$)"
F9_TOOL_RE="$F9_TOOL_RE|(^| )supabase +db +reset( |$)|(^| )vault +(kv +)?(delete|destroy)( |$)|(^| )dropdb( |$)|(^| )drop +database( |$)"

# git push: force / delete / mirror / +refspec / :refspec — tolerant of leading
# global options (git -C <dir>, git -c k=v, git --git-dir=...). Plain `--tags`
# is reversible and NOT blocked (tag *deletion* is caught by --delete / :refspec).
F9_GIT_PUSH_RE='(^| )git( +-[^ ]+( +[^ -][^ ]*)?)* +push( |$)'
F9_GIT_FORCE_RE='(--force|--force-with-lease|--mirror|--delete|(^| )-[a-z]*f( |$)| :[a-z0-9_./-]+| \+[a-z0-9_./-]+)'

seg_is_irreversible() {
  local seg="$1" n
  n="$(printf '%s' "$seg" | tr -s '[:space:]' ' ' | sed 's/^ //; s/ $//')"
  [[ -n "$n" ]] || return 1
  if printf '%s' "$n" | grep -qiE -- "$F9_GIT_PUSH_RE" \
     && printf '%s' "$n" | grep -qiE -- "$F9_GIT_FORCE_RE"; then
    return 0
  fi
  printf '%s' "$n" | grep -qiE -- "$F9_TOOL_RE"
}

emit_deny() {
  local seg="$1" reason rq
  reason="The 5 to 9 gate: this looks like an irreversible OUTWARD action (deploy / publish / force-push / delete remote data / destroy or rotate secrets). The night crew stops here on purpose — a human must review and run it manually. Everything reversible proceeds; this does not. Flagged command segment: ${seg}"
  rq="$(printf '%s' "$reason" | f9_json_string)"
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":%s}}\n' "$rq"
}

# Split on shell separators (&& || ; | &) and literal newlines so a keyword can't
# leak across commands, then classify each segment independently. The heredoc
# guarantees a trailing newline so `read` never drops the final segment.
segments="$(printf '%s' "$cmd" | sed -E 's/(\|\||&&|;|\||&)/\n/g')"
while IFS= read -r part; do
  [[ -n "$part" ]] || continue
  if seg_is_irreversible "$part"; then
    emit_deny "$part"
    exit 0
  fi
done <<EOF
$segments
EOF
exit 0
