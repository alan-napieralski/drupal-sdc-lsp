import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'yaml';
import type { ComponentMetadata, PropDefinition, SlotDefinition } from './types.js';

/**
 * Parses a Drupal SDC `.component.yml` file into a typed `ComponentMetadata` object.
 *
 * Returns `null` — never throws — for: unreadable files, malformed YAML,
 * missing `name` field, or empty files.
 *
 * @param filePath - Absolute path to the `.component.yml` file
 * @returns Parsed metadata or `null` on any failure
 */
export async function parseComponentYaml(filePath: string): Promise<ComponentMetadata | null> {
  let fileContent: string;

  try {
    fileContent = await fs.promises.readFile(filePath, 'utf-8');
  } catch (err) {
    process.stderr.write(`[warn] Could not read component YAML: ${filePath} — ${String(err)}\n`);
    return null;
  }

  if (fileContent.trim() === '') {
    process.stderr.write(`[warn] Empty component YAML file: ${filePath}\n`);
    return null;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- YAML parse returns unknown structure
  let rawYaml: any;
  try {
    rawYaml = parse(fileContent);
  } catch (err) {
    process.stderr.write(`[warn] Malformed YAML in ${filePath}: ${String(err)}\n`);
    return null;
  }

  if (rawYaml === null || typeof rawYaml !== 'object' || Array.isArray(rawYaml)) {
    process.stderr.write(`[warn] Component YAML root must be an object: ${filePath}\n`);
    return null;
  }

  const name = rawYaml['name'];
  if (typeof name !== 'string' || name.trim() === '') {
    process.stderr.write(`[warn] Missing or invalid "name" field in: ${filePath}\n`);
    return null;
  }

  const description = typeof rawYaml['description'] === 'string'
    ? rawYaml['description']
    : undefined;

  const props = extractProps(rawYaml['props'], filePath);
  const slots = extractSlots(rawYaml['slots'], filePath);
  const provider = inferProvider(filePath);
  const componentDirName = path.basename(path.dirname(filePath));
  const id = `${provider}:${componentDirName}`;
  const twigFilePath = await resolveTwigFilePath(filePath);

  return {
    id,
    provider,
    name: name.trim(),
    description,
    props,
    slots,
    twigFilePath,
    yamlFilePath: filePath,
  };
}

/**
 * Extracts prop definitions from the raw YAML `props` field.
 * Returns an empty array if the field is absent or has an unexpected shape.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- parsing raw YAML
function extractProps(propsYaml: any, filePath: string): PropDefinition[] {
  if (propsYaml === undefined || propsYaml === null) {
    return [];
  }

  if (typeof propsYaml !== 'object' || Array.isArray(propsYaml)) {
    process.stderr.write(`[warn] "props" must be an object in: ${filePath}\n`);
    return [];
  }

  const properties = propsYaml['properties'];
  if (properties === undefined || properties === null) {
    return [];
  }

  if (typeof properties !== 'object' || Array.isArray(properties)) {
    process.stderr.write(`[warn] "props.properties" must be an object in: ${filePath}\n`);
    return [];
  }

  const requiredNames: string[] = Array.isArray(propsYaml['required'])
    ? (propsYaml['required'] as unknown[]).filter((v): v is string => typeof v === 'string')
    : [];

  const result: PropDefinition[] = [];

  for (const [propName, propSchema] of Object.entries(properties)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- raw YAML shape
    const schema = propSchema as any;
    const type = typeof schema?.['type'] === 'string' ? schema['type'] : 'unknown';
    const description = typeof schema?.['description'] === 'string'
      ? schema['description']
      : undefined;
    const defaultValue = schema?.['default'];

    result.push({
      name: propName,
      type,
      required: requiredNames.includes(propName),
      description,
      default: defaultValue,
    });
  }

  return result;
}

/**
 * Extracts slot definitions from the raw YAML `slots` field.
 * Returns an empty array if the field is absent or has an unexpected shape.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- parsing raw YAML
function extractSlots(slotsYaml: any, filePath: string): SlotDefinition[] {
  if (slotsYaml === undefined || slotsYaml === null) {
    return [];
  }

  if (typeof slotsYaml !== 'object' || Array.isArray(slotsYaml)) {
    process.stderr.write(`[warn] "slots" must be an object in: ${filePath}\n`);
    return [];
  }

  const result: SlotDefinition[] = [];

  for (const [slotName, slotSchema] of Object.entries(slotsYaml)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- raw YAML shape
    const schema = slotSchema as any;
    const description = typeof schema?.['description'] === 'string'
      ? schema['description']
      : undefined;

    result.push({ name: slotName, description });
  }

  return result;
}

/**
 * Infers the provider name by locating the `components` directory in the file path
 * and returning the segment immediately before it.
 *
 * Falls back to "unknown" with a warning if the pattern is not found.
 */
function inferProvider(filePath: string): string {
  const segments = filePath.split(path.sep);
  const componentsIndex = segments.lastIndexOf('components');

  if (componentsIndex <= 0) {
    process.stderr.write(`[warn] Could not infer provider from path: ${filePath}\n`);
    return 'unknown';
  }

  return segments[componentsIndex - 1];
}

/**
 * Resolves the paired `.twig` file path by replacing `.component.yml` extension.
 * Returns `null` if the file does not exist on disk.
 */
async function resolveTwigFilePath(yamlFilePath: string): Promise<string | null> {
  const twigPath = yamlFilePath.replace(/\.component\.yml$/, '.twig');

  try {
    await fs.promises.access(twigPath, fs.constants.F_OK);
    return twigPath;
  } catch {
    process.stderr.write(`[debug] No paired .twig file for: ${yamlFilePath}\n`);
    return null;
  }
}
