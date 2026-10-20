/**
 * Editor integration test.
 *
 * Creates a throwaway Godot project, installs the addon, starts the editor,
 * and calls the MCP tools over stdio. Exits 0 when Godot is not installed so
 * `npm test` and machines without Godot stay green. Set GODOT_PATH to force
 * a binary. GODOT_E2E_HEADLESS=1 starts the editor with --headless.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const project = process.env.E2E_PROJECT || join(homedir(), 'godot-mcp-e2e');
const headless = process.env.GODOT_E2E_HEADLESS === '1' || !process.env.DISPLAY;
const full = process.env.E2E_FULL === '1';

function findGodot() {
  if (process.env.GODOT_PATH && existsSync(process.env.GODOT_PATH)) return process.env.GODOT_PATH;
  try {
    const found = execFileSync('which', ['godot'], { encoding: 'utf8' }).trim();
    if (found && existsSync(found)) return found;
  } catch {
    /* not on PATH */
  }
  return '';
}

const godot = findGodot();
if (!godot) {
  console.log('SKIPPED: Godot not found. Set GODOT_PATH to run the editor integration test.');
  process.exit(0);
}

if (!project.includes('godot-mcp-e2e')) {
  console.error(
    'E2E_PROJECT must contain "godot-mcp-e2e" so the script cannot delete an unrelated directory.',
  );
  process.exit(2);
}
if (project.startsWith(tmpdir())) {
  console.error(
    'E2E_PROJECT cannot be under the system temp directory; tool path checks reject it.',
  );
  process.exit(2);
}

const versionText = execFileSync(godot, ['--version'], { encoding: 'utf8' }).trim();
const feature = versionText.match(/^(\d+\.\d+)/)?.[1] ?? '4.3';
console.log(`Godot ${versionText}`);
console.log(`Project ${project}`);
console.log(
  headless ? 'Editor mode: headless' : `Editor mode: windowed DISPLAY=${process.env.DISPLAY}`,
);

rmSync(project, { recursive: true, force: true });
mkdirSync(project, { recursive: true });
const icon = join(repoRoot, 'icon.svg');
if (existsSync(icon)) writeFileSync(join(project, 'icon.svg'), readFileSync(icon));

writeFileSync(
  join(project, 'project.godot'),
  `; Engine configuration file.
config_version=5

[application]

config/name="E2E Demo"
config/features=PackedStringArray("${feature}", "GL Compatibility")

[editor_plugins]

enabled=PackedStringArray("res://addons/godot_mcp/plugin.cfg")

[rendering]

renderer/rendering_method="gl_compatibility"
`,
);

execFileSync(process.execPath, [join(repoRoot, 'server/dist/index.js'), 'install'], {
  cwd: project,
  stdio: 'inherit',
});

if (!existsSync(join(project, 'addons/godot_mcp/plugin.cfg'))) {
  console.error('install did not copy the addon');
  process.exit(1);
}

const editorArgs = ['--audio-driver', 'Dummy', '--path', project, '--editor'];
if (headless) editorArgs.unshift('--headless');
else if (process.platform === 'linux') editorArgs.unshift('--display-driver', 'x11');

const editorLog = [];
const editor = spawn(godot, editorArgs, { cwd: project });
editor.stdout.on('data', (chunk) => {
  const text = chunk.toString();
  editorLog.push(text);
  process.stderr.write(text);
});
editor.stderr.on('data', (chunk) => {
  const text = chunk.toString();
  editorLog.push(text);
  process.stderr.write(text);
});

const failures = [];
let client;

function textOf(result) {
  return (result?.content ?? [])
    .map((part) => (part.type === 'text' ? part.text : JSON.stringify(part)))
    .join('\n');
}

async function call(name, args, judge, timeout = 30000) {
  const started = Date.now();
  let text = '';
  let isError = false;
  try {
    const result = await client.callTool({ name, arguments: args }, undefined, { timeout });
    text = textOf(result);
    isError = result.isError === true;
  } catch (error) {
    isError = true;
    text = error instanceof Error ? error.message : String(error);
  }
  let note = '';
  let pass = !isError;
  try {
    const judged = judge(text, isError);
    if (judged === true) pass = true;
    else {
      pass = false;
      note = typeof judged === 'string' ? judged : 'expectation failed';
    }
  } catch (error) {
    pass = false;
    note = error instanceof Error ? error.message : String(error);
  }
  const line = `${pass ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(args.action ?? '')} (${Date.now() - started}ms)${note ? ` ${note}` : ''}`;
  console.log(line);
  if (!pass) {
    console.log(text.slice(0, 800));
    failures.push({ name, args, note, text: text.slice(0, 1500) });
  }
  return text;
}

function ok(fragment) {
  return (text, isError) => {
    if (isError) return text.slice(0, 400);
    if (fragment && !text.includes(fragment)) return `missing "${fragment}"`;
    return true;
  };
}

async function waitForEditor() {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    if (editor.exitCode !== null) break;
    if (editorLog.join('').includes('MCP WebSocket listening')) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Editor did not open the MCP socket.\n${editorLog.join('').slice(-2000)}`);
}

const script = `extends Node2D

func _ready() -> void:
	print("E2E_PLAYER_READY")
`;

async function main() {
  await waitForEditor();

  const serverCwd = join(homedir(), 'godot-mcp-e2e-cwd');
  mkdirSync(serverCwd, { recursive: true });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(repoRoot, 'server/dist/index.js')],
    cwd: serverCwd,
    stderr: 'inherit',
    env: {
      ...process.env,
      GODOT_PATH: godot,
      GODOT_PROJECT_PATH: project,
      READ_ONLY_MODE: '',
    },
  });
  client = new Client({ name: 'godot-mcp-e2e', version: '0.0.0' });
  await client.connect(transport);

  const listed = await client.listTools();
  if (listed.tools.length !== 29) {
    failures.push({ name: 'tools/list', note: `expected 29 tools, got ${listed.tools.length}` });
  }

  await call('manage_project', { action: 'get_version' }, (text, isError) => {
    if (isError) return text.slice(0, 300);
    if (!text.includes(feature)) return `version text missing ${feature}: ${text}`;
    return true;
  });
  await call('manage_project', { action: 'get_info', projectPath: project }, (text, isError) => {
    if (isError) return text.slice(0, 300);
    if (!text.includes('E2E Demo') || !text.includes(project)) return 'project info mismatch';
    return true;
  });
  await call(
    'manage_project',
    { action: 'list', directory: dirname(project), recursive: false },
    ok('godot-mcp-e2e'),
  );

  await call(
    'manage_scene',
    { action: 'create', path: 'res://scenes/main.tscn', root_node_type: 'Node2D' },
    (text, isError) => {
      if (isError) return text.slice(0, 400);
      if (!existsSync(join(project, 'scenes/main.tscn'))) return 'scene file missing';
      return true;
    },
  );
  await call(
    'manage_project',
    { action: 'launch_editor', projectPath: project },
    (text, isError) => {
      if (isError) return text.slice(0, 300);
      if (!text.toLowerCase().includes('already')) return text.slice(0, 200);
      return true;
    },
  );
  await call(
    'manage_node',
    { action: 'create', parent_path: '/root', node_type: 'Node2D', node_name: 'Player' },
    ok('Player'),
  );
  await call(
    'manage_node',
    { action: 'create', parent_path: 'Player', node_type: 'Sprite2D', node_name: 'Sprite' },
    ok('Sprite'),
  );
  await call(
    'manage_script',
    {
      action: 'create',
      script_path: 'res://scripts/player.gd',
      content: script,
      node_path: 'Player',
    },
    (text, isError) => {
      if (isError) return text.slice(0, 400);
      const body = readFileSync(join(project, 'scripts/player.gd'), 'utf8');
      if (!body.includes('E2E_PLAYER_READY')) return 'script was not written';
      return true;
    },
  );
  await call(
    'manage_node',
    {
      action: 'update_property',
      node_path: 'Player/Sprite',
      property: 'position',
      value: { x: 160, y: 120 },
    },
    (text, isError) => (isError ? text.slice(0, 300) : true),
  );
  await call(
    'manage_node',
    {
      action: 'update_property',
      node_path: 'Player/Sprite',
      property: 'scale',
      value: { x: 8, y: 8 },
    },
    (text, isError) => (isError ? text.slice(0, 300) : true),
  );
  await call(
    'manage_scene',
    {
      action: 'set_sprite_texture',
      node_path: 'Player/Sprite',
      texture_type: 'PlaceholderTexture2D',
      texture_params: { size: { x: 64, y: 64 } },
    },
    (text, isError) => (isError ? text.slice(0, 400) : true),
  );
  await call('manage_node', { action: 'list', parent_path: '/root' }, ok('Player'));
  await call('execute_editor_script', { code: 'return "mesh-set"' }, (text, isError) => {
    if (isError) return text.slice(0, 500);
    if (!text.includes('mesh-set')) return 'editor script did not return the string';
    return true;
  });
  await call(
    'manage_node',
    { action: 'duplicate', node_path: 'Player/Sprite', new_name: 'SpriteCopy' },
    ok('SpriteCopy'),
  );
  await call(
    'manage_node',
    { action: 'delete', node_path: 'Player/SpriteCopy' },
    (text, isError) => (isError ? text.slice(0, 300) : true),
  );
  await call('manage_audio', { action: 'get_buses' }, ok('Master'));
  await call(
    'manage_scene',
    { action: 'save', path: 'res://scenes/main.tscn' },
    (text, isError) => {
      if (isError) return text.slice(0, 400);
      const body = readFileSync(join(project, 'scenes/main.tscn'), 'utf8');
      if (!body.includes('Player') || !body.includes('Sprite2D') || !body.includes('player.gd')) {
        return 'saved scene is missing the player, sprite, or script';
      }
      return true;
    },
  );

  if (!headless) captureDisplay(join(project, 'editor-demo.png'));

  await call(
    'manage_script',
    { action: 'get', script_path: 'res://scripts/player.gd' },
    ok('E2E_PLAYER_READY'),
  );
  await call(
    'inspect_project',
    { action: 'get_node_type_properties', node_type: 'Sprite2D' },
    ok('texture'),
  );
  await call(
    'manage_project_config',
    {
      action: 'update_settings',
      projectPath: project,
      section: 'application',
      key: 'run/main_scene',
      value: 'res://scenes/main.tscn',
    },
    (text, isError) => {
      if (isError) return text.slice(0, 300);
      if (
        !readFileSync(join(project, 'project.godot'), 'utf8').includes('res://scenes/main.tscn')
      ) {
        return 'main scene was not written';
      }
      return true;
    },
  );
  await call(
    'manage_signal',
    {
      action: 'create',
      projectPath: project,
      scriptPath: 'scripts/player.gd',
      signalName: 'landed',
    },
    (text, isError) => {
      if (isError) return text.slice(0, 300);
      if (!readFileSync(join(project, 'scripts/player.gd'), 'utf8').includes('signal landed')) {
        return 'signal missing';
      }
      return true;
    },
  );
  await call(
    'manage_animation',
    {
      action: 'create_player',
      parent_path: '/root',
      node_name: 'Animator',
      animation_name: 'idle',
    },
    ok('Animator'),
  );
  await call(
    'manage_physics',
    {
      action: 'add_body',
      parent_path: '/root',
      node_name: 'Crate',
      body_type: 'static_body_2d',
      collision_shape: 'rectangle',
    },
    ok('Crate'),
  );
  await call(
    'manage_physics',
    { action: 'configure', node_path: 'Crate', friction: 0.4 },
    (text, isError) => {
      if (isError) return text.slice(0, 400);
      if (!text.includes('0.4')) return 'friction was not applied';
      return true;
    },
  );
  await call(
    'manage_scene',
    {
      action: 'set_collision_shape',
      node_path: 'Crate/CollisionShape',
      shape_type: 'CircleShape2D',
      shape_params: { radius: 12 },
    },
    (text, isError) => (isError ? text.slice(0, 400) : true),
  );
  await call(
    'manage_ui',
    {
      action: 'create_element',
      parent_path: '/root',
      node_name: 'Title',
      element_type: 'label',
      text: 'E2E',
    },
    ok('Title'),
  );
  await call(
    'manage_ui',
    {
      action: 'apply_theme',
      node_path: 'Title',
      theme_overrides: { 'colors/font_color': { r: 1, g: 0.2, b: 0.2, a: 1 } },
    },
    (text, isError) => (isError ? text.slice(0, 400) : true),
  );
  await call(
    'manage_ui',
    {
      action: 'create_menu',
      parent_path: '/root',
      node_name: 'MainMenu',
      menu_type: 'menu_button',
      menu_items: [{ label: 'Play' }],
    },
    ok('MainMenu'),
  );
  await call('manage_scene', { action: 'save', path: 'res://scenes/main.tscn' }, (text, isError) =>
    isError ? text.slice(0, 300) : true,
  );
  await call(
    'search_project',
    { action: 'read_file', projectPath: project, filePath: 'res://scripts/player.gd' },
    ok('E2E_PLAYER_READY'),
  );
  await call(
    'get_project_assets',
    { projectPath: project, categories: ['scenes', 'scripts'] },
    (text, isError) => {
      if (isError) return text.slice(0, 300);
      if (!text.includes('main.tscn') || !text.includes('player.gd')) return 'assets missing';
      return true;
    },
  );
  await call(
    'get_project_context',
    { projectPath: project, scenePath: 'res://scenes/main.tscn' },
    ok('Player'),
  );
  await call(
    'validate_scene',
    { action: 'check', projectPath: project, filePath: 'res://scenes/main.tscn' },
    (text, isError) => (isError ? text.slice(0, 300) : true),
  );
  await call(
    'debug_project',
    { action: 'remote_tree_dump', rootPath: '/root', maxDepth: 4 },
    ok('Player'),
  );
  await call('debug_project', { action: 'toggle_debug_draw', mode: 'disabled' }, (text, isError) =>
    isError ? text.slice(0, 300) : true,
  );
  await call('visualize_project', { action: 'map_scenes', include_addons: false }, ok('main.tscn'));
  await call('godot_docs', { action: 'get_best_practices', topic: 'gdscript' }, (text, isError) => {
    if (isError) return text.slice(0, 200);
    if (text.length < 40) return 'best practices empty';
    return true;
  });

  if (!headless) {
    await call('capture_vision', { action: 'editor_viewport' }, (text, isError) => {
      if (isError) return text.slice(0, 300);
      const match = text.match(/Snapshot saved to:\s*(.+)/);
      if (!match) return 'no snapshot path';
      if (!existsSync(match[1].trim())) return `missing ${match[1]}`;
      return true;
    });
    await call(
      'capture_vision',
      { action: 'scene_preview', scenePath: 'res://scenes/main.tscn' },
      (text, isError) => {
        if (isError) return text.slice(0, 400);
        const match = text.match(/"previewPath":\s*"([^"]+)"/);
        if (match && !existsSync(match[1])) return `missing ${match[1]}`;
        if (!text.includes('main.tscn')) return 'preview did not name the scene';
        return true;
      },
    );
    await call(
      'capture_vision',
      {
        action: 'headless_screenshot',
        projectPath: project,
        scenePath: 'res://scenes/main.tscn',
        outputPath: join(project, 'scene-shot.png'),
        waitFrames: 5,
      },
      (text, isError) => {
        if (isError) return text.slice(0, 500);
        if (!existsSync(join(project, 'scene-shot.png'))) return text.slice(0, 500);
        return true;
      },
      45000,
    );
  }

  if (existsSync(join(project, 'icon.svg'))) {
    await call(
      'manage_asset',
      {
        action: 'load_sprite',
        projectPath: project,
        nodePath: 'Player/Sprite',
        texturePath: 'res://icon.svg',
      },
      (text, isError) => (isError ? text.slice(0, 400) : true),
    );
  }

  await call(
    'manage_project',
    { action: 'run', projectPath: project, scene: 'res://scenes/main.tscn' },
    (text, isError) => {
      if (isError) return text.slice(0, 400);
      if (!text.includes('running') && !text.includes('E2E_PLAYER_READY'))
        return text.slice(0, 200);
      return true;
    },
  );
  await call('manage_project', { action: 'get_output' }, ok('E2E_PLAYER_READY'));
  await call('debug_project', { action: 'get_debug_output' }, ok('E2E_PLAYER_READY'));
  await call('manage_project', { action: 'stop' }, (text, isError) => {
    if (isError) return text.slice(0, 200);
    if (!text.includes('stopped')) return text.slice(0, 200);
    return true;
  });
  await call(
    'debug_project',
    {
      action: 'run_scene',
      projectPath: project,
      scenePath: 'res://scenes/main.tscn',
      timeoutMs: 3000,
    },
    ok('E2E_PLAYER_READY'),
    20000,
  );
  await call(
    'run_and_verify',
    { projectPath: project, scene: 'res://scenes/main.tscn', waitMs: 2500 },
    (text, isError) => {
      if (isError) return text.slice(0, 400);
      if (!text.includes('E2E_PLAYER_READY') || !text.includes('"status": "pass"')) {
        return 'verification report did not pass or missed the ready print';
      }
      return true;
    },
    20000,
  );
  await call(
    'get_project_diagnostics',
    { projectPath: project },
    (text, isError) => (isError ? text.slice(0, 400) : true),
    90000,
  );

  await call('manage_game_bridge', { action: 'install', projectPath: project }, (text, isError) => {
    if (isError) return text.slice(0, 400);
    if (!existsSync(join(project, 'test_bridge.gd'))) return 'bridge script missing';
    if (!readFileSync(join(project, 'project.godot'), 'utf8').includes('TestBridge'))
      return 'autoload missing';
    return true;
  });
  await call(
    'manage_game_bridge',
    { action: 'run', projectPath: project, scenePath: 'res://scenes/main.tscn' },
    ok('bridge connected'),
    20000,
  );
  await call('game_scene', { action: 'get_tree', maxDepth: 4 }, ok('Player'));
  await call(
    'game_scene',
    {
      action: 'set_property',
      nodePath: '/root/main/Player',
      property: 'position',
      value: { x: 4, y: 6 },
    },
    (text, isError) => (isError ? text.slice(0, 400) : true),
  );
  await call(
    'game_input',
    { action: 'key', key: 'Space', pressed: true, durationMs: 40 },
    (text, isError) => (isError ? text.slice(0, 300) : true),
  );
  await call('game_state', { action: 'get_performance' }, (text, isError) =>
    isError ? text.slice(0, 300) : true,
  );
  await call('game_state', { action: 'evaluate', expression: '1 + 1' }, (text) =>
    text.includes('allowUnsafeGameCommands') ? true : text.slice(0, 300),
  );
  await call(
    'game_wait',
    { action: 'node', nodePath: '/root/main/Player', timeoutMs: 3000 },
    (text, isError) => (isError ? text.slice(0, 300) : true),
  );
  await call('capture_vision', { action: 'game_bridge' }, (text, isError) =>
    isError ? text.slice(0, 400) : true,
  );
  await call('manage_game_bridge', { action: 'disconnect' }, (text, isError) =>
    isError ? text.slice(0, 200) : true,
  );
  await call('manage_project', { action: 'stop' }, (text, isError) => {
    if (isError) return text.slice(0, 200);
    if (!text.includes('stopped')) return text.slice(0, 200);
    return true;
  });

  if (full) {
    await call(
      'godot_docs',
      { action: 'search', query: 'Node2D' },
      (text, isError) => (isError ? text.slice(0, 400) : true),
      180000,
    );
    await call('godot_docs', { action: 'get_class', class_name: 'Node2D' }, ok('Node2D'), 60000);
    await call(
      'godot_docs',
      { action: 'get_tree' },
      (text, isError) => (isError ? text.slice(0, 300) : true),
      60000,
    );
    await call(
      'godot_docs',
      { action: 'get_file', path: 'classes/class_node2d.rst' },
      ok('Node2D'),
      60000,
    );
    await call(
      'semantic_search',
      { query: 'player ready print', projectPath: project, limit: 3 },
      (text, isError) => {
        if (isError) return text.slice(0, 500);
        if (!text.includes('"path"')) return 'semantic search returned no hits';
        return true;
      },
      180000,
    );
  }

  await client.close();
}

function captureDisplay(filePath) {
  try {
    execFileSync(
      'ffmpeg',
      [
        '-y',
        '-f',
        'x11grab',
        '-video_size',
        '1920x1200',
        '-i',
        process.env.DISPLAY,
        '-frames:v',
        '1',
        filePath,
      ],
      { stdio: 'ignore' },
    );
    console.log(`captured ${filePath}`);
  } catch (error) {
    console.log(`capture failed: ${error instanceof Error ? error.message : error}`);
  }
}

try {
  await main();
} catch (error) {
  console.error(error);
  failures.push({ name: 'harness', note: error instanceof Error ? error.message : String(error) });
} finally {
  if (client) {
    try {
      await client.close();
    } catch {
      /* already closed */
    }
  }
  if (editor && editor.exitCode === null) editor.kill('SIGKILL');
}

if (failures.length > 0) {
  console.error(`E2E FAILED ${failures.length}`);
  process.exit(1);
}
console.log('E2E PASSED');
