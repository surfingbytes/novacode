// node_modules
import { expect, test } from '@playwright/test';

// e2e
import { E2E_WORKSPACE_DIR } from './constants';

const USERNAME = 'e2e-admin';
const PASSWORD = 'e2e-password-123';
const WORKSPACE_NAME = 'E2E Workspace';
const SESSION_NAME = 'E2E smoke session';

// Stops at session creation: no prompt is sent, so no agent CLI or credentials are needed.
test('first-run setup, create workspace and session', async ({ page }) => {
  // agents count as available only once authenticated; pretend Claude is so a default agent can be picked
  await page.route('**/api/settings/agent-capabilities', (route) =>
    route.fulfill({
      json: {
        cursorAvailable: false,
        cursorStatus: 'unauthenticated',
        claudeAvailable: true,
        mistralVibeAvailable: false,
        openCodeAvailable: false,
        codexAvailable: false
      }
    })
  );

  // fresh database: the login page sends us to first-run setup
  await page.goto('/');
  await expect(page).toHaveURL(/\/setup$/);

  // step 1: account
  await page.getByPlaceholder('admin').fill(USERNAME);
  const passwords = page.locator('input[autocomplete="new-password"]');
  await passwords.nth(0).fill(PASSWORD);
  await passwords.nth(1).fill(PASSWORD);
  await page.getByRole('button', { name: 'Next Step' }).click();
  await expect(page.getByText('Account created')).toBeVisible();

  // step 2: agents (none connected), step 3: git identity (left empty), step 4: finish
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await page.getByRole('button', { name: 'Next Step' }).click();
  await page.getByRole('button', { name: 'Launch Nova Code' }).click();
  await expect(page).toHaveURL(/\/$/);

  // workspace pointing at the temp project dir (relative to the temp browse root)
  await page.getByRole('button', { name: 'Add workspace' }).click();
  await page.getByPlaceholder('e.g. My Projects').fill(WORKSPACE_NAME);
  await page.getByPlaceholder('my-project').fill(E2E_WORKSPACE_DIR);
  await page.getByRole('button', { name: 'Create Workspace' }).click();
  await expect(page.getByText('Workspace created')).toBeVisible();

  // session: named via Advanced so it can be found in the sidebar
  await page.getByRole('button', { name: 'New session', exact: true }).click();
  await page.getByRole('button', { name: 'Advanced' }).click();
  await page.getByLabel('Name', { exact: true }).fill(SESSION_NAME);
  await page.getByRole('button', { name: 'Create', exact: true }).click();

  await expect(page).toHaveURL(/\/workspace\/[^/]+\/session\/[^/]+$/);
  // The sessions socket opened before sign-in is kept after setup and gets no session-upsert
  // events, so the sidebar only lists the new session after a reload.
  // TODO: drop the reload once the store reconnects the socket on sign-in.
  await page.reload();
  await expect(page.getByTestId('workspace-sidebar-sessions').getByText(SESSION_NAME)).toBeVisible();
});
