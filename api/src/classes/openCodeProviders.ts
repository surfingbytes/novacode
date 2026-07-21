// node_modules
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const OPENCODE_CONFIG_FILE = '.config/opencode/opencode.json';
const OPENCODE_AUTH_FILE = '.local/share/opencode/auth.json';
const OPENCODE_LEGACY_AUTH_FILE = '.opencode/auth.json';

export type OpenCodeProviderAdapter = 'openai-compatible' | 'openai' | 'custom';

export interface OpenCodeProviderModel {
  id: string;
  name: string;
}

export interface OpenCodeProviderSummary {
  id: string;
  name: string;
  npm: string;
  adapter: OpenCodeProviderAdapter;
  baseURL: string;
  models: OpenCodeProviderModel[];
  authenticated: boolean;
}

export interface SaveOpenCodeProviderInput {
  id: string;
  name: string;
  adapter: OpenCodeProviderAdapter;
  npm?: string;
  baseURL: string;
  models: OpenCodeProviderModel[];
  apiKey?: string;
}

type JsonRecord = Record<string, unknown>;

interface OpenCodeAuthEntry {
  key?: string;
  type?: string;
}

const ADAPTER_NPM: Record<Exclude<OpenCodeProviderAdapter, 'custom'>, string> = {
  'openai-compatible': '@ai-sdk/openai-compatible',
  openai: '@ai-sdk/openai'
};

function configPath(configDir: string): string {
  return join(configDir, OPENCODE_CONFIG_FILE);
}

function authPath(configDir: string): string {
  return join(configDir, OPENCODE_AUTH_FILE);
}

function legacyAuthPath(configDir: string): string {
  return join(configDir, OPENCODE_LEGACY_AUTH_FILE);
}

function readJsonObject(path: string): JsonRecord {
  if (!existsSync(path)) {
    return {};
  }
  try {
    const raw = readFileSync(path, 'utf8');
    if (!raw.trim()) {
      return {};
    }
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as JsonRecord : {};
  } catch {
    return {};
  }
}

function writeJsonObject(path: string, value: JsonRecord): void {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function providerMap(root: JsonRecord): JsonRecord {
  const existing = root.provider;
  if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
    return existing as JsonRecord;
  }
  const next: JsonRecord = {};
  root.provider = next;
  return next;
}

function authMap(root: JsonRecord): Record<string, OpenCodeAuthEntry> {
  return root as Record<string, OpenCodeAuthEntry>;
}

function readAuth(configDir: string): Record<string, OpenCodeAuthEntry> {
  const legacy = authMap(readJsonObject(legacyAuthPath(configDir)));
  const current = authMap(readJsonObject(authPath(configDir)));
  const merged = { ...legacy, ...current };
  const hasLegacyOnlyKeys = Object.keys(legacy).some((key) => current[key] === undefined);
  if (hasLegacyOnlyKeys) {
    writeAuth(configDir, merged);
  }
  return merged;
}

function writeAuth(configDir: string, auth: Record<string, OpenCodeAuthEntry>): void {
  writeJsonObject(authPath(configDir), auth);
}

function stringProp(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function objectProp(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function adapterFromNpm(npm: string): OpenCodeProviderAdapter {
  if (npm === ADAPTER_NPM['openai-compatible']) {
    return 'openai-compatible';
  }
  if (npm === ADAPTER_NPM.openai) {
    return 'openai';
  }
  return 'custom';
}

function npmForInput(input: SaveOpenCodeProviderInput): string {
  if (input.adapter === 'custom') {
    return input.npm?.trim() ?? '';
  }
  return ADAPTER_NPM[input.adapter];
}

function validateProviderId(id: string): string {
  const trimmed = id.trim();
  if (!/^[a-z0-9][a-z0-9._-]{1,62}$/i.test(trimmed)) {
    throw new Error('Provider id must be 2-63 characters and use letters, numbers, dots, underscores, or hyphens.');
  }
  return trimmed;
}

function validateUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error('invalid protocol');
    }
    return trimmed.replace(/\/+$/, '');
  } catch {
    throw new Error('Base URL must be a valid HTTP or HTTPS URL.');
  }
}

function validateModels(models: OpenCodeProviderModel[]): OpenCodeProviderModel[] {
  const normalized = models
    .map((model) => ({
      id: model.id.trim(),
      name: model.name.trim() || model.id.trim()
    }))
    .filter((model) => model.id);
  if (normalized.length === 0) {
    throw new Error('At least one model id is required.');
  }
  for (const model of normalized) {
    if (!/^[a-z0-9][a-z0-9._:/@+-]*$/i.test(model.id)) {
      throw new Error(`Invalid model id: ${model.id}`);
    }
  }
  return normalized;
}

function isAuthenticated(auth: Record<string, OpenCodeAuthEntry>, providerId: string): boolean {
  const key = auth[providerId]?.key;
  return typeof key === 'string' && key.trim().length > 0;
}

export function readOpenCodeProviders(configDir: string): OpenCodeProviderSummary[] {
  const configRoot = readJsonObject(configPath(configDir));
  const providers = providerMap(configRoot);
  const auth = readAuth(configDir);

  return Object.entries(providers)
    .map(([id, raw]) => {
      const provider = objectProp(raw);
      const options = objectProp(provider.options);
      const modelsRaw = objectProp(provider.models);
      const npm = stringProp(provider.npm);
      const models = Object.entries(modelsRaw).map(([modelId, rawModel]) => {
        const model = objectProp(rawModel);
        return {
          id: modelId,
          name: stringProp(model.name) || modelId
        };
      });
      return {
        id,
        name: stringProp(provider.name) || id,
        npm,
        adapter: adapterFromNpm(npm),
        baseURL: stringProp(options.baseURL),
        models,
        authenticated: isAuthenticated(auth, id)
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function hasAnyOpenCodeAuth(configDir: string): boolean {
  const auth = readAuth(configDir);
  return Object.values(auth).some((entry) => {
    const key = entry?.key;
    return typeof key === 'string' && key.trim().length > 0;
  });
}

export function saveOpenCodeProvider(
  configDir: string,
  input: SaveOpenCodeProviderInput
): OpenCodeProviderSummary {
  const id = validateProviderId(input.id);
  const name = input.name.trim() || id;
  const baseURL = validateUrl(input.baseURL);
  const npm = npmForInput(input);
  if (!npm) {
    throw new Error('Provider package is required for custom adapters.');
  }
  const models = validateModels(input.models);

  const configRoot = readJsonObject(configPath(configDir));
  if (!configRoot.$schema) {
    configRoot.$schema = 'https://opencode.ai/config.json';
  }
  const providers = providerMap(configRoot);
  providers[id] = {
    npm,
    name,
    options: { baseURL },
    models: Object.fromEntries(models.map((model) => [model.id, { name: model.name }]))
  };
  writeJsonObject(configPath(configDir), configRoot);

  const apiKey = input.apiKey?.trim();
  if (apiKey) {
    const auth = readAuth(configDir);
    auth[id] = { key: apiKey, type: 'api' };
    writeAuth(configDir, auth);
  }

  const authenticated = apiKey ? true : isAuthenticated(readAuth(configDir), id);
  return { id, name, npm, adapter: adapterFromNpm(npm), baseURL, models, authenticated };
}

export function deleteOpenCodeProvider(configDir: string, id: string): void {
  const providerId = validateProviderId(id);
  const configRoot = readJsonObject(configPath(configDir));
  const providers = providerMap(configRoot);
  delete providers[providerId];
  writeJsonObject(configPath(configDir), configRoot);

  const auth = readAuth(configDir);
  delete auth[providerId];
  writeAuth(configDir, auth);

  const legacyAuth = authMap(readJsonObject(legacyAuthPath(configDir)));
  if (legacyAuth[providerId]) {
    delete legacyAuth[providerId];
    writeJsonObject(legacyAuthPath(configDir), legacyAuth);
  }
}

export function deleteOpenCodeProviderAuth(configDir: string, id: string): void {
  const providerId = validateProviderId(id);
  const auth = readAuth(configDir);
  delete auth[providerId];
  writeAuth(configDir, auth);

  const legacyAuth = authMap(readJsonObject(legacyAuthPath(configDir)));
  if (legacyAuth[providerId]) {
    delete legacyAuth[providerId];
    writeJsonObject(legacyAuthPath(configDir), legacyAuth);
  }
}
