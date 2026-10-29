/**
 * Address the stack listens on and the browser uses to reach it. Set to this machine's
 * IP when the browser runs elsewhere (PW_TEST_CONNECT_WS_ENDPOINT, e.g. a browserless container).
 */
export const E2E_HOST = process.env['E2E_HOST'] || '127.0.0.1';

/** Ports for the throwaway e2e stack; override when they clash with something already running. */
export const E2E_API_PORT = Number(process.env['E2E_API_PORT'] || 21100);
export const E2E_DASHBOARD_PORT = Number(process.env['E2E_DASHBOARD_PORT'] || 21101);

/** Project folder created inside the temp workspace browse root. */
export const E2E_WORKSPACE_DIR = 'e2e-project';
