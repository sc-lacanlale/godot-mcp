import { describe, expect, it } from 'vitest';
import { extractClassNames, getErrorSuggestions, parseGodotOutput } from './error_parser.js';

describe('parseGodotOutput', () => {
  it('classifies script errors, engine errors, warnings, shader errors, and parser lines', () => {
    const { parsedErrors, parsedWarnings } = parseGodotOutput(
      [
        'SCRIPT ERROR: Unexpected identifier at: res://player.gd:12',
        'WARNING: Unused variable at: res://player.gd:4',
        'res://player.gd:10 - Expected indented block after colon',
      ],
      [
        'ERROR: Condition "node == null" is true at: res://main.gd:8 in _ready',
        'SHADER ERROR: Unknown identifier in expression',
      ],
    );

    expect(parsedErrors).toEqual([
      {
        type: 'script_error',
        message: 'Unexpected identifier',
        file: 'res://player.gd',
        line: 12,
      },
      {
        type: 'script_error',
        message: 'Expected indented block after colon',
        file: 'res://player.gd',
        line: 10,
      },
      {
        type: 'error',
        message: 'Condition "node == null" is true',
        file: 'res://main.gd',
        line: 8,
        function: '_ready',
      },
      {
        type: 'shader_error',
        message: 'Unknown identifier in expression',
      },
    ]);
    expect(parsedWarnings).toEqual([
      {
        type: 'warning',
        message: 'Unused variable',
        file: 'res://player.gd',
        line: 4,
      },
    ]);
  });

  it('keeps a bare error when the location suffix is absent', () => {
    const { parsedErrors } = parseGodotOutput(['ERROR: Out of memory'], []);
    expect(parsedErrors).toHaveLength(1);
    expect(parsedErrors[0]).toMatchObject({ type: 'error', message: 'Out of memory' });
    expect(parsedErrors[0].file).toBeUndefined();
    expect(parsedErrors[0].line).toBeUndefined();
  });

  it('ignores lines that are not Godot diagnostics', () => {
    const { parsedErrors, parsedWarnings } = parseGodotOutput(['Godot Engine v4.7.2.stable'], []);
    expect(parsedErrors).toEqual([]);
    expect(parsedWarnings).toEqual([]);
  });
});

describe('getErrorSuggestions', () => {
  it('matches patterns without regard to case and concatenates hits', () => {
    const suggestions = getErrorSuggestions('Invalid call. Function not found on Node');
    expect(suggestions).toEqual(
      expect.arrayContaining([
        'Verify the method exists on the object',
        'Check if the file or resource path is correct',
      ]),
    );
  });

  it('returns nothing for an unrecognized message', () => {
    expect(getErrorSuggestions('renderer restarted')).toEqual([]);
  });
});

describe('extractClassNames', () => {
  it('returns unique PascalCase identifiers, including 2D and 3D suffixes', () => {
    expect(extractClassNames('Node2D is not a Sprite2D or a Node2D')).toEqual([
      'Node2D',
      'Sprite2D',
    ]);
  });

  it('returns an empty list when no class-like token is present', () => {
    expect(extractClassNames('missing semicolon')).toEqual([]);
  });
});
