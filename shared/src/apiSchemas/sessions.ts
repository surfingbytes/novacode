// node_modules
import { Kind, Type, TypeRegistry, type Static } from '@sinclair/typebox';

// types
import type { AgentType, LinkedPlanContext } from '../types.js';

// `type: [..., 'null']` instead of Type.Union: AJV coerces inside anyOf branches,
// which would turn null into '' (or a tag string into a one-element array).
// The custom kinds are registered so TypeBox `Value.Check` understands them too.
if (!TypeRegistry.Has('NullableString')) {
  TypeRegistry.Set('NullableString', (_schema, value) => value === null || typeof value === 'string');
}
if (!TypeRegistry.Has('NullableObject')) {
  TypeRegistry.Set(
    'NullableObject',
    (_schema, value) => value === null || (typeof value === 'object' && !Array.isArray(value))
  );
}

const NullableString = Type.Unsafe<string | null>({ [Kind]: 'NullableString', type: ['string', 'null'] });

/** Tags arrive as a string list, a comma-separated string or null. */
const TagsSchema = Type.Union([NullableString, Type.Array(Type.String())]);

// ---------------------------------- Request bodies ----------------------------------
export const CreateSessionBodySchema = Type.Object({
  name: Type.Optional(Type.String()),
  tags: Type.Optional(TagsSchema),
  agentType: Type.Optional(Type.Unsafe<AgentType>(Type.String())),
  modelSelection: Type.Optional(NullableString),
  linkedPlanContext: Type.Optional(
    Type.Unsafe<LinkedPlanContext | null>({ [Kind]: 'NullableObject', type: ['object', 'null'] })
  ),
  sessionMode: Type.Optional(NullableString),
  approvalPolicy: Type.Optional(NullableString)
});
export type CreateSessionBody = Static<typeof CreateSessionBodySchema>;

export const UpdateSessionBodySchema = Type.Object({
  name: Type.Optional(Type.String()),
  tags: Type.Optional(TagsSchema),
  archived: Type.Optional(Type.Boolean()),
  isFavorite: Type.Optional(Type.Boolean()),
  modelSelection: Type.Optional(Type.String()),
  sessionMode: Type.Optional(Type.String()),
  approvalPolicy: Type.Optional(Type.String()),
  sessionConfigJson: Type.Optional(Type.Union([Type.Null(), Type.Record(Type.String(), Type.String())]))
});
export type UpdateSessionBody = Static<typeof UpdateSessionBodySchema>;

export const PlanUpdateBodySchema = Type.Object({
  title: Type.Optional(Type.String()),
  markdown: Type.Optional(Type.String()),
  entries: Type.Optional(
    Type.Array(
      Type.Object({
        content: Type.String(),
        status: Type.String(),
        priority: Type.Optional(Type.String())
      })
    )
  ),
  planId: Type.Optional(Type.String())
});
export type PlanUpdateBody = Static<typeof PlanUpdateBodySchema>;

export const SessionBulkIdsBodySchema = Type.Object({ ids: Type.Array(Type.String()) });
export type SessionBulkIdsBody = Static<typeof SessionBulkIdsBodySchema>;

export const SessionBulkArchiveBodySchema = Type.Object({
  ids: Type.Array(Type.String()),
  archived: Type.Boolean()
});
export type SessionBulkArchiveBody = Static<typeof SessionBulkArchiveBodySchema>;

// ---------------------------------- Responses ----------------------------------
export const PlanUpdateResponseSchema = Type.Object({ ok: Type.Boolean() });
export type PlanUpdateResponse = Static<typeof PlanUpdateResponseSchema>;

export const SessionBulkDeleteResponseSchema = Type.Object({ deleted: Type.Number() });
export type SessionBulkDeleteResponse = Static<typeof SessionBulkDeleteResponseSchema>;

export const SessionBulkArchiveResponseSchema = Type.Object({ updated: Type.Number() });
export type SessionBulkArchiveResponse = Static<typeof SessionBulkArchiveResponseSchema>;
