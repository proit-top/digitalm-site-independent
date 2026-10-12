#!/usr/bin/env bash
# Called by the existing daily Bitrix S3 job after RESTIC_ENV is loaded.
set -Eeuo pipefail
umask 077

ROOT="${DIGITALM_BACKUP_ROOT:-/}"
root_path() {
  printf '%s/%s' "${ROOT%/}" "$1"
}

MIRROR_DIR="${DIGITALM_SITE_MIRROR:-$(root_path root/backups/digitalm-site-independent.git)}"
REPO_URL='https://github.com/proit-top/digitalm-site-independent.git'
APP_ROOT="$(root_path opt/digitalm-lead-api)"
SERVICE_UNIT="$(root_path etc/systemd/system/digitalm-lead-api.service)"
SERVICE_LINK="$(root_path etc/systemd/system/multi-user.target.wants/digitalm-lead-api.service)"
NGINX_SNIPPET="$(root_path etc/nginx/bx/site_settings/bitrix.digitalm.agency/lead-api.conf)"
BACKUP_SCRIPT="$(root_path root/scripts/digitalm-custom-s3-backup.sh)"
RESTIC_BIN="${RESTIC_BIN:-restic}"
DRY_RUN="${DIGITALM_S3_BACKUP_DRY_RUN:-0}"

SOURCES=("$APP_ROOT" "$SERVICE_UNIT" "$SERVICE_LINK" "$NGINX_SNIPPET" "$BACKUP_SCRIPT")
for path in "${SOURCES[@]}"; do
  if [[ ! -e "$path" ]]; then
    printf 'required backup path missing: %s\n' "$path" >&2
    exit 1
  fi
done

if [[ "$DRY_RUN" == '1' ]]; then
  printf 'DRY RUN: Restic customization snapshot would include:\n'
  printf '  %s\n' "${SOURCES[@]}" "$MIRROR_DIR"
  printf 'DRY RUN: webhook environment file is intentionally excluded.\n'
  exit 0
fi

mkdir -p "$(dirname "$MIRROR_DIR")"
if [[ -d "$MIRROR_DIR" ]]; then
  if ! git --git-dir="$MIRROR_DIR" remote update --prune --quiet; then
    printf 'warning: GitHub fetch failed; backing up the last verified site mirror.\n' >&2
  fi
else
  TMP_MIRROR="${MIRROR_DIR}.tmp.$$"
  trap 'rm -rf -- "$TMP_MIRROR"' EXIT
  git clone --mirror --quiet "$REPO_URL" "$TMP_MIRROR"
  mv -- "$TMP_MIRROR" "$MIRROR_DIR"
  trap - EXIT
fi

if ! git --git-dir="$MIRROR_DIR" show-ref --verify --quiet refs/heads/main; then
  printf 'site mirror has no main branch; refusing incomplete S3 snapshot.\n' >&2
  exit 1
fi
SOURCES+=("$MIRROR_DIR")
printf 'creating encrypted S3 snapshot for the DigitalM website integration.\n'
"$RESTIC_BIN" backup "${SOURCES[@]}" --tag digitalm-customization
