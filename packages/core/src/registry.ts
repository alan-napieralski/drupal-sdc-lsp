import * as path from 'path';
import { scanForComponentFiles } from './scanner.js';
import { parseComponentYaml } from './parser.js';
import type { ComponentMetadata } from './types.js';

/**
 * In-memory index of all Drupal SDC components discovered in a workspace.
 *
 * All lookup methods are synchronous — safe to call on hot paths.
 * The `readyPromise` gate prevents race conditions at startup.
 */
export class SDCRegistry {
  private indexById: Map<string, ComponentMetadata> = new Map();
  private indexByNamespacePath: Map<string, ComponentMetadata> = new Map();
  private indexByYamlPath: Map<string, ComponentMetadata> = new Map();

  /** Resolves when the initial index build completes. */
  readonly readyPromise: Promise<void>;
  private resolveReady!: () => void;

  constructor() {
    this.readyPromise = new Promise<void>((resolve) => {
      this.resolveReady = resolve;
    });
  }

  /**
   * Scans `rootDir`, parses all discovered YAML files, and populates the index.
   * Resolves `readyPromise` on completion.
   *
   * @param rootDir - Workspace root directory to scan
   */
  async build(rootDir: string): Promise<void> {
    const startTime = Date.now();
    const yamlPaths = await scanForComponentFiles(rootDir);

    let parseFailures = 0;
    for (const yamlPath of yamlPaths) {
      const metadata = await parseComponentYaml(yamlPath);
      if (metadata === null) {
        parseFailures++;
        continue;
      }
      this.indexComponent(metadata);
    }

    const duration = Date.now() - startTime;
    process.stderr.write(
      `[info] Registry built: ${this.indexById.size} components indexed, ` +
      `${parseFailures} parse failures, ${duration}ms\n`,
    );

    this.resolveReady();
  }

  /**
   * Builds a new index in temporary maps, then atomically swaps on success.
   * The old index remains fully readable throughout the rebuild.
   *
   * @param rootDir - Workspace root directory to scan
   */
  async rebuild(rootDir: string): Promise<void> {
    const startTime = Date.now();
    const tempById: Map<string, ComponentMetadata> = new Map();
    const tempByNamespacePath: Map<string, ComponentMetadata> = new Map();
    const tempByYamlPath: Map<string, ComponentMetadata> = new Map();

    const yamlPaths = await scanForComponentFiles(rootDir);
    let parseFailures = 0;

    for (const yamlPath of yamlPaths) {
      const metadata = await parseComponentYaml(yamlPath);
      if (metadata === null) {
        parseFailures++;
        continue;
      }

      tempById.set(metadata.id, metadata);
      tempByYamlPath.set(metadata.yamlFilePath, metadata);

      if (metadata.twigFilePath !== null) {
        const namespacePath = buildNamespacePath(metadata.provider, metadata.twigFilePath);
        if (namespacePath !== null) {
          tempByNamespacePath.set(namespacePath, metadata);
        }
      }
    }

    // Atomic swap — single-threaded JS makes this safe
    this.indexById = tempById;
    this.indexByNamespacePath = tempByNamespacePath;
    this.indexByYamlPath = tempByYamlPath;

    const duration = Date.now() - startTime;
    process.stderr.write(
      `[info] Registry rebuilt: ${this.indexById.size} components, ` +
      `${parseFailures} parse failures, ${duration}ms\n`,
    );
  }

  /**
   * Re-parses a single YAML file and updates its entry in-place.
   * Used by the file watcher for incremental updates.
   *
   * @param yamlFilePath - Absolute path to the changed `.component.yml` file
   */
  async updateComponent(yamlFilePath: string): Promise<void> {
    const metadata = await parseComponentYaml(yamlFilePath);
    if (metadata === null) {
      process.stderr.write(`[warn] Skipping update for unparseable component: ${yamlFilePath}\n`);
      return;
    }
    this.indexComponent(metadata);
  }

  /**
   * Removes a component from the index by its YAML file path.
   *
   * @param yamlFilePath - Absolute path to the deleted `.component.yml` file
   */
  removeComponent(yamlFilePath: string): void {
    const metadata = this.indexByYamlPath.get(yamlFilePath);
    if (metadata === undefined) {
      return;
    }

    this.indexById.delete(metadata.id);
    this.indexByYamlPath.delete(yamlFilePath);

    if (metadata.twigFilePath !== null) {
      const namespacePath = buildNamespacePath(metadata.provider, metadata.twigFilePath);
      if (namespacePath !== null) {
        this.indexByNamespacePath.delete(namespacePath);
      }
    }
  }

  /**
   * Looks up a component by its machine ID (e.g. `"example:wysiwyg"`).
   *
   * @param id - Component ID in `"provider:name"` format
   * @returns The matching component metadata, or `undefined` if not found
   */
  getById(id: string): ComponentMetadata | undefined {
    return this.indexById.get(id);
  }

  /**
   * Looks up a component by its Twig namespace path (e.g. `"@example/atoms/wysiwyg/wysiwyg.twig"`).
   *
   * @param namespacePath - Namespace path starting with `@provider/`
   * @returns The matching component metadata, or `undefined` if not found
   */
  getByNamespacePath(namespacePath: string): ComponentMetadata | undefined {
    return this.indexByNamespacePath.get(namespacePath);
  }

  /**
   * Returns all components from a specific provider.
   *
   * @param provider - Provider name (e.g. `"example"`)
   * @returns All indexed components from that provider
   */
  getByProvider(provider: string): ComponentMetadata[] {
    return Array.from(this.indexById.values()).filter(
      (component) => component.provider === provider,
    );
  }

  /**
   * Case-insensitive substring search across component IDs and names.
   *
   * @param query - Search string (case-insensitive)
   * @returns All components whose ID or name contains the query
   */
  search(query: string): ComponentMetadata[] {
    const lowerQuery = query.toLowerCase();
    return Array.from(this.indexById.values()).filter(
      (component) =>
        component.id.toLowerCase().includes(lowerQuery) ||
        component.name.toLowerCase().includes(lowerQuery),
    );
  }

  /**
   * Returns all indexed components.
   *
   * @returns Every component currently in the registry
   */
  getAllComponents(): ComponentMetadata[] {
    return Array.from(this.indexById.values());
  }

  /** Internal helper to add or update a component in all three indexes. */
  private indexComponent(metadata: ComponentMetadata): void {
    this.indexById.set(metadata.id, metadata);
    this.indexByYamlPath.set(metadata.yamlFilePath, metadata);

    if (metadata.twigFilePath !== null) {
      const namespacePath = buildNamespacePath(metadata.provider, metadata.twigFilePath);
      if (namespacePath !== null) {
        this.indexByNamespacePath.set(namespacePath, metadata);
      }
    }
  }
}

/**
 * Derives the `@provider/relative/path.twig` namespace path from a twig file's
 * absolute path and provider name.
 *
 * Returns `null` if the `components/` directory cannot be located in the path.
 */
function buildNamespacePath(provider: string, twigFilePath: string): string | null {
  const segments = twigFilePath.split(path.sep);
  const componentsIndex = segments.lastIndexOf('components');

  if (componentsIndex === -1) {
    return null;
  }

  const relativeParts = segments.slice(componentsIndex + 1);
  const relativePath = relativeParts.join('/');

  return `@${provider}/${relativePath}`;
}

/**
 * Convenience factory that creates a registry and runs the initial build.
 *
 * @param rootDir - Workspace root directory to scan
 * @returns A ready `SDCRegistry` instance (readyPromise already resolved)
 */
export async function buildRegistry(rootDir: string): Promise<SDCRegistry> {
  const registry = new SDCRegistry();
  await registry.build(rootDir);
  return registry;
}
