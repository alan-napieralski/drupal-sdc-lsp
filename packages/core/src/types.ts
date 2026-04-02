/**
 * A single prop declared in a component's YAML metadata.
 */
export interface PropDefinition {
  name: string;
  type: string;
  required: boolean;
  description?: string;
  default?: unknown;
}

/**
 * A single slot declared in a component's YAML metadata.
 */
export interface SlotDefinition {
  name: string;
  description?: string;
}

/**
 * Fully-parsed metadata for a single Drupal SDC component.
 */
export interface ComponentMetadata {
  /** Machine ID in "provider:componentName" format, e.g. "numiko:wysiwyg" */
  id: string;
  /** Provider name inferred from directory structure, e.g. "numiko" */
  provider: string;
  /** Human-readable name from the YAML `name` field */
  name: string;
  description?: string;
  props: PropDefinition[];
  slots: SlotDefinition[];
  /** Absolute path to the paired .twig file, or null if it does not exist on disk */
  twigFilePath: string | null;
  /** Absolute path to the .component.yml file */
  yamlFilePath: string;
}

/**
 * A Twig file entry with its resolved namespace path.
 */
export interface TwigFileEntry {
  absolutePath: string;
  namespacePath: string;
  provider: string;
}

/**
 * Describes the cursor position as being inside a Twig include/embed with{} block.
 */
export interface InvocationContext {
  componentId: string;
  alreadyUsedKeys: string[];
}
