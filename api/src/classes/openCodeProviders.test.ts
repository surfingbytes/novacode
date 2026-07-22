// node_modules
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

// classes
import { saveOpenCodeProvider } from './openCodeProviders';

describe('saveOpenCodeProvider', () => {
  let configDir: string;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), 'oc-providers-'));
    mkdirSync(join(configDir, '.config/opencode'), { recursive: true });
    writeFileSync(
      join(configDir, '.config/opencode/opencode.json'),
      JSON.stringify({
        $schema: 'https://opencode.ai/config.json',
        provider: {
          moonshot: {
            npm: '@ai-sdk/openai-compatible',
            name: 'Moonshot',
            options: { baseURL: 'https://api.moonshot.ai/v1' },
            models: {
              'kimi-k3': {
                name: 'Kimi K3',
                attachment: true,
                modalities: { input: ['text', 'image', 'video', 'pdf'], output: ['text'] }
              }
            }
          }
        }
      })
    );
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
  });

  it('preserves per-model capability fields (attachment, modalities) on re-save', () => {
    saveOpenCodeProvider(configDir, {
      id: 'moonshot',
      name: 'Moonshot',
      adapter: 'openai-compatible',
      baseURL: 'https://api.moonshot.ai/v1',
      models: [{ id: 'kimi-k3', name: 'Kimi K3 (renamed)' }]
    });

    const written = JSON.parse(
      readFileSync(join(configDir, '.config/opencode/opencode.json'), 'utf8')
    );
    const model = written.provider.moonshot.models['kimi-k3'];
    expect(model.name).toBe('Kimi K3 (renamed)');
    expect(model.attachment).toBe(true);
    expect(model.modalities).toEqual({ input: ['text', 'image', 'video', 'pdf'], output: ['text'] });
  });
});
