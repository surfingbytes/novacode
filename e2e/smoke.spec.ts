// node_modules
import { expect, test, type Page } from '@playwright/test';

// e2e
import { E2E_WORKSPACE_DIR } from './constants';

const USERNAME = 'e2e-admin';
const PASSWORD = 'e2e-password-123';
const WORKSPACE_NAME = 'E2E Workspace';
const SESSION_NAME = 'E2E smoke session';

// Later tests reuse the account and session the first one creates
test.describe.configure({ mode: 'serial' });
let sessionPath = '';

/** Agents count as available only once authenticated; pretend Claude is so a default agent can be picked. */
async function mockAgentCapabilities(page: Page): Promise<void> {
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
}

async function signIn(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByPlaceholder('Enter your username').fill(USERNAME);
  await page.getByPlaceholder('••••••••').fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/$/);
}

// Stops at session creation: no prompt is sent, so no agent CLI or credentials are needed.
test('first-run setup, create workspace and session', async ({ page }) => {
  await mockAgentCapabilities(page);

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
  sessionPath = new URL(page.url()).pathname;
  // The sessions socket opened before sign-in is kept after setup and gets no session-upsert
  // events, so the sidebar only lists the new session after a reload.
  // TODO: drop the reload once the store reconnects the socket on sign-in.
  await page.reload();
  await expect(page.getByTestId('workspace-sidebar-sessions').getByText(SESSION_NAME)).toBeVisible();
});

test('shows the last known sessions while a slow session list loads', async ({ page }) => {
  await mockAgentCapabilities(page);
  await signIn(page);
  await page.goto(sessionPath);
  await expect(page.getByTestId('workspace-sidebar-sessions').getByText(SESSION_NAME)).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('nova:listCache:sessions') ?? ''))
    .toContain(SESSION_NAME);

  // Slow network: the list request hangs and the sessions socket never delivers its snapshot
  await page.route('**/api/sessions', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 15_000));
    await route.continue().catch(() => undefined);
  });
  await page.routeWebSocket(/\/ws\/sessions$/, () => undefined);
  await page.reload();

  await expect(page.getByTestId('workspace-sidebar-sessions').getByText(SESSION_NAME)).toBeVisible({ timeout: 5_000 });
});

test('keeps a prompt sent while disconnected and sends it once the chat reconnects', async ({ page }) => {
  await mockAgentCapabilities(page);
  let bOnline = false;
  const sentPrompts: string[] = [];
  // Stand-in chat server: refuses connections while "offline", records prompts once back
  await page.routeWebSocket(/\/ws\/chat\//, (ws) => {
    if (!bOnline) {
      void ws.close({ code: 1011 });
      return;
    }
    ws.send(JSON.stringify({ type: 'history', messages: [], hasMore: false, queue: [] }));
    ws.onMessage((raw) => {
      const message = JSON.parse(String(raw)) as { type: string; text?: string };
      if (message.type === 'prompt' && message.text) sentPrompts.push(message.text);
    });
  });
  await signIn(page);
  await page.goto(sessionPath);

  await page.getByRole('textbox', { name: 'Message' }).fill('sent while offline');
  await page.getByRole('button', { name: 'Send when reconnected' }).click();
  await expect(page.getByText('Waiting for connection (1)')).toBeVisible();

  bOnline = true;
  // The managed socket retries with backoff (up to ~8s by now)
  await expect.poll(() => sentPrompts, { timeout: 30_000 }).toEqual(['sent while offline']);
  await expect(page.getByText('Waiting for connection')).toBeHidden();
});
