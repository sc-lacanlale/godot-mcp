import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const expectedTools = [
  'manage_project',
  'manage_project_config',
  'manage_asset',
  'manage_script',
  'manage_scene',
  'manage_node',
  'manage_physics',
  'manage_animation',
  'manage_ui',
  'manage_audio',
  'manage_signal',
  'manage_game_bridge',
  'game_scene',
  'game_input',
  'game_state',
  'game_wait',
  'godot_docs',
  'execute_editor_script',
  'visualize_project',
  'capture_vision',
  'inspect_project',
  'debug_project',
  'validate_scene',
  'run_and_verify',
  'get_project_diagnostics',
  'search_project',
  'semantic_search',
  'get_project_assets',
  'get_project_context',
];

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['server/dist/index.js'],
  stderr: 'inherit',
  env: {
    ...process.env,
    READ_ONLY_MODE: '',
  },
});

const client = new Client({ name: 'godot-mcp-smoke', version: '0.0.0' });

try {
  await client.connect(transport);
  const listed = await client.listTools();
  const names = listed.tools.map((tool) => tool.name).sort();
  process.stderr.write(
    `tools (${names.length}):\n${names.map((name) => `- ${name}`).join('\n')}\n`,
  );

  const missing = expectedTools.filter((name) => !names.includes(name));
  if (missing.length > 0 || names.length !== expectedTools.length) {
    process.stderr.write(`missing: ${missing.join(', ') || '(none)'}\n`);
    process.exitCode = 1;
  }
} finally {
  await client.close();
}
