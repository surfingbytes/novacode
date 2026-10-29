// classes
import { config } from '../config';
import { getOpenCodeModels } from '../openCodeModels';
import { buildOpenCodePlanModeInstruction } from '../planDocumentSources';
import { AcpSubprocessAdapter, type AcpSubprocessQuirks } from './acpSubprocessAdapter';
import { toModelOption } from './modelOptions';

// types
import type { AgentModelOption, AgentModelsResult, AgentRunParams } from './types';

class OpenCodeAdapter extends AcpSubprocessAdapter {
  protected override quirks(params: AgentRunParams): AcpSubprocessQuirks {
    return {
      // OpenCode's built-in plan-file workflow is TUI-only; over ACP the plan
      // agent needs explicit instructions (embedding the ACP session id) so the
      // plan lands in `.opencode/plans` / XDG where getPlanDocumentsSource looks.
      transformPrompt:
        params.mode === 'plan'
          ? (promptText, acpSessionId) =>
              `${promptText}\n\n${buildOpenCodePlanModeInstruction(acpSessionId)}`
          : undefined,
    };
  }

  override async probeModels(): Promise<AgentModelsResult> {
    return { models: (await getOpenCodeModels()).models };
  }

  protected override async fallbackModels(): Promise<AgentModelOption[]> {
    return (await getOpenCodeModels()).models.map((m) => toModelOption({ id: m.id, label: m.label }));
  }
}

/** `opencode acp`; models from the OpenCode provider list. */
export const openCodeAdapter = new OpenCodeAdapter({
  type: 'open-code',
  logTag: 'openCodeAcp',
  command: () => config.openCodeAcpCommand,
  args: ['acp'],
});
