// classes
import { healthDb } from './db/client';
import { userDb } from './db/users';
import { workspaceDb } from './db/workspaces';
import { sessionDb } from './db/sessions';
import { orchestratorDb } from './db/orchestrators';
import { pushDb } from './db/push';
import { roleTemplateDb } from './db/roleTemplates';
import { automationDb } from './db/automations';
import { searchDb } from './db/search';

export { FavoriteLimitError, normalizeTagStringList } from './db/shared';

// --------------------------------------------- Facade ---------------------------------------------

type Db = typeof healthDb &
  typeof userDb &
  typeof workspaceDb &
  typeof sessionDb &
  typeof orchestratorDb &
  typeof pushDb &
  typeof roleTemplateDb &
  typeof automationDb &
  typeof searchDb;

export const db: Db = {
  ...healthDb,
  ...userDb,
  ...workspaceDb,
  ...sessionDb,
  ...orchestratorDb,
  ...pushDb,
  ...roleTemplateDb,
  ...automationDb,
  ...searchDb
};
