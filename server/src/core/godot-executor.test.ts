import { describe, expect, it } from 'vitest';
import { isGodot44OrLater } from './godot-executor.js';

describe('isGodot44OrLater', () => {
  it('accepts 4.4 and newer, including the 4.7 stable string', () => {
    expect(isGodot44OrLater('4.4.1.stable')).toBe(true);
    expect(isGodot44OrLater('4.7.2.stable.official')).toBe(true);
    expect(isGodot44OrLater('5.0')).toBe(true);
  });

  it('rejects 4.3 and unparseable strings', () => {
    expect(isGodot44OrLater('4.3.stable')).toBe(false);
    expect(isGodot44OrLater('3.6')).toBe(false);
    expect(isGodot44OrLater('dev')).toBe(false);
  });
});
