// classes
import { config } from '../config';
import { AcpSubprocessAdapter } from './acpSubprocessAdapter';

/** `codex-acp acp`; models from `codex models`. */
export const codexAdapter = new AcpSubprocessAdapter({
  type: 'codex',
  logTag: 'codexAcp',
  command: () => config.codexAcpCommand,
  args: ['acp'],
  modelsCommand: () => ({ command: config.codexCommand, args: ['models'] }),
});
