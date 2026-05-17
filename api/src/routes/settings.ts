// node_modules
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';

// classes
import { jwtPreHandler } from '../classes/auth';
import { db } from '../classes/database';
import {
  clearVibeApiKey,
  config,
  getVibeApiKeyStatus,
  setVibeApiKey,
  writeGlobalGitConfig,
  isClaudeAvailable,
  isVibeCliAvailable,
  isCodexAcpAvailable,
  readMcpClients,
  writeMcpClients
} from '../classes/config';
import { checkMcpClients } from '../classes/mcpConnectivityCheck';
import { getCursorModels } from '../classes/cursorModels';
import { getOpenCodeModels, clearOpenCodeModelsCache } from '../classes/openCodeModels';
import { readSshKeyMaterial } from '../classes/sshKey';
import { cursorAuthenticated, openCodeAuthenticated, codexAuthenticated } from './agentAuth';

// types
import type { FastifyInstance } from 'fastify';
import type { McpClientServerConfig } from '../classes/config';

type AppSettingsUser = {
  gitUserName: string | null;
  gitUserEmail: string | null;
  theme: string | null;
  autoTheme: boolean | null;
  darkTheme: string | null;
  lightTheme: string | null;
  modelSelection: string | null;
};

/** Legacy dashboard theme id `rust` was replaced by OLED. */
function normalizeThemeId(theme: string): string {
  return theme === 'rust' ? 'oled' : theme;
}

type AppSettings = {
  gitUserName: string | null;
  gitUserEmail: string | null;
  theme: string;
  autoTheme: boolean;
  darkTheme: string;
  lightTheme: string;
  modelSelection: string;
  sshPublicKey: string;
  sshPrivateKey: string;
};

const AppSettingsSchema = Type.Object({
  gitUserName: Type.Union([Type.String(), Type.Null()]),
  gitUserEmail: Type.Union([Type.String(), Type.Null()]),
  theme: Type.String(),
  autoTheme: Type.Boolean(),
  darkTheme: Type.String(),
  lightTheme: Type.String(),
  modelSelection: Type.String(),
  /** SSH public key (e.g. register on GitHub/GitLab) — persisted under config volume `.ssh/` */
  sshPublicKey: Type.String(),
  /** Private key for the same pair — treat as a secret */
  sshPrivateKey: Type.String()
});

export async function settingsRoutes(fastify: FastifyInstance): Promise<void> {
  // -------------------------------------------------- Data --------------------------------------------------
  const fastifyInstance = fastify.withTypeProvider<TypeBoxTypeProvider>();

  // -------------------------------------------------- Methods --------------------------------------------------
  const appSettingsFromUser = (user: AppSettingsUser | null): AppSettings => {
    const ssh = readSshKeyMaterial(config.configDir);
    return {
      gitUserName: user?.gitUserName ?? null,
      gitUserEmail: user?.gitUserEmail ?? null,
      theme: normalizeThemeId(user?.theme ?? 'infrared'),
      autoTheme: user?.autoTheme ?? false,
      darkTheme: normalizeThemeId(user?.darkTheme ?? 'deep-space'),
      lightTheme: normalizeThemeId(user?.lightTheme ?? 'cloud'),
      modelSelection: user?.modelSelection ?? 'auto',
      sshPublicKey: ssh.sshPublicKey,
      sshPrivateKey: ssh.sshPrivateKey
    };
  };

  // -------------------------------------------------- Routes --------------------------------------------------
  // GET /api/settings - get user settings
  fastifyInstance.get(
    '/api/settings',
    {
      preHandler: jwtPreHandler,
      schema: { response: { 200: AppSettingsSchema } }
    },
    async (request) => {
      // jwtPreHandler should ensure jwtUser exists, but be defensive
      const user =
        (await db.getUserById(request.jwtUser!.id)) ??
        (await db.getUserByUsername(request.jwtUser!.username));
      return appSettingsFromUser(user);
    }
  );

  // PUT /api/settings - update user settings
  fastifyInstance.put(
    '/api/settings',
    {
      preHandler: jwtPreHandler,
      schema: {
        body: Type.Object({
          gitUserName: Type.Optional(Type.Union([Type.String(), Type.Null()])),
          gitUserEmail: Type.Optional(Type.Union([Type.String(), Type.Null()])),
          theme: Type.Optional(Type.String()),
          autoTheme: Type.Optional(Type.Boolean()),
          darkTheme: Type.Optional(Type.String()),
          lightTheme: Type.Optional(Type.String()),
          modelSelection: Type.Optional(Type.String())
        }),
        response: { 200: AppSettingsSchema }
      }
    },
    async (request) => {
      const body = request.body;
      const existing =
        (await db.getUserById(request.jwtUser!.id)) ??
        (await db.getUserByUsername(request.jwtUser!.username));
      if (!existing) {
        throw new Error('User not found');
      }

      const gitUserName = body.gitUserName !== undefined ? body.gitUserName : existing.gitUserName ?? null;
      const gitUserEmail = body.gitUserEmail !== undefined ? body.gitUserEmail : existing.gitUserEmail ?? null;
      const theme = normalizeThemeId(
        body.theme !== undefined ? body.theme : existing.theme ?? 'infrared'
      );
      const autoTheme = body.autoTheme !== undefined ? body.autoTheme : existing.autoTheme ?? false;
      const darkTheme = normalizeThemeId(
        body.darkTheme !== undefined ? body.darkTheme : existing.darkTheme ?? 'deep-space'
      );
      const lightTheme = normalizeThemeId(
        body.lightTheme !== undefined ? body.lightTheme : existing.lightTheme ?? 'cloud'
      );
      const modelSelection = body.modelSelection !== undefined ? body.modelSelection : existing.modelSelection ?? 'auto';

      if (body.gitUserName !== undefined || body.gitUserEmail !== undefined) {
        writeGlobalGitConfig(config.configDir, gitUserName, gitUserEmail);
      }

      const user = await db.updateUser(existing.id, {
        gitUserName,
        gitUserEmail,
        theme,
        autoTheme,
        darkTheme,
        lightTheme,
        modelSelection
      });
      if (!user) {
        throw new Error('Failed to update user');
      }

      return appSettingsFromUser(user);
    }
  );

  // GET /api/settings/cursor-models - list available cursor models
  const CursorModelOptionSchema = Type.Object({
    id: Type.String(),
    label: Type.String()
  });

  fastifyInstance.get(
    '/api/settings/cursor-models',
    {
      preHandler: jwtPreHandler,
      schema: {
        response: {
          200: Type.Object({
            models: Type.Array(CursorModelOptionSchema),
            fromCache: Type.Boolean()
          })
        }
      }
    },
    async () => {
      return getCursorModels();
    }
  );

  // GET /api/settings/opencode-models - list available opencode models
  fastifyInstance.get(
    '/api/settings/opencode-models',
    {
      preHandler: jwtPreHandler,
      schema: {
        response: {
          200: Type.Object({
            models: Type.Array(Type.Object({ id: Type.String(), label: Type.String() })),
            fromCache: Type.Boolean(),
          }),
        },
      },
    },
    async (request) => {
      if ((request.query as Record<string, string>)['bust']) clearOpenCodeModelsCache();
      return getOpenCodeModels();
    }
  );

  // GET /api/settings/vibe-api-key - get vibe API key status
  fastifyInstance.get(
    '/api/settings/vibe-api-key',
    {
      preHandler: jwtPreHandler,
      schema: {
        response: {
          200: Type.Object({ configured: Type.Boolean() })
        }
      }
    },
    async () => {
      return getVibeApiKeyStatus(config.configDir);
    }
  );

  // PUT /api/settings/vibe-api-key - set vibe API key
  fastifyInstance.put(
    '/api/settings/vibe-api-key',
    {
      preHandler: jwtPreHandler,
      schema: {
        body: Type.Object({ apiKey: Type.String() }),
        response: {
          200: Type.Object({ configured: Type.Boolean() })
        }
      }
    },
    async (request) => {
      const { apiKey } = request.body as { apiKey: string };
      setVibeApiKey(config.configDir, apiKey);
      return { configured: true };
    }
  );

  // DELETE /api/settings/vibe-api-key - clear vibe API key
  fastifyInstance.delete(
    '/api/settings/vibe-api-key',
    {
      preHandler: jwtPreHandler,
      schema: {
        response: {
          200: Type.Object({ configured: Type.Boolean() })
        }
      }
    },
    async () => {
      clearVibeApiKey(config.configDir);
      return { configured: false };
    }
  );

  // GET /api/settings/agent-capabilities - get current agent availability
  fastifyInstance.get(
    '/api/settings/agent-capabilities',
    {
      preHandler: jwtPreHandler,
      schema: {
        response: {
          200: Type.Object({
            cursorAvailable: Type.Boolean(),
            claudeAvailable: Type.Boolean(),
            mistralVibeAvailable: Type.Boolean(),
            openCodeAvailable: Type.Boolean(),
            codexAvailable: Type.Boolean()
          })
        }
      }
    },
    async (request) => {
      const user = await db.getUserById(request.jwtUser!.id);
      // Claude is available via ACP when a token is stored; the ACP package is always present
      const claudeAvailable = isClaudeAvailable(config.configDir) && !!user?.claudeToken;
      // Cursor and Mistral UI remains but underlying backend is not yet implemented via ACP
      const cursorAvailable = cursorAuthenticated();
      const vibeKeyOk = getVibeApiKeyStatus(config.configDir).configured;
      const vibeCliOk = isVibeCliAvailable(config.configDir);
      const openCodeAvailable = openCodeAuthenticated();
      const codexAvailable = isCodexAcpAvailable(config.configDir);
      return {
        cursorAvailable,
        claudeAvailable,
        mistralVibeAvailable: vibeCliOk && vibeKeyOk,
        openCodeAvailable,
        codexAvailable
      };
    }
  );

  // GET /api/settings/mcp-clients - list MCP client servers
  const McpClientServerSchema = Type.Object({
    type: Type.Optional(Type.String()),
    command: Type.Optional(Type.String()),
    args: Type.Optional(Type.Array(Type.String())),
    env: Type.Optional(Type.Record(Type.String(), Type.String())),
    url: Type.Optional(Type.String()),
    headers: Type.Optional(Type.Record(Type.String(), Type.String()))
  });

  const McpClientsResponseSchema = Type.Object({
    servers: Type.Record(Type.String(), McpClientServerSchema)
  });

  fastifyInstance.get(
    '/api/settings/mcp-clients',
    {
      preHandler: jwtPreHandler,
      schema: { response: { 200: McpClientsResponseSchema } }
    },
    async () => {
      const servers = readMcpClients(config.configDir);
      return { servers };
    }
  );

  // PUT /api/settings/mcp-clients - replace MCP client servers
  fastifyInstance.put(
    '/api/settings/mcp-clients',
    {
      preHandler: jwtPreHandler,
      schema: {
        body: Type.Object({
          servers: Type.Record(Type.String(), McpClientServerSchema)
        }),
        response: { 200: McpClientsResponseSchema }
      }
    },
    async (request) => {
      const { servers } = request.body as { servers: Record<string, McpClientServerConfig> };
      writeMcpClients(config.configDir, servers);
      return { servers };
    }
  );

  const McpCheckResultSchema = Type.Object({
    ok: Type.Boolean(),
    kind: Type.Union([Type.Literal('stdio'), Type.Literal('http')]),
    error: Type.Optional(Type.String()),
    detail: Type.Optional(Type.String())
  });

  // POST /api/settings/mcp-clients/check - run MCP connectivity checks
  fastifyInstance.post(
    '/api/settings/mcp-clients/check',
    {
      preHandler: jwtPreHandler,
      schema: {
        body: Type.Object({
          servers: Type.Optional(Type.Record(Type.String(), McpClientServerSchema))
        }),
        response: {
          200: Type.Object({
            results: Type.Record(Type.String(), McpCheckResultSchema)
          })
        }
      }
    },
    async (request) => {
      const body = request.body as { servers?: Record<string, McpClientServerConfig> };
      const results = await checkMcpClients(config.configDir, body.servers);
      return { results };
    }
  );
}
