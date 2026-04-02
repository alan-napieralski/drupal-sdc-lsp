import { describe, it, expect } from 'vitest';
import { detectInvocationContext } from '../context-detector.js';

describe('detectInvocationContext', () => {
  describe('detection inside with{} block', () => {
    it('returns context when cursor is inside an include with { block', () => {
      const text = "{% include 'numiko:card' with { ";
      const result = detectInvocationContext(text, text.length);

      expect(result).not.toBeNull();
      expect(result!.componentId).toBe('numiko:card');
      expect(result!.alreadyUsedKeys).toEqual([]);
    });

    it('returns context when cursor is inside an embed with { block', () => {
      const text = "{% embed 'numiko:hero' with { ";
      const result = detectInvocationContext(text, text.length);

      expect(result).not.toBeNull();
      expect(result!.componentId).toBe('numiko:hero');
    });

    it('extracts already-used keys from partial with block', () => {
      const text = "{% include 'numiko:card' with { title: 'foo', ";
      const result = detectInvocationContext(text, text.length);

      expect(result).not.toBeNull();
      expect(result!.alreadyUsedKeys).toContain('title');
    });

    it('extracts multiple already-used keys', () => {
      const text = "{% include 'numiko:card' with { title: 'foo', url: '/bar', ";
      const result = detectInvocationContext(text, text.length);

      expect(result).not.toBeNull();
      expect(result!.alreadyUsedKeys).toContain('title');
      expect(result!.alreadyUsedKeys).toContain('url');
    });

    it('handles component IDs with hyphens', () => {
      const text = "{% include 'numiko:my-button' with { ";
      const result = detectInvocationContext(text, text.length);

      expect(result).not.toBeNull();
      expect(result!.componentId).toBe('numiko:my-button');
    });

    it('handles double-quoted component IDs', () => {
      const text = '{% include "numiko:card" with { ';
      const result = detectInvocationContext(text, text.length);

      expect(result).not.toBeNull();
      expect(result!.componentId).toBe('numiko:card');
    });
  });

  describe('null cases', () => {
    it('returns null when cursor is before the with keyword', () => {
      const text = "{% include 'numiko:card'";
      const result = detectInvocationContext(text, text.length);
      expect(result).toBeNull();
    });

    it('returns null when cursor is after closing brace', () => {
      const text = "{% include 'numiko:card' with { title: 'foo' } %}";
      const result = detectInvocationContext(text, text.length);
      expect(result).toBeNull();
    });

    it('returns null for empty document', () => {
      const result = detectInvocationContext('', 0);
      expect(result).toBeNull();
    });

    it('returns null for plain text with no include', () => {
      const result = detectInvocationContext('hello world', 5);
      expect(result).toBeNull();
    });

    it('returns null for extends statement (not include/embed)', () => {
      const text = "{% extends 'numiko:card' with { ";
      const result = detectInvocationContext(text, text.length);
      // extends doesn't support with{} — should not match
      expect(result).toBeNull();
    });
  });

  describe('edge cases', () => {
    it('never throws on any input', () => {
      const inputs: Array<[string, number]> = [
        ['', 0],
        ['', 100],
        ['hello', 0],
        ['hello', 5],
        ['{% include', 10],
        ['\x00\x01\x02', 2],
        ['a'.repeat(5000), 4999],
      ];

      for (const [text, offset] of inputs) {
        expect(() => detectInvocationContext(text, offset)).not.toThrow();
      }
    });

    it('handles cursor at position 0', () => {
      const result = detectInvocationContext("{% include 'numiko:card' with { ", 0);
      expect(result).toBeNull();
    });

    it('handles cursor beyond document length gracefully', () => {
      const text = "{% include 'numiko:card' with { ";
      const result = detectInvocationContext(text, text.length + 1000);
      // Clamped to text length — still inside the block
      expect(result).not.toBeNull();
    });

    it('handles lookback limit for very long documents', () => {
      const prefix = 'x'.repeat(10000);
      const text = prefix + "{% include 'numiko:card' with { ";
      const result = detectInvocationContext(text, text.length);
      // The include is within the last 2000 chars — should be found
      expect(result).not.toBeNull();
    });

    it('handles unknown component ID (still returns context)', () => {
      const text = "{% include 'numiko:nonexistent' with { ";
      const result = detectInvocationContext(text, text.length);
      expect(result).not.toBeNull();
      expect(result!.componentId).toBe('numiko:nonexistent');
    });
  });
});
