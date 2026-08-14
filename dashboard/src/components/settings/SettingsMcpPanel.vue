<script setup lang="ts">
// node_modules
import { ref, onMounted } from 'vue';

// components
import BaseModal from '@/components/BaseModal.vue';
import ModalHeader from '@/components/ModalHeader.vue';

// classes
import { settingsApi } from '@/classes/api';

// types
import type { McpClientServer, McpConnectivityCheckResult } from '@/@types/index';

// -------------------------------------------------- Refs --------------------------------------------------
const mcpClients = ref<Record<string, McpClientServer>>({});
const bLoadingMcpClients = ref<boolean>(false);
const bSavingMcpClients = ref<boolean>(false);
const bShowMcpClientModal = ref<boolean>(false);
const mcpClientEditName = ref<string | null>(null);
const mcpClientForm = ref<{
  name: string;
  type: 'command' | 'url';
  command: string;
  args: string;
  env: string;
  url: string;
  headers: string;
}>({ name: '', type: 'command', command: '', args: '', env: '', url: '', headers: '' });
const mcpClientFormError = ref<string>('');
const bCheckingMcpConnectivity = ref<boolean>(false);
const mcpConnectivityResults = ref<Record<string, McpConnectivityCheckResult> | null>(null);
const mcpConnectivityError = ref<string>('');

// -------------------------------------------------- Methods --------------------------------------------------
const loadMcpClients = async (): Promise<void> => {
  bLoadingMcpClients.value = true;
  try {
    const response = await settingsApi.getMcpClients();
    mcpClients.value = response.data.servers;
  } catch {
    mcpClients.value = {};
  } finally {
    bLoadingMcpClients.value = false;
  }
};

const openAddMcpClient = (): void => {
  mcpClientEditName.value = null;
  mcpClientForm.value = {
    name: '', type: 'command', command: '', args: '', env: '', url: '', headers: ''
  };
  mcpClientFormError.value = '';
  bShowMcpClientModal.value = true;
};

const openEditMcpClient = (name: string): void => {
  const server = mcpClients.value[name];
  if (!server) {
    return;
  }
  mcpClientEditName.value = name;
  const isUrl =
    (!!server.url && !server.command) || server.type === 'http' || server.type === 'sse';
  mcpClientForm.value = {
    name,
    type: isUrl ? 'url' : 'command',
    command: server.command ?? '',
    args: (server.args ?? []).join('\n'),
    env: Object.entries(server.env ?? {})
      .map(([k, v]) => `${k}=${v}`)
      .join('\n'),
    url: server.url ?? '',
    headers: Object.entries(server.headers ?? {})
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n')
  };
  mcpClientFormError.value = '';
  bShowMcpClientModal.value = true;
};

const saveMcpClient = async (): Promise<void> => {
  const form = mcpClientForm.value;
  const name = form.name.trim();
  if (!name) {
    mcpClientFormError.value = 'Server name is required.';
    return;
  }
  if (mcpClientEditName.value !== name && name in mcpClients.value) {
    mcpClientFormError.value = 'A server with this name already exists.';
    return;
  }

  const server: McpClientServer = {};
  if (form.type === 'command') {
    if (!form.command.trim()) {
      mcpClientFormError.value = 'Command is required.';
      return;
    }
    server.command = form.command.trim();
    const args = form.args
      .split('\n')
      .map((argument) => argument.trim())
      .filter(Boolean);
    if (args.length > 0) {
      server.args = args;
    }
    const env: Record<string, string> = {};
    for (const line of form.env.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      const equalsIndex = trimmed.indexOf('=');
      if (equalsIndex > 0) {
        env[trimmed.slice(0, equalsIndex).trim()] = trimmed.slice(equalsIndex + 1).trim();
      }
    }
    if (Object.keys(env).length > 0) {
      server.env = env;
    }
  } else {
    if (!form.url.trim()) {
      mcpClientFormError.value = 'URL is required.';
      return;
    }
    server.url = form.url.trim();
    const headers: Record<string, string> = {};
    for (const line of form.headers.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      const colonIndex = trimmed.indexOf(':');
      if (colonIndex > 0) {
        headers[trimmed.slice(0, colonIndex).trim()] = trimmed.slice(colonIndex + 1).trim();
      }
    }
    if (Object.keys(headers).length > 0) {
      server.headers = headers;
    }
  }

  const updated = { ...mcpClients.value };
  if (mcpClientEditName.value && mcpClientEditName.value !== name) {
    delete updated[mcpClientEditName.value];
  }
  updated[name] = server;

  bSavingMcpClients.value = true;
  try {
    const response = await settingsApi.saveMcpClients(updated);
    mcpClients.value = response.data.servers;
    bShowMcpClientModal.value = false;
  } catch {
    mcpClientFormError.value = 'Failed to save.';
  } finally {
    bSavingMcpClients.value = false;
  }
};

const deleteMcpClient = async (name: string): Promise<void> => {
  const updated = { ...mcpClients.value };
  delete updated[name];
  bSavingMcpClients.value = true;
  try {
    const response = await settingsApi.saveMcpClients(updated);
    mcpClients.value = response.data.servers;
  } catch {
    // ignore
  } finally {
    bSavingMcpClients.value = false;
  }
};

const runMcpConnectivityCheck = async (): Promise<void> => {
  if (Object.keys(mcpClients.value).length === 0) {
    return;
  }
  mcpConnectivityError.value = '';
  bCheckingMcpConnectivity.value = true;
  mcpConnectivityResults.value = null;
  try {
    const response = await settingsApi.checkMcpClients();
    mcpConnectivityResults.value = response.data.results;
  } catch {
    mcpConnectivityError.value = 'Connectivity check failed.';
  } finally {
    bCheckingMcpConnectivity.value = false;
  }
};

onMounted((): void => {
  loadMcpClients();
});
</script>

<template>
  <div role="tabpanel">
        <!-- MCP client servers -->
        <div>
          <div class="settings-section-label nc-eyebrow">MCP client servers</div>
          <p class="settings-section-desc">
            Register <strong class="text-text-primary font-medium">external</strong> MCP servers (stdio or HTTP) for
            Cursor and Claude Code. The API writes your config volume (<code
              class="bg-fg/[0.06] border border-fg/[0.08] px-1.5 py-0.5 rounded text-text-primary font-mono text-[11px]"
              >CONFIG_DIR</code
            >): Cursor reads
            <code
              class="bg-fg/[0.06] border border-fg/[0.08] px-1.5 py-0.5 rounded text-text-primary font-mono text-[11px]"
              >.cursor/mcp.json</code>
            ; Claude merges
            <code
              class="bg-fg/[0.06] border border-fg/[0.08] px-1.5 py-0.5 rounded text-text-primary font-mono text-[11px]"
              >mcpServers</code>
            into
            <code
              class="bg-fg/[0.06] border border-fg/[0.08] px-1.5 py-0.5 rounded text-text-primary font-mono text-[11px]"
              >.claude.json</code>
            (applies to all workspaces using this server).
          </p>

          <div class="bg-fg/[0.02] border border-fg/[0.07] rounded-xl p-5">
            <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
              <span class="text-sm text-text-primary">Configured servers</span>
              <div class="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  class="flex items-center gap-2 bg-fg/[0.05] hover:bg-fg/[0.09] disabled:opacity-50 disabled:cursor-not-allowed border border-fg/[0.1] text-text-primary text-sm font-medium px-4 py-2.5 rounded-lg transition-all"
                  :disabled="
                    bSavingMcpClients ||
                    bLoadingMcpClients ||
                    bCheckingMcpConnectivity ||
                    Object.keys(mcpClients).length === 0
                  "
                  @click="runMcpConnectivityCheck"
                >
                  <span
                    v-if="bCheckingMcpConnectivity"
                    class="w-3.5 h-3.5 border-2 border-fg/30 border-t-fg rounded-full animate-spin"
                  ></span>
                  Test connectivity
                </button>
                <button
                  class="flex items-center gap-2 bg-primary hover:bg-primary-hover disabled:opacity-50 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-all"
                  :disabled="bSavingMcpClients"
                  @click="openAddMcpClient"
                >
                  Add server
                </button>
              </div>
            </div>
            <p class="text-xs text-text-muted mb-4">
              Dry-run: command (stdio) servers are spawned briefly on the host; HTTP servers are
              requested with GET. Fix failures here before agents load MCP mid-session.
            </p>
            <p v-if="mcpConnectivityError" class="text-xs text-destructive mb-3">
              {{ mcpConnectivityError }}
            </p>
            <div
              v-if="mcpConnectivityResults && Object.keys(mcpConnectivityResults).length > 0"
              class="mb-4 rounded-lg border border-fg/[0.08] bg-fg/[0.03] divide-y divide-fg/[0.06]"
            >
              <div
                v-for="(connectivityResult, name) in mcpConnectivityResults"
                :key="name"
                class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-1 px-3 py-2.5 text-sm"
              >
                <span class="font-medium text-text-primary">{{ name }}</span>
                <span
                  class="text-xs font-medium shrink-0"
                  :class="connectivityResult.ok ? 'text-success' : 'text-destructive'"
                >
                  {{ connectivityResult.ok ? `${connectivityResult.kind === 'http' ? 'HTTP' : 'stdio'} OK` : 'Failed' }}
                  <span v-if="connectivityResult.detail" class="text-text-muted font-normal"> — {{ connectivityResult.detail }}</span>
                  <span v-if="connectivityResult.error" class="text-destructive"> — {{ connectivityResult.error }}</span>
                </span>
              </div>
            </div>
            <div v-if="bLoadingMcpClients" class="text-sm text-text-muted py-4">Loading…</div>
            <div
              v-else-if="Object.keys(mcpClients).length === 0"
              class="text-sm text-text-muted py-4"
            >
              No MCP servers configured yet.
            </div>
            <ul v-else class="space-y-3">
              <li
                v-for="(server, name) in mcpClients"
                :key="name"
                class="flex items-center justify-between gap-4 py-3 border-b border-fg/[0.06] last:border-0"
              >
                <div class="min-w-0">
                  <div class="flex items-center gap-2">
                    <p class="text-sm font-medium text-text-primary truncate">{{ name }}</p>
                    <span
                      class="inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded border"
                      :class="
                        server.url && !server.command
                          ? 'bg-primary/10 text-primary border-primary/20'
                          : 'bg-fg/[0.06] text-text-muted border-fg/[0.1]'
                      "
                    >
                      {{
                        server.url && !server.command
                          ? server.type === 'sse'
                            ? 'SSE'
                            : 'HTTP'
                          : 'stdio'
                      }}
                    </span>
                  </div>
                  <p class="text-xs text-text-muted font-mono mt-0.5 truncate">
                    {{
                      server.command
                        ? `${server.command} ${(server.args ?? []).join(' ')}`
                        : server.url
                    }}
                  </p>
                </div>
                <div class="flex items-center gap-1 flex-shrink-0">
                  <button
                    class="text-xs text-text-muted hover:text-text-primary hover:bg-fg/[0.08] px-2.5 py-1.5 rounded-lg transition-colors"
                    @click="openEditMcpClient(name as string)"
                  >
                    Edit
                  </button>
                  <button
                    class="text-xs text-destructive hover:bg-destructive/10 px-2.5 py-1.5 rounded-lg transition-colors"
                    :disabled="bSavingMcpClients"
                    @click="deleteMcpClient(name as string)"
                  >
                    Delete
                  </button>
                </div>
              </li>
            </ul>
          </div>
        </div>
  </div>

    <!-- MCP client server modal -->
    <BaseModal
      v-model="bShowMcpClientModal"
      labelledby="mcp-client-modal-title"
      panel-class="max-w-md"
    >
            <ModalHeader
              :eyebrow="mcpClientEditName ? '// edit mcp server' : '// add mcp server'"
              :title="mcpClientEditName ? 'Edit MCP server' : 'Add MCP server'"
              title-id="mcp-client-modal-title"
              @close="bShowMcpClientModal = false"
            />
            <div class="max-h-[70vh] min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
              <div>
                <label class="block text-sm font-medium text-text-primary mb-1.5">Server name</label>
                <input
                  v-model="mcpClientForm.name"
                  type="text"
                  placeholder="e.g. filesystem"
                  class="w-full bg-fg/[0.05] border border-fg/[0.1] rounded-lg px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all"
                  :disabled="bSavingMcpClients"
                />
              </div>
              <div>
                <label class="block text-sm font-medium text-text-primary mb-1.5">Type</label>
                <div class="flex gap-1 p-0.5 rounded-lg bg-fg/[0.04] border border-fg/[0.07]">
                  <button
                    type="button"
                    class="flex-1 text-sm font-medium py-2 rounded-md transition-colors"
                    :class="
                      mcpClientForm.type === 'command'
                        ? 'bg-fg/[0.08] text-text-primary'
                        : 'text-text-muted hover:text-text-primary'
                    "
                    @click="mcpClientForm.type = 'command'"
                  >
                    Command (stdio)
                  </button>
                  <button
                    type="button"
                    class="flex-1 text-sm font-medium py-2 rounded-md transition-colors"
                    :class="
                      mcpClientForm.type === 'url'
                        ? 'bg-fg/[0.08] text-text-primary'
                        : 'text-text-muted hover:text-text-primary'
                    "
                    @click="mcpClientForm.type = 'url'"
                  >
                    URL (HTTP)
                  </button>
                </div>
              </div>
              <template v-if="mcpClientForm.type === 'command'">
                <div>
                  <label class="block text-sm font-medium text-text-primary mb-1.5">Command</label>
                  <input
                    v-model="mcpClientForm.command"
                    type="text"
                    placeholder="npx"
                    class="w-full bg-fg/[0.05] border border-fg/[0.1] rounded-lg px-3 py-2.5 text-sm text-text-primary font-mono placeholder:text-text-muted outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all"
                    :disabled="bSavingMcpClients"
                  />
                </div>
                <div>
                  <label class="block text-sm font-medium text-text-primary mb-1.5">
                    Arguments
                    <span class="text-text-muted font-normal">(one per line)</span>
                  </label>
                  <textarea
                    v-model="mcpClientForm.args"
                    rows="3"
                    placeholder="-y&#10;@modelcontextprotocol/server-filesystem&#10;/path/to/dir"
                    class="w-full bg-fg/[0.05] border border-fg/[0.1] rounded-lg px-3 py-2.5 text-sm text-text-primary font-mono placeholder:text-text-muted outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all resize-y"
                    :disabled="bSavingMcpClients"
                  ></textarea>
                </div>
                <div>
                  <label class="block text-sm font-medium text-text-primary mb-1.5">
                    Environment variables
                    <span class="text-text-muted font-normal">(KEY=VALUE, one per line)</span>
                  </label>
                  <textarea
                    v-model="mcpClientForm.env"
                    rows="2"
                    placeholder="API_KEY=…"
                    class="w-full bg-fg/[0.05] border border-fg/[0.1] rounded-lg px-3 py-2.5 text-sm text-text-primary font-mono placeholder:text-text-muted outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all resize-y"
                    :disabled="bSavingMcpClients"
                  ></textarea>
                </div>
              </template>
              <template v-else>
                <div>
                  <label class="block text-sm font-medium text-text-primary mb-1.5">URL</label>
                  <input
                    v-model="mcpClientForm.url"
                    type="url"
                    placeholder="https://example.com/mcp"
                    class="w-full bg-fg/[0.05] border border-fg/[0.1] rounded-lg px-3 py-2.5 text-sm text-text-primary font-mono placeholder:text-text-muted outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all"
                    :disabled="bSavingMcpClients"
                  />
                </div>
                <div>
                  <label class="block text-sm font-medium text-text-primary mb-1.5">
                    Headers
                    <span class="text-text-muted font-normal">(Key: Value, one per line)</span>
                  </label>
                  <textarea
                    v-model="mcpClientForm.headers"
                    rows="2"
                    placeholder="Authorization: Bearer …"
                    class="w-full bg-fg/[0.05] border border-fg/[0.1] rounded-lg px-3 py-2.5 text-sm text-text-primary font-mono placeholder:text-text-muted outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all resize-y"
                    :disabled="bSavingMcpClients"
                  ></textarea>
                </div>
              </template>
              <p v-if="mcpClientFormError" class="text-xs text-destructive">
                {{ mcpClientFormError }}
              </p>
            </div>
            <div class="flex flex-shrink-0 gap-2 border-t border-border bg-surface p-4 pt-3">
              <button
                class="flex-1 bg-primary hover:bg-primary-hover disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg transition-all"
                :disabled="!mcpClientForm.name.trim() || bSavingMcpClients"
                @click="saveMcpClient"
              >
                {{ bSavingMcpClients ? 'Saving…' : 'Save' }}
              </button>
            </div>
    </BaseModal>
</template>
