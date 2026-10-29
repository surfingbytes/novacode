/**
 * Model selection: cursor-agent's ACP ignores runtime model changes made via
 * `session/set_config_option` for actual inference (confirmed cursor bug — metadata updates but the
 * backend keeps serving the model the process started with). A fresh `cursor-agent` process is
 * spawned per prompt turn, so we pin the selected model with the `--model <id>` startup flag, which
 * is the only reliable mechanism, and skip the ineffective config-option write.
 */

// classes
import { config } from '../config';
import { getCursorModels } from '../cursorModels';
import { getParameterizedCursorModels } from '../cursorParameterizedModels';
import { cursorSubagentTranscriptsDir } from '../cursorSubagentTranscripts';
import { AcpSubprocessAdapter, type AcpSubprocessQuirks } from './acpSubprocessAdapter';
import { toModelOption } from './modelOptions';

// types
import type { AgentModelsResult, AgentOptionsProbeResult, AgentRunParams } from './types';

class CursorAdapter extends AcpSubprocessAdapter {
  protected override readonly forwardsAskQuestion = true;

  protected override quirks(params: AgentRunParams): AcpSubprocessQuirks {
    // `cursor-agent --model <id> acp` — pin the model at startup (the reliable path, since Cursor
    // ignores runtime config-option model changes). `auto` is a real model id (its own router that
    // identifies as "auto"), so it must be passed explicitly too — only omit when nothing is selected.
    const model = params.model?.trim();
    return {
      args: model ? ['--model', model, 'acp'] : ['acp'],
      cursorExtensions: true,
      skipModelConfigOption: true,
      subagentTranscriptsDir: cursorSubagentTranscriptsDir(params.cwd),
    };
  }

  override async probeModels(): Promise<AgentModelsResult> {
    return { models: (await getCursorModels()).models };
  }

  /** Cursor's options come from the cached modes/config probes plus its parameterized model list. */
  override async probeOptions(): Promise<AgentOptionsProbeResult> {
    // Dynamic: agentModes/agentConfigOptions resolve adapters through the registry.
    const [{ getAgentModes }, { getAgentConfigOptions }] = await Promise.all([
      import('../agentModes.js'),
      import('../agentConfigOptions.js'),
    ]);
    const [modes, configOptions, parameterized] = await Promise.all([
      getAgentModes('cursor-agent'),
      getAgentConfigOptions('cursor-agent'),
      getParameterizedCursorModels(),
    ]);
    const rawModels =
      parameterized.models.length > 0 ? parameterized.models : (await getCursorModels()).models;
    return {
      models: rawModels.map((m) =>
        toModelOption({ id: m.id, label: m.label, ...(m.current ? { current: m.current } : {}) })
      ),
      modes: modes.modes,
      configOptions: configOptions.options,
      thinking: null,
      source: parameterized.models.length > 0 ? 'acp' : 'cli',
    };
  }
}

/** `cursor-agent acp`; models from `cursor-agent models`. */
export const cursorAdapter = new CursorAdapter({
  type: 'cursor-agent',
  logTag: 'cursorAcp',
  command: () => config.cursorCommand,
  args: ['acp'],
});
