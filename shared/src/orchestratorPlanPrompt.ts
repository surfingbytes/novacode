/**
 * Chat → orchestrator: the planning agent writes the spec and the steps itself
 * through Nova's built-in MCP server ("nova"); the user then runs the plan.
 */

/** MCP server name agents see the Nova tools under. */
export const NOVA_MCP_SERVER_NAME = 'nova';

/** Message the "Plan as orchestrator" button sends into the chat. */
export function buildPlanAsOrchestratorPrompt(bHasPlan: boolean): string {
  const target = bHasPlan
    ? 'Update the orchestrator plan of this chat to match what we agreed on (check it with `orchestrator_get` first).'
    : 'Turn the work we agreed on in this chat into an orchestrator plan.';
  return `${target} Use the tools of the "${NOVA_MCP_SERVER_NAME}" MCP server:

1. \`spec_write\` — the complete spec. Only the final verify step gets it, and no step sees this chat, so include the goal and scope, every decision we agreed on (with reasons where it matters), constraints, file paths, names and exact values, rejected alternatives, open questions and acceptance criteria. Re-read the whole conversation first and keep specifics.
2. \`orchestrator_save_plan\` — the steps. Each step runs in a fresh agent session that receives only its own prompt, the plan notes and handoff notes from the steps in its \`dependsOn\` — NOT the spec. So a step prompt must be self-contained: its task, the decisions affecting it, the files it touches and exact contracts with other steps (copied word for word into both steps). Use \`dependsOn\` when a step needs another step's result; steps that don't depend on each other may run in parallel (each in its own git worktree, merged afterwards), so they should not edit the same files. Don't add a final review step — Nova adds "Verify against spec" automatically.

Don't start implementing and don't run the plan; I start it from the Orchestrator tab.`;
}
