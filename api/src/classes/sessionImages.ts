// node_modules
import { rm } from 'node:fs/promises';
import { join } from 'node:path';

// classes
import { config } from './config';

/** Uploaded prompt attachments, one directory per session. */
export const IMAGE_DIR = join(config.configDir, 'prompt-images');

export async function deleteSessionImages(sessionId: string): Promise<void> {
  const dir = join(IMAGE_DIR, sessionId);
  // guard: only delete inside IMAGE_DIR
  if (!dir.startsWith(IMAGE_DIR + '/')) return;
  try {
    await rm(dir, { recursive: true, force: true });
  } catch {
    // non-critical — ignore if directory doesn't exist
  }
}
