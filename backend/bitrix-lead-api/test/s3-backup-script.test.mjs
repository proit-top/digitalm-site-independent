import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const helper = fileURLToPath(new URL('../deploy/digitalm-custom-s3-backup.sh', import.meta.url));

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'digitalm-s3-backup-test-'));
  for (const rel of [
    'opt/digitalm-lead-api/src/server.mjs',
    'etc/systemd/system/digitalm-lead-api.service',
    'etc/systemd/system/multi-user.target.wants/digitalm-lead-api.service',
    'etc/nginx/bx/site_settings/bitrix.digitalm.agency/lead-api.conf',
    'root/backups/digitalm-site-independent.git/HEAD',
    'root/scripts/digitalm-custom-s3-backup.sh',
  ]) {
    const path = join(root, rel);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, 'fixture');
  }
  mkdirSync(join(root, 'etc/digitalm-lead-api'), { recursive: true });
  writeFileSync(join(root, 'etc/digitalm-lead-api/bitrix.env'), 'sensitive fixture must never be included');
  return root;
}

test('S3 dry-run includes website mirror, sidecar, systemd and Nginx files but not webhook env', () => {
  assert.equal(requireScriptExists(), true);
  const root = fixture();
  try {
    const run = spawnSync('bash', [helper], {
      encoding: 'utf8',
      env: { ...process.env, DIGITALM_BACKUP_ROOT: root, DIGITALM_S3_BACKUP_DRY_RUN: '1' },
    });
    assert.equal(run.status, 0, run.stderr);
    for (const rel of [
      'root/backups/digitalm-site-independent.git',
      'opt/digitalm-lead-api',
      'etc/systemd/system/digitalm-lead-api.service',
      'etc/systemd/system/multi-user.target.wants/digitalm-lead-api.service',
      'etc/nginx/bx/site_settings/bitrix.digitalm.agency/lead-api.conf',
    ]) assert.ok(run.stdout.includes(join(root, rel)), `missing ${rel}`);
    assert.ok(!run.stdout.includes('bitrix.env'));
    assert.ok(!run.stdout.includes('sensitive fixture'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function requireScriptExists() {
  return spawnSync('test', ['-f', helper]).status === 0;
}
