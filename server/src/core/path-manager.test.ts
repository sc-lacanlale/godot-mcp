import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, normalize, resolve } from 'path';
import { pathToFileURL } from 'url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  clearPathCache,
  detectGodotPath,
  detectProjectPath,
  isGodotProject,
  isValidGodotPath,
  isValidGodotPathSync,
  normalizePath,
  setClientRoots,
  validatePath,
} from './path-manager.js';

const envSnapshot = {
  GODOT_PATH: process.env.GODOT_PATH,
  GODOT_PROJECT_PATH: process.env.GODOT_PROJECT_PATH,
  HOME: process.env.HOME,
  USERPROFILE: process.env.USERPROFILE,
};

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'godot-mcp-'));
}

function writeProject(dir: string, name = 'Demo'): void {
  writeFileSync(join(dir, 'project.godot'), `config/name="${name}"\n`);
}

afterEach(() => {
  clearPathCache();
  setClientRoots([]);
  for (const [key, value] of Object.entries(envSnapshot)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe('validatePath', () => {
  it('rejects empty input, null bytes, traversal, UNC paths, and system directories', () => {
    expect(validatePath('')).toBe(false);
    expect(validatePath('game\0.tscn')).toBe(false);
    expect(validatePath('demo/../../etc/passwd')).toBe(false);
    expect(validatePath('\\\\server\\share')).toBe(false);
    expect(validatePath('/etc/passwd')).toBe(false);
    expect(validatePath('C:/Windows/System32')).toBe(false);
  });

  it('accepts an ordinary project path', () => {
    expect(validatePath('/home/dev/games/demo')).toBe(true);
  });
});

describe('isGodotProject', () => {
  it('detects a directory that contains project.godot', () => {
    const dir = tempDir();
    expect(isGodotProject(dir)).toBe(false);
    writeProject(dir);
    expect(isGodotProject(dir)).toBe(true);
  });
});

describe('normalizePath', () => {
  it('collapses redundant separators and parent segments', () => {
    expect(normalizePath('/var//games/../games/demo')).toBe(normalize('/var/games/demo'));
  });
});

describe('Godot executable checks', () => {
  it('rejects a path that does not exist', async () => {
    expect(isValidGodotPathSync('/no/such/godot-binary')).toBe(false);
    await expect(isValidGodotPath('/no/such/godot-binary')).resolves.toBe(false);
    await expect(isValidGodotPath('/no/such/godot-binary')).resolves.toBe(false);
  });

  it('does not treat a missing hint as a usable executable', async () => {
    clearPathCache();
    process.env.GODOT_PATH = '/no/such/godot-from-env';
    const found = await detectGodotPath('/no/such/godot-hint');
    expect(found).not.toBe(resolve('/no/such/godot-hint'));
  });
});

describe('detectProjectPath', () => {
  it('returns an explicit path without searching', () => {
    expect(detectProjectPath('/tmp/explicit-game')).toBe(resolve('/tmp/explicit-game'));
  });

  it('prefers GODOT_PROJECT_PATH when that directory is a Godot project', () => {
    const project = tempDir();
    writeProject(project);
    const home = tempDir();
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    delete process.env.GODOT_PATH;
    process.env.GODOT_PROJECT_PATH = project;

    expect(detectProjectPath()).toBe(resolve(project));
  });

  it('uses a client workspace root and skips this repository', () => {
    const home = tempDir();
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    delete process.env.GODOT_PROJECT_PATH;

    const spacedProject = join(tempDir(), 'My Project');
    mkdirSync(spacedProject);
    writeProject(spacedProject, 'Spaced');
    setClientRoots([
      { uri: pathToFileURL(process.cwd()).href },
      { uri: pathToFileURL(spacedProject).href },
    ]);

    expect(detectProjectPath()).toBe(resolve(spacedProject));
  });

  it('finds a project in an immediate subdirectory of a client root', () => {
    const root = tempDir();
    const game = join(root, 'game');
    mkdirSync(game);
    writeProject(game);
    const home = tempDir();
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    delete process.env.GODOT_PROJECT_PATH;
    setClientRoots([{ uri: pathToFileURL(root).href }]);

    expect(detectProjectPath()).toBe(resolve(game));
  });
});
