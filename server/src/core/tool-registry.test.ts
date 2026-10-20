import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ToolRegistry } from './tool-registry.js';
import type { MCPTool } from '../utils/types.js';

function tool(name: string): MCPTool {
  return {
    name,
    description: name,
    parameters: z.object({}),
    execute: async () => name,
  };
}

describe('ToolRegistry', () => {
  it('registers tools, reports size, and groups them by category', () => {
    const registry = new ToolRegistry();
    registry.registerBatch([tool('search_project'), tool('semantic_search')], {
      readOnly: true,
      category: 'search',
    });
    registry.register({ tool: tool('manage_node'), readOnly: false, category: 'node' });

    expect(registry.size).toBe(3);
    expect(registry.has('manage_node')).toBe(true);
    expect(registry.get('manage_node')?.readOnly).toBe(false);
    expect(registry.getToolNames().sort()).toEqual([
      'manage_node',
      'search_project',
      'semantic_search',
    ]);
    expect(registry.getToolsByCategory()).toEqual({
      search: ['search_project', 'semantic_search'],
      node: ['manage_node'],
    });
  });

  it('overwrites a tool that is registered twice', () => {
    const registry = new ToolRegistry();
    registry.register({ tool: tool('manage_scene'), readOnly: true, category: 'scene' });
    registry.register({ tool: tool('manage_scene'), readOnly: false, category: 'scene' });

    expect(registry.size).toBe(1);
    expect(registry.get('manage_scene')?.readOnly).toBe(false);
  });

  it('drops write tools when read-only mode is requested', () => {
    const registry = new ToolRegistry();
    registry.register({ tool: tool('search_project'), readOnly: true, category: 'search' });
    registry.register({ tool: tool('manage_node'), readOnly: false, category: 'node' });

    expect(
      registry
        .getFilteredTools(false)
        .map((entry) => entry.name)
        .sort(),
    ).toEqual(['manage_node', 'search_project']);
    expect(registry.getFilteredTools(true).map((entry) => entry.name)).toEqual(['search_project']);
  });
});
