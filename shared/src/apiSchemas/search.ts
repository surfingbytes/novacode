// node_modules
import { Type, type Static } from '@sinclair/typebox';

export const SearchResultSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  type: Type.Union([
    Type.Literal('workspace'),
    Type.Literal('session'),
    Type.Literal('orchestrator'),
    Type.Literal('role-template'),
    Type.Literal('automation')
  ]),
  workspaceId: Type.Optional(Type.String()),
  workspaceName: Type.Optional(Type.String()),
  updatedAt: Type.Optional(Type.String())
});
export type SearchResultItem = Static<typeof SearchResultSchema>;

export const SearchResponseSchema = Type.Object({
  workspaces: Type.Array(SearchResultSchema),
  sessions: Type.Array(SearchResultSchema),
  orchestrators: Type.Array(SearchResultSchema),
  roleTemplates: Type.Array(SearchResultSchema),
  automations: Type.Array(SearchResultSchema)
});
export type SearchResponse = Static<typeof SearchResponseSchema>;
