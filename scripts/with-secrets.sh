#!/usr/bin/env bash
#
# Load SOPS secrets into environment variables, then run a command.
#

usage() {
    cat <<'EOF'
Usage: scripts/with-secrets.sh -- <command> [args...]
EOF
    exit 1
}

log_error() {
    printf 'Error: %s\n' "$*" >&2
}

if [[ "${1:-}" != "--" ]]; then
    log_error "Expected '--' before command"
    usage
fi
shift

if [[ $# -eq 0 ]]; then
    log_error "No command provided"
    usage
fi

SECRETS_JSON="$(sops decrypt secrets.yaml --output-type=json 2>/dev/null)"
rc=$?
if [[ $rc -ne 0 ]]; then
    log_error "Failed to decrypt secrets.yaml"
    exit $rc
fi

if [[ -z "$SECRETS_JSON" || "$SECRETS_JSON" == "{}" ]]; then
    log_error "secrets.yaml decrypted but is empty"
    exit 1
fi

while IFS= read -r secret_key; do
    [[ -z "$secret_key" ]] && continue

    secret_value="$(printf '%s' "$SECRETS_JSON" | jq -r --arg key "$secret_key" '.[$key] // empty')"
    rc=$?
    if [[ $rc -ne 0 ]]; then
        log_error "Failed to read secret key $secret_key"
        exit $rc
    fi

    [[ -z "$secret_value" ]] && continue

    env_key="$(printf '%s' "$secret_key" | tr '[:lower:]' '[:upper:]')"
    if [[ -v "$env_key" ]]; then
        continue
    fi

    export "$env_key=$secret_value"
done < <(printf '%s' "$SECRETS_JSON" | jq -r 'keys[]')

exec "$@"
