// node_modules
import { Type, type Static } from '@sinclair/typebox';

const NullableString = Type.Union([Type.String(), Type.Null()]);

// ---------------------------------- Workspace ----------------------------------
export const WorkspaceSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  path: Type.String(),
  group: Type.Optional(NullableString),
  createdAt: Type.String(),
  gitUserName: Type.Optional(NullableString),
  gitUserEmail: Type.Optional(NullableString),
  color: Type.Optional(NullableString),
  sortOrder: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  defaultAgentType: Type.Optional(NullableString),
  tags: Type.Optional(Type.Union([Type.Array(Type.String()), Type.Null()])),
  archived: Type.Boolean(),
  isFavorite: Type.Boolean(),
  favoriteOrder: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  /** Forge connection id; null = pick by the git remote's host. */
  forgeConnectionId: Type.Optional(NullableString),
  /** Repo path on the forge; null = derive from the git remote. */
  forgeRepo: Type.Optional(NullableString)
});
export type WorkspaceResponse = Static<typeof WorkspaceSchema>;

export const WorkspaceListResponseSchema = Type.Array(WorkspaceSchema);
export type WorkspaceListResponse = Static<typeof WorkspaceListResponseSchema>;

export const CreateWorkspaceBodySchema = Type.Object({
  name: Type.String({ minLength: 1 }),
  path: Type.String({ minLength: 1 }),
  group: Type.Optional(NullableString),
  gitUserName: Type.Optional(NullableString),
  gitUserEmail: Type.Optional(NullableString),
  color: Type.Optional(NullableString),
  defaultAgentType: Type.Optional(NullableString),
  tags: Type.Optional(Type.Union([Type.Array(Type.String()), Type.Null()])),
  forgeConnectionId: Type.Optional(NullableString),
  forgeRepo: Type.Optional(NullableString)
});
export type CreateWorkspaceBody = Static<typeof CreateWorkspaceBodySchema>;

export const UpdateWorkspaceBodySchema = Type.Object({
  name: Type.Optional(Type.String({ minLength: 1 })),
  path: Type.Optional(Type.String({ minLength: 1 })),
  group: Type.Optional(NullableString),
  gitUserName: Type.Optional(NullableString),
  gitUserEmail: Type.Optional(NullableString),
  color: Type.Optional(NullableString),
  defaultAgentType: Type.Optional(NullableString),
  tags: Type.Optional(Type.Union([Type.Array(Type.String()), Type.Null()])),
  isFavorite: Type.Optional(Type.Boolean()),
  forgeConnectionId: Type.Optional(NullableString),
  forgeRepo: Type.Optional(NullableString)
});
export type UpdateWorkspaceBody = Static<typeof UpdateWorkspaceBodySchema>;

export const WorkspaceUsageSummarySchema = Type.Object({
  turnCount: Type.Number(),
  used: Type.Number(),
  size: Type.Number(),
  costAmount: Type.Union([Type.Number(), Type.Null()]),
  costCurrency: Type.Union([Type.String(), Type.Null()])
});
export type WorkspaceUsageSummary = Static<typeof WorkspaceUsageSummarySchema>;

// ---------------------------------- Folder browser ----------------------------------
export const BrowseEntrySchema = Type.Object({
  name: Type.String(),
  path: Type.String(),
  isDirectory: Type.Boolean()
});
export type BrowseEntry = Static<typeof BrowseEntrySchema>;

export const WorkspaceBrowseResponseSchema = Type.Object({
  path: Type.String(),
  root: Type.String(),
  entries: Type.Array(BrowseEntrySchema)
});
export type WorkspaceBrowseResponse = Static<typeof WorkspaceBrowseResponseSchema>;

export const WorkspaceMkdirResponseSchema = Type.Object({ path: Type.String() });
export type WorkspaceMkdirResponse = Static<typeof WorkspaceMkdirResponseSchema>;
