// node_modules
import { Type, type Static } from '@sinclair/typebox';

export const FileEntrySchema = Type.Object({
  name: Type.String(),
  path: Type.String(),
  isDirectory: Type.Boolean()
});
export type FileEntry = Static<typeof FileEntrySchema>;

export const FileListResponseSchema = Type.Object({
  path: Type.String(),
  entries: Type.Array(FileEntrySchema)
});
export type FileListResponse = Static<typeof FileListResponseSchema>;

export const FileReadResponseSchema = Type.Object({
  content: Type.String(),
  path: Type.String(),
  encoding: Type.Union([Type.Literal('utf8'), Type.Literal('base64')])
});
export type FileReadResponse = Static<typeof FileReadResponseSchema>;

/** Write / mkdir / rename / delete all answer with the affected workspace-relative path. */
export const FilePathResponseSchema = Type.Object({ path: Type.String() });
export type FilePathResponse = Static<typeof FilePathResponseSchema>;
