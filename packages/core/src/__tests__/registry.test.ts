import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'path';
import { SDCRegistry, buildRegistry } from '../registry.js';

const FIXTURES_DIR = path.resolve(__dirname, '../../../../fixtures/example');

describe('SDCRegistry', () => {
  let registry: SDCRegistry;

  beforeAll(async () => {
    registry = await buildRegistry(FIXTURES_DIR);
  });

  describe('build()', () => {
    it('indexes all 9 valid components from fixtures (excludes 2 malformed)', async () => {
      const allComponents = registry.getAllComponents();
      // 3 atoms + 3 molecules + 2 organisms + 1 shared = 9 valid
      // 2 malformed files return null from parser and are skipped
      expect(allComponents.length).toBe(9);
    });

    it('readyPromise resolves after build()', async () => {
      const newRegistry = new SDCRegistry();
      const buildPromise = newRegistry.build(FIXTURES_DIR);
      await expect(newRegistry.readyPromise).resolves.toBeUndefined();
      await buildPromise;
    });
  });

  describe('getById()', () => {
    it('returns button component by ID', () => {
      const component = registry.getById('example:button');
      expect(component).toBeDefined();
      expect(component!.name).toBe('Button');
    });

    it('returns card component by ID', () => {
      const component = registry.getById('example:card');
      expect(component).toBeDefined();
    });

    it('returns wysiwyg component by ID', () => {
      const component = registry.getById('example:wysiwyg');
      expect(component).toBeDefined();
    });

    it('returns undefined for unknown ID', () => {
      const component = registry.getById('example:nonexistent');
      expect(component).toBeUndefined();
    });

    it('never throws for any ID string', () => {
      expect(() => registry.getById('')).not.toThrow();
      expect(() => registry.getById('::::')).not.toThrow();
    });
  });

  describe('getByProvider()', () => {
    it('returns all components for the example provider', () => {
      const components = registry.getByProvider('example');
      expect(components.length).toBe(9);
    });

    it('returns [] for unknown provider', () => {
      const components = registry.getByProvider('nonexistent');
      expect(components).toEqual([]);
    });
  });

  describe('search()', () => {
    it('finds card component by partial ID', () => {
      const results = registry.search('card');
      expect(results.some((c) => c.id === 'example:card')).toBe(true);
    });

    it('finds button component case-insensitively', () => {
      const results = registry.search('BUTTON');
      expect(results.some((c) => c.id === 'example:button')).toBe(true);
    });

    it('finds by name fragment', () => {
      const results = registry.search('wysiwyg');
      expect(results.some((c) => c.id === 'example:wysiwyg')).toBe(true);
    });

    it('returns [] for no matches', () => {
      const results = registry.search('zzznomatch');
      expect(results).toEqual([]);
    });

    it('is case-insensitive', () => {
      const lower = registry.search('hero');
      const upper = registry.search('HERO');
      expect(lower.length).toBe(upper.length);
    });
  });

  describe('getAllComponents()', () => {
    it('returns all 9 valid components', () => {
      const all = registry.getAllComponents();
      expect(all.length).toBe(9);
    });

    it('includes expected component IDs', () => {
      const ids = registry.getAllComponents().map((c) => c.id);
      expect(ids).toContain('example:button');
      expect(ids).toContain('example:card');
      expect(ids).toContain('example:wysiwyg');
      expect(ids).toContain('example:hero');
      expect(ids).toContain('example:footer');
      expect(ids).toContain('example:icon');
    });
  });

  describe('removeComponent()', () => {
    it('removes a component from the registry', async () => {
      const localRegistry = await buildRegistry(FIXTURES_DIR);
      const button = localRegistry.getById('example:button');
      expect(button).toBeDefined();

      localRegistry.removeComponent(button!.yamlFilePath);

      expect(localRegistry.getById('example:button')).toBeUndefined();
      expect(localRegistry.getAllComponents().length).toBe(8);
    });

    it('does not throw when removing non-existent path', () => {
      expect(() => registry.removeComponent('/does/not/exist.yml')).not.toThrow();
    });
  });

  describe('updateComponent()', () => {
    it('updates an existing component entry', async () => {
      const localRegistry = await buildRegistry(FIXTURES_DIR);
      const buttonPath = localRegistry.getById('example:button')!.yamlFilePath;

      // Re-parse the same file — should not throw and should keep the component
      await localRegistry.updateComponent(buttonPath);

      const updated = localRegistry.getById('example:button');
      expect(updated).toBeDefined();
      expect(updated!.name).toBe('Button');
    });

    it('does not crash for non-existent file', async () => {
      await expect(
        registry.updateComponent('/does/not/exist.component.yml'),
      ).resolves.not.toThrow();
    });
  });

  describe('rebuild()', () => {
    it('rebuilds without leaving registry empty during the process', async () => {
      const localRegistry = await buildRegistry(FIXTURES_DIR);

      const beforeCount = localRegistry.getAllComponents().length;
      await localRegistry.rebuild(FIXTURES_DIR);
      const afterCount = localRegistry.getAllComponents().length;

      expect(afterCount).toBe(beforeCount);
    });
  });

  describe('getByNamespacePath()', () => {
    it('returns a component by namespace path', () => {
      // The namespace path is @example/atoms/button/button.twig
      const component = registry.getByNamespacePath('@example/atoms/button/button.twig');
      expect(component).toBeDefined();
      expect(component!.id).toBe('example:button');
    });

    it('returns undefined for unknown namespace path', () => {
      const result = registry.getByNamespacePath('@example/nonexistent.twig');
      expect(result).toBeUndefined();
    });
  });
});
