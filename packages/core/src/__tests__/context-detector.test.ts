import { describe, it, expect } from 'vitest';
import { detectInvocationContext } from '../context-detector.js';

describe('detectInvocationContext', () => {
  describe('detection inside with{} block', () => {
    it('returns context when cursor is inside an include with { block', () => {
      const text = "{% include 'example:card' with { ";
      const result = detectInvocationContext(text, text.length);

      expect(result).not.toBeNull();
      expect(result!.componentId).toBe('example:card');
      expect(result!.alreadyUsedKeys).toEqual([]);
    });

    it('returns context when cursor is inside an embed with { block', () => {
      const text = "{% embed 'example:hero' with { ";
      const result = detectInvocationContext(text, text.length);

      expect(result).not.toBeNull();
      expect(result!.componentId).toBe('example:hero');
    });

    it('extracts already-used keys from partial with block', () => {
      const text = "{% include 'example:card' with { title: 'foo', ";
      const result = detectInvocationContext(text, text.length);

      expect(result).not.toBeNull();
      expect(result!.alreadyUsedKeys).toContain('title');
    });

    it('extracts multiple already-used keys', () => {
      const text = "{% include 'example:card' with { title: 'foo', url: '/bar', ";
      const result = detectInvocationContext(text, text.length);

      expect(result).not.toBeNull();
      expect(result!.alreadyUsedKeys).toContain('title');
      expect(result!.alreadyUsedKeys).toContain('url');
    });

    it('handles component IDs with hyphens', () => {
      const text = "{% include 'example:my-button' with { ";
      const result = detectInvocationContext(text, text.length);

      expect(result).not.toBeNull();
      expect(result!.componentId).toBe('example:my-button');
    });

    it('handles double-quoted component IDs', () => {
      const text = '{% include "example:card" with { ';
      const result = detectInvocationContext(text, text.length);

      expect(result).not.toBeNull();
      expect(result!.componentId).toBe('example:card');
    });
  });

  describe('multi-line with {} blocks', () => {
    it('detects context when cursor is on a new line inside with {}', () => {
      const text = "{% include 'example:card' with {\n    ";
      const result = detectInvocationContext(text, text.length);

      expect(result).not.toBeNull();
      expect(result!.componentId).toBe('example:card');
      expect(result!.alreadyUsedKeys).toEqual([]);
    });

    it('extracts already-used keys from previous lines in with {}', () => {
      const text = "{% include 'example:card' with {\n    title: 'foo',\n    ";
      const result = detectInvocationContext(text, text.length);

      expect(result).not.toBeNull();
      expect(result!.alreadyUsedKeys).toContain('title');
    });

    it('extracts multiple used keys across lines', () => {
      const text = "{% include 'example:card' with {\n    title: 'foo',\n    url: '/bar',\n    ";
      const result = detectInvocationContext(text, text.length);

      expect(result).not.toBeNull();
      expect(result!.alreadyUsedKeys).toContain('title');
      expect(result!.alreadyUsedKeys).toContain('url');
    });

    it('returns null when multi-line with block is closed', () => {
      const text = "{% include 'example:card' with {\n    title: 'foo'\n} %}";
      const result = detectInvocationContext(text, text.length);

      expect(result).toBeNull();
    });
  });

  describe('null cases', () => {
    it('returns null when cursor is before the with keyword', () => {
      const text = "{% include 'example:card'";
      const result = detectInvocationContext(text, text.length);
      expect(result).toBeNull();
    });

    it('returns null when cursor is after closing brace', () => {
      const text = "{% include 'example:card' with { title: 'foo' } %}";
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
      const text = "{% extends 'example:card' with { ";
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
      const result = detectInvocationContext("{% include 'example:card' with { ", 0);
      expect(result).toBeNull();
    });

    it('handles cursor beyond document length gracefully', () => {
      const text = "{% include 'example:card' with { ";
      const result = detectInvocationContext(text, text.length + 1000);
      // Clamped to text length — still inside the block
      expect(result).not.toBeNull();
    });

    it('handles lookback limit for very long documents', () => {
      const prefix = 'x'.repeat(10000);
      const text = prefix + "{% include 'example:card' with { ";
      const result = detectInvocationContext(text, text.length);
      // The include is within the last 2000 chars — should be found
      expect(result).not.toBeNull();
    });

    it('handles unknown component ID (still returns context)', () => {
      const text = "{% include 'example:nonexistent' with { ";
      const result = detectInvocationContext(text, text.length);
      expect(result).not.toBeNull();
      expect(result!.componentId).toBe('example:nonexistent');
    });
  });
});
