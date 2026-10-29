import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from './logger';

const PRIVATE_NAME = 'id_ed25519';
const PUBLIC_NAME = 'id_ed25519.pub';

const execFileAsync = promisify(execFile);

/**
 * Ensures ~/.ssh under configDir exists with an ed25519 keypair and a minimal ssh config.
 * Idempotent; safe at API startup. Keys persist on the config volume.
 */
export async function ensureSshKey(configDir: string): Promise<void> {
  const sshDir = join(configDir, '.ssh');
  const privatePath = join(sshDir, PRIVATE_NAME);
  const publicPath = join(sshDir, PUBLIC_NAME);

  if (!existsSync(sshDir)) {
    mkdirSync(sshDir, { recursive: true });
    chmodSync(sshDir, 0o700);
  }

  if (!existsSync(privatePath)) {
    try {
      await execFileAsync(
        'ssh-keygen',
        ['-t', 'ed25519', '-N', '', '-f', privatePath, '-C', 'novacode@container'],
        { encoding: 'utf8' }
      );
    } catch (err) {
      const { stderr, stdout, message } = err as { stderr?: string; stdout?: string; message?: string };
      logger.error({ output: stderr || stdout || message || 'unknown error' }, 'ssh-keygen failed');
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
    logger.info({ path: privatePath }, 'Generated SSH key');
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
