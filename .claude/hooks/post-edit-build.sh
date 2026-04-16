#!/usr/bin/env bash
# Post-edit build + lint hook.
# Reads PostToolUse JSON from stdin, detects changed file, runs relevant checks.

set -euo pipefail

REPO_ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"

input=$(cat)
file=$(echo "$input" | python3 -c "
import sys, json
d = json.load(sys.stdin)
ti = d.get('tool_input', {})
print(ti.get('file_path', ti.get('new_file_path', '')))
" 2>/dev/null || true)

[[ -z "$file" ]] && exit 0

# Normalize to absolute path
[[ "$file" != /* ]] && file="$REPO_ROOT/$file"

run_rust() {
    echo "==> cargo clippy"
    cargo clippy --manifest-path "$REPO_ROOT/Cargo.toml" -- -D warnings
    echo "==> cargo build"
    cargo build --manifest-path "$REPO_ROOT/Cargo.toml"
}

run_frontend() {
    echo "==> ng lint"
    (cd "$REPO_ROOT/frontend/cancrab-frontend" && npx ng lint --no-progress)
    echo "==> npm run build"
    (cd "$REPO_ROOT/frontend/cancrab-frontend" && npm run build -- --no-progress 2>&1 | tail -20)
}

run_docker() {
    local dockerfile="$1"
    echo "==> hadolint $dockerfile"
    docker run --rm -i hadolint/hadolint < "$dockerfile"
    echo "==> docker compose build"
    (cd "$REPO_ROOT" && docker compose build 2>&1 | tail -30)
}

case "$file" in
    *.rs)
        run_rust
        ;;
    */frontend/cancrab-frontend/*.ts|\
    */frontend/cancrab-frontend/*.html|\
    */frontend/cancrab-frontend/*.scss|\
    */frontend/cancrab-frontend/*.css)
        run_frontend
        ;;
    */frontend/cancrab-frontend/Dockerfile|\
    */frontend/cancrab-frontend/nginx.conf)
        run_frontend
        run_docker "$REPO_ROOT/frontend/cancrab-frontend/Dockerfile"
        ;;
    "$REPO_ROOT/Dockerfile"*|\
    "$REPO_ROOT/docker-compose"*)
        dockerfile=$(echo "$input" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(d.get('tool_input', {}).get('file_path', ''))
" 2>/dev/null || true)
        if [[ "$dockerfile" == Dockerfile* ]]; then
            run_docker "$REPO_ROOT/$dockerfile"
        else
            run_docker "$REPO_ROOT/Dockerfile.backend"
        fi
        ;;
    */Cargo.toml|*/Cargo.lock)
        run_rust
        ;;
    */package.json|*/package-lock.json)
        run_frontend
        ;;
esac
