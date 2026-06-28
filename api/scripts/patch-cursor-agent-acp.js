const fs = require('fs');

const managerPath = '/usr/local/lib/node_modules/@blowmage/cursor-agent-acp/dist/session/manager.js';
let source = fs.readFileSync(managerPath, 'utf8');

const replacements = [
  {
    from: "return session?.state.currentModel || 'auto';",
    to: "return session?.metadata?.model || session?.state.currentModel || 'auto';",
  },
  {
    from: "session.metadata = { ...session.metadata, ...updates };\n            const now = new Date();",
    to: "session.metadata = { ...session.metadata, ...updates };\n            if (typeof updates.model === 'string') {\n                session.state.currentModel = updates.model;\n            }\n            const now = new Date();",
  },
];

for (const { from, to } of replacements) {
  if (!source.includes(from)) {
    throw new Error(`Expected cursor-agent-acp patch target not found: ${from}`);
  }
  source = source.replace(from, to);
}

fs.writeFileSync(managerPath, source);
