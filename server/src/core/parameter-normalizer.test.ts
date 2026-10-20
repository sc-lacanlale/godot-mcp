import { describe, expect, it } from 'vitest';
import {
  convertCamelToSnakeCase,
  normalizeHandlerPaths,
  normalizeParameters,
} from './parameter-normalizer.js';

describe('normalizeParameters', () => {
  it('maps known snake_case keys to camelCase and leaves unknown keys', () => {
    expect(
      normalizeParameters({
        project_path: '/games/demo',
        scene_path: 'res://main.tscn',
        custom_field: 'keep',
        alreadyCamel: 1,
      }),
    ).toEqual({
      projectPath: '/games/demo',
      scenePath: 'res://main.tscn',
      custom_field: 'keep',
      alreadyCamel: 1,
    });
  });

  it('recurses into nested objects and leaves arrays intact', () => {
    expect(
      normalizeParameters({
        project_path: { scene_path: 'res://a.tscn' },
        items: [{ project_path: 'not-walked' }],
      }),
    ).toEqual({
      projectPath: { scenePath: 'res://a.tscn' },
      items: [{ project_path: 'not-walked' }],
    });
  });

  it('returns non-objects unchanged', () => {
    expect(normalizeParameters(null as unknown as Record<string, unknown>)).toBeNull();
  });
});

describe('convertCamelToSnakeCase', () => {
  it('prefers the known reverse map and falls back to a generic conversion', () => {
    expect(
      convertCamelToSnakeCase({
        projectPath: '/games/demo',
        rootNodeType: 'Node2D',
        customField: true,
        already_snake: 2,
      }),
    ).toEqual({
      project_path: '/games/demo',
      root_node_type: 'Node2D',
      custom_field: true,
      already_snake: 2,
    });
  });

  it('recurses into nested objects', () => {
    expect(convertCamelToSnakeCase({ scenePath: { nodePath: 'Player' } })).toEqual({
      scene_path: { node_path: 'Player' },
    });
  });
});

describe('normalizeHandlerPaths', () => {
  it('rewrites backslashes on known path keys only', () => {
    expect(
      normalizeHandlerPaths({
        scenePath: 'C:\\projects\\demo\\main.tscn',
        nodePath: 'Enemies\\Golem',
        note: 'keep\\this',
      }),
    ).toEqual({
      scenePath: 'C:/projects/demo/main.tscn',
      nodePath: 'Enemies/Golem',
      note: 'keep\\this',
    });
  });
});
