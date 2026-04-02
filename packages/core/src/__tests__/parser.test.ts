import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { parseComponentYaml } from '../parser.js';

const FIXTURES_DIR = path.resolve(__dirname, '../../../../fixtures/example/components');

describe('parseComponentYaml', () => {
  describe('valid components', () => {
    it('parses button component correctly', async () => {
      const filePath = path.join(FIXTURES_DIR, 'atoms/button/button.component.yml');
      const result = await parseComponentYaml(filePath);

      expect(result).not.toBeNull();
      expect(result!.id).toBe('example:button');
      expect(result!.provider).toBe('example');
      expect(result!.name).toBe('Button');
      expect(result!.description).toBe('A clickable button component with variants and sizes.');
    });

    it('button has correct props with required flags', async () => {
      const filePath = path.join(FIXTURES_DIR, 'atoms/button/button.component.yml');
      const result = await parseComponentYaml(filePath);

      expect(result).not.toBeNull();
      const props = result!.props;

      const labelProp = props.find((p) => p.name === 'label');
      expect(labelProp).toBeDefined();
      expect(labelProp!.required).toBe(true);
      expect(labelProp!.type).toBe('string');

      const variantProp = props.find((p) => p.name === 'variant');
      expect(variantProp).toBeDefined();
      expect(variantProp!.required).toBe(false);

      const disabledProp = props.find((p) => p.name === 'disabled');
      expect(disabledProp).toBeDefined();
      expect(disabledProp!.type).toBe('boolean');
      expect(disabledProp!.required).toBe(false);
    });

    it('button has icon slot', async () => {
      const filePath = path.join(FIXTURES_DIR, 'atoms/button/button.component.yml');
      const result = await parseComponentYaml(filePath);

      expect(result).not.toBeNull();
      const iconSlot = result!.slots.find((s) => s.name === 'icon');
      expect(iconSlot).toBeDefined();
      expect(iconSlot!.description).toBe('Optional icon to display alongside the label');
    });

    it('button has a non-null twigFilePath since button.twig exists', async () => {
      const filePath = path.join(FIXTURES_DIR, 'atoms/button/button.component.yml');
      const result = await parseComponentYaml(filePath);

      expect(result).not.toBeNull();
      expect(result!.twigFilePath).not.toBeNull();
      expect(result!.twigFilePath).toContain('button.twig');
    });

    it('parses wysiwyg component with no props', async () => {
      const filePath = path.join(FIXTURES_DIR, 'molecules/wysiwyg/wysiwyg.component.yml');
      const result = await parseComponentYaml(filePath);

      expect(result).not.toBeNull();
      expect(result!.id).toBe('example:wysiwyg');
      expect(result!.props).toEqual([]);
      expect(result!.slots.length).toBeGreaterThan(0);
    });

    it('parses footer component with no props, only slots', async () => {
      const filePath = path.join(FIXTURES_DIR, 'organisms/footer/footer.component.yml');
      const result = await parseComponentYaml(filePath);

      expect(result).not.toBeNull();
      expect(result!.props).toEqual([]);

      const linksSlot = result!.slots.find((s) => s.name === 'links');
      expect(linksSlot).toBeDefined();

      const legalSlot = result!.slots.find((s) => s.name === 'legal');
      expect(legalSlot).toBeDefined();
    });

    it('parses card component with both props and slots', async () => {
      const filePath = path.join(FIXTURES_DIR, 'molecules/card/card.component.yml');
      const result = await parseComponentYaml(filePath);

      expect(result).not.toBeNull();
      expect(result!.props.length).toBeGreaterThan(0);
      expect(result!.slots.length).toBeGreaterThan(0);
    });

    it('parses heading component with required props', async () => {
      const filePath = path.join(FIXTURES_DIR, 'atoms/heading/heading.component.yml');
      const result = await parseComponentYaml(filePath);

      expect(result).not.toBeNull();
      const textProp = result!.props.find((p) => p.name === 'text');
      const levelProp = result!.props.find((p) => p.name === 'level');
      const styleLevelProp = result!.props.find((p) => p.name === 'style_level');

      expect(textProp!.required).toBe(true);
      expect(levelProp!.required).toBe(true);
      expect(styleLevelProp!.required).toBe(false);
    });

    it('sets yamlFilePath to the input path', async () => {
      const filePath = path.join(FIXTURES_DIR, 'atoms/button/button.component.yml');
      const result = await parseComponentYaml(filePath);

      expect(result!.yamlFilePath).toBe(filePath);
    });
  });

  describe('error handling', () => {
    it('returns null for malformed YAML', async () => {
      const filePath = path.join(FIXTURES_DIR, 'malformed/broken.component.yml');
      const result = await parseComponentYaml(filePath);
      expect(result).toBeNull();
    });

    it('returns null for component missing name field', async () => {
      const filePath = path.join(FIXTURES_DIR, 'malformed/no-name.component.yml');
      const result = await parseComponentYaml(filePath);
      expect(result).toBeNull();
    });

    it('returns null for non-existent file', async () => {
      const result = await parseComponentYaml('/this/does/not/exist.component.yml');
      expect(result).toBeNull();
    });

    it('never throws on any input', async () => {
      const cases = [
        '/dev/null',
        '',
        '/this/does/not/exist.component.yml',
        path.join(FIXTURES_DIR, 'malformed/broken.component.yml'),
      ];

      for (const filePath of cases) {
        await expect(parseComponentYaml(filePath)).resolves.not.toThrow();
      }
    });
  });

  describe('provider inference', () => {
    it('infers provider as "example" from fixture paths', async () => {
      const filePath = path.join(FIXTURES_DIR, 'atoms/button/button.component.yml');
      const result = await parseComponentYaml(filePath);
      expect(result!.provider).toBe('example');
    });
  });
});
