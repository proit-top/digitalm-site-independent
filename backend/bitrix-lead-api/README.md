# Digital M Bitrix lead endpoint

Node.js sidecar for the static `digitalm.agency` website. It creates CRM leads through a Bitrix24 incoming webhook; the webhook URL is read only from a root-only server environment file and is never part of the public site or Git repository.

## Current contract

- Public URL: `https://bitrix.digitalm.agency/digitalm-form/lead` (HTTPS only).
- Internal listener: `127.0.0.1:9016`; no public application port or separate DNS record.
- Allowed browser origin: exactly `https://digitalm.agency`.
- CRM method: `crm.lead.add`; minimum webhook scope: `crm`.
- Accepted fields: name, company, email/phone or case-request contact, task, and checked consent.
- No database and no local storage of submitted PII. Logs contain only request ID and event/status, never lead contents or webhook URL.
- Basic anti-abuse controls: exact Origin allowlist, per-IP in-memory rate limit, 64 KiB request limit, strict field length/type validation, consent requirement, HTTPS, and CRM-only webhook.
- Attachments are rejected (HTTP 422) until a file-type lead field and a deliberate upload flow are configured in CRM. The form must not report such a request as successfully submitted.

## Source and backup model

1. **Application and deployment templates:** version-controlled in this public GitHub repository at `backend/bitrix-lead-api/`. Restore with `git clone`/`git checkout` and copy the `src/` tree, systemd unit, and Nginx snippet to the paths below.
2. **Bitrix webhook secret:** only in the DigitalM Vaultwarden collection `digitalm битрикс24`, item `входящий вебхук на битрикс bitrix.digitalm.agency`. Never commit, archive, print, or put it in `settings.js`.
3. **Runtime secret file:** `/etc/digitalm-lead-api/bitrix.env`, root-owned mode `0600`. It is intentionally excluded from source backups; restore its value from that Vaultwarden item.
4. **CRM leads:** stored in Bitrix, not on this server; the app has no local lead database or uploads to back up.
5. **Pre-change rollback archive:** before production installation, save the exact existing Nginx site-settings snippets and record the archive path, timestamp, size, and checksum in the deployment report. This sidecar does not alter Bitrix files or its database.

## S3 backup (DigitalM production)

The existing nightly S3 Restic job on `gdm` already snapshots the full Bitrix document root `/home/bitrix/ext_www/bitrix.digitalm.agency` and its SQL dump. Its repository locator is `s3:s3.twcstorage.ru/ac256a3a-gdm`; credentials and Restic password remain in the protected runtime configuration/Vaultwarden and are never printed here.

The daily S3 job invokes `deploy/digitalm-custom-s3-backup.sh` for the Bitrix site. That helper refreshes a bare mirror of `proit-top/digitalm-site-independent` under `/root/backups/digitalm-site-independent.git` and adds a `digitalm-customization` Restic snapshot containing:

- `/opt/digitalm-lead-api/` (application source, tests, and deployment templates);
- `/etc/systemd/system/digitalm-lead-api.service` and its enabled symlink;
- `/etc/nginx/bx/site_settings/bitrix.digitalm.agency/lead-api.conf`;
- the bare Git mirror, including the static website and its history.

`/etc/digitalm-lead-api/bitrix.env` is deliberately excluded. Restore the webhook separately from Vaultwarden into a root-owned `0600` file. The usual S3 run is scheduled daily at 00:00 server time; a manual full Bitrix run has significant I/O, so use an agreed quiet window.

### Repeatable server snapshot

Run as root on the DigitalM Bitrix host; the archive intentionally excludes `/etc/digitalm-lead-api/bitrix.env`:

```sh
BACKUP="/var/backups/digitalm-lead-api/installed-code-config-$(date -u +%Y%m%d-%H%M%S).tar.gz"
tar -C / -czf "$BACKUP" \
  opt/digitalm-lead-api \
  etc/systemd/system/digitalm-lead-api.service \
  etc/systemd/system/multi-user.target.wants/digitalm-lead-api.service \
  etc/nginx/bx/site_settings/bitrix.digitalm.agency/lead-api.conf \
  root/scripts/digitalm-custom-s3-backup.sh \
  root/backups/digitalm-site-independent.git
chmod 0600 "$BACKUP"
tar -tzf "$BACKUP" >/dev/null && sha256sum "$BACKUP"
```

The code and deployment templates are also recoverable from the public GitHub repository. Restore code/config from a verified archive or repository, restore the webhook value separately from Vaultwarden into the root-only environment file, then run `systemd-analyze verify`, `nginx -t`, and read back both service states. Never include the environment file in a tar archive or Git commit.

## Install / restore

Use root on the DigitalM production Bitrix host only after verifying the hostname and making the pre-change archive described above.

1. Copy `src/` and `test/` to `/opt/digitalm-lead-api/` (root-owned, readable by the service account).
2. Create the unprivileged account `digitalm-lead-api` with no login shell and no home directory.
3. Install `deploy/digitalm-lead-api.service` to `/etc/systemd/system/digitalm-lead-api.service`.
4. Create `/etc/digitalm-lead-api/bitrix.env` with the single setting `BITRIX_WEBHOOK_URL=<value from Vaultwarden password field>`. Set owner `root:root`, mode `0600`; do not place the value in shell arguments, command output, backups, or Git.
5. Install `deploy/nginx-digitalm-lead-api.conf` as `/etc/nginx/bx/site_settings/bitrix.digitalm.agency/lead-api.conf`. The Bitrix host includes this directory's `*.conf` in both HTTP and HTTPS vhosts. Validate with `nginx -t` before reload.
6. Run `node --test /opt/digitalm-lead-api/test/*.test.mjs` before start; run `systemctl daemon-reload`, enable/start only this sidecar, then check its status and `127.0.0.1:9016` listener. Reload Nginx only after config validation.
7. Set `window.FORM_ENDPOINT` in the public site's `settings.js` to `https://bitrix.digitalm.agency/digitalm-form/lead`; never put the webhook URL there.
8. Perform an end-to-end test, read the exact test lead back from CRM, then remove the test lead. Do not claim successful delivery until the CRM read-back confirms it.

## Rollback

- Disable the form by setting `FORM_ENDPOINT` to an empty string; the frontend fails closed and does not show a false success.
- Stop/disable only `digitalm-lead-api.service`.
- Remove only `lead-api.conf` and run `nginx -t`; reload Nginx only if it passes.
- Restore the archived pre-change Nginx snippets if needed. The existing Bitrix application and database are unchanged.
- Keep the old `proit-top/digitalm` GitHub Pages repository and its domain configuration as the domain rollback target. Before a domain switch, record both repositories' Pages settings; restore the domain there if needed. DNS already points at GitHub Pages, so the domain rollback does not require DNS edits.

## Local verification

From this directory, run:

```sh
node --test test/*.test.mjs
```

Tests use a fake Bitrix response and never call the production webhook. The one deliberate live CRM verification is performed separately during controlled deployment and immediately cleaned up.
