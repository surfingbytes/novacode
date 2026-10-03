// node_modules
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
    vi.unstubAllGlobals();
    rmSync(configDir, { recursive: true, force: true });
  });

  it('preserves per-model capability fields (attachment, modalities) on re-save', async () => {
    await saveOpenCodeProvider(configDir, {
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

  it('stores OpenAI auth without pinning a model list so the catalog can load', async () => {
    await saveOpenCodeProvider(configDir, {
      id: 'openai',
      name: 'OpenAI',
      adapter: 'openai',
      baseURL: 'https://api.openai.com/v1',
      models: [],
      apiKey: 'sk-svcacct-test'
    });

    const written = JSON.parse(
      readFileSync(join(configDir, '.config/opencode/opencode.json'), 'utf8')
    );
    expect(written.provider.openai.models).toBeUndefined();
    const auth = JSON.parse(
      readFileSync(join(configDir, '.local/share/opencode/auth.json'), 'utf8')
    );
    expect(auth.openai).toEqual({ key: 'sk-svcacct-test', type: 'api' });
  });

  it('loads openai-compatible models from GET /models when none are given', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { id: 'gpt-6.1-sol' },
          { id: 'text-embedding-3-small' },
          { id: 'whisper-1' }
        ]
      })
    });
    vi.stubGlobal('fetch', fetchMock);

    const saved = await saveOpenCodeProvider(configDir, {
      id: 'proxy',
      name: 'Proxy',
      adapter: 'openai-compatible',
      baseURL: 'https://proxy.example/v1',
      models: [],
      apiKey: 'sk-test'
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://proxy.example/v1/models',
      expect.objectContaining({ headers: { Authorization: 'Bearer sk-test' } })
    );
    expect(saved.models.map((model) => model.id)).toEqual(['gpt-6.1-sol']);
    vi.unstubAllGlobals();
  });
});
