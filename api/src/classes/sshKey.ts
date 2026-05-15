import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PRIVATE_NAME = 'id_ed25519';
const PUBLIC_NAME = 'id_ed25519.pub';

/**
 * Ensures ~/.ssh under configDir exists with an ed25519 keypair and a minimal ssh config.
 * Idempotent; safe at API startup. Keys persist on the config volume.
 */
export function ensureSshKey(configDir: string): void {
  const sshDir = join(configDir, '.ssh');
  const privatePath = join(sshDir, PRIVATE_NAME);
  const publicPath = join(sshDir, PUBLIC_NAME);

  if (!existsSync(sshDir)) {
    mkdirSync(sshDir, { recursive: true });
    chmodSync(sshDir, 0o700);
  }

  if (!existsSync(privatePath)) {
    const result = spawnSync(
      'ssh-keygen',
      ['-t', 'ed25519', '-N', '', '-f', privatePath, '-C', 'novacode@container'],
      { encoding: 'utf8' }
    );
    if (result.status !== 0) {
      console.error('[ssh] ssh-keygen failed:', result.stderr || result.stdout || 'unknown error');
      return;
    }
    try {
      chmodSync(privatePath, 0o600);
      if (existsSync(publicPath)) {
        chmodSync(publicPath, 0o644);
      }
    } catch {
      // ignore chmod issues
    }
    console.log(`[ssh] Generated SSH key at ${privatePath}`);
  }

  const configPath = join(sshDir, 'config');
  const identityFile = join(sshDir, PRIVATE_NAME);
  const configBody =
    '# Nova Code managed — identity for Git and SSH from the app\n' +
    'Host *\n' +
    `  IdentityFile ${identityFile}\n` +
    '  IdentitiesOnly yes\n' +
    '  StrictHostKeyChecking accept-new\n';
  if (!existsSync(configPath)) {
    writeFileSync(configPath, configBody, 'utf8');
    try {
      chmodSync(configPath, 0o600);
    } catch {
      // ignore
    }
  }
}

export function readSshKeyMaterial(configDir: string): {
  sshPublicKey: string;
  sshPrivateKey: string;
} {
  const sshDir = join(configDir, '.ssh');
  const privatePath = join(sshDir, PRIVATE_NAME);
  const publicPath = join(sshDir, PUBLIC_NAME);
  let sshPublicKey = '';
  let sshPrivateKey = '';
  try {
    if (existsSync(publicPath)) {
      sshPublicKey = readFileSync(publicPath, 'utf8').trim();
    }
    if (existsSync(privatePath)) {
      sshPrivateKey = readFileSync(privatePath, 'utf8').trim();
    }
  } catch {
    // leave empty
  }
  return { sshPublicKey, sshPrivateKey };
}

/** Env fragment so git and ssh use the persisted key (e.g. `git push` over SSH inside Docker). */
export function sshEnvForGit(configDir: string): Record<string, string> {
  const privatePath = join(configDir, '.ssh', PRIVATE_NAME);
  if (!existsSync(privatePath)) return {};
  return {
    GIT_SSH_COMMAND: `ssh -i "${privatePath}" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new`
  };
}
