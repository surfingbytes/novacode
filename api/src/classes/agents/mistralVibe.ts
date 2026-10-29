// classes
import { config } from '../config';
import { AcpSubprocessAdapter, type AcpSubprocessQuirks } from './acpSubprocessAdapter';

// types
import type { AgentRunParams } from './types';

class MistralVibeAdapter extends AcpSubprocessAdapter {
  protected override quirks(_params: AgentRunParams): AcpSubprocessQuirks {
    return {
      // Vibe has no model/config selection over ACP; never send them.
      model: undefined,
      configJson: undefined,
      // Vibe accepts additional_directories on new/load but does not advertise it.
      additionalDirectoriesUnadvertised: true,
    };
  }
}

/** `vibe-acp` (no args); models from `vibe models`. */
export const mistralVibeAdapter = new MistralVibeAdapter({
  type: 'mistral-vibe',
  logTag: 'vibeAcp',
  command: () => config.vibeAcpCommand,
  args: [],
  modelsCommand: () => ({ command: config.vibeCommand, args: ['models'] }),
});
