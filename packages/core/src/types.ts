/** A single prop declared in a component's YAML metadata. */
export interface PropDefinition {
  /** Prop name as written in the YAML. */
  name: string;
  /** Declared type, or "unknown" when absent. */
  type: string;
  /** Whether the prop is listed as required. */
  required: boolean;
  /** Optional human-readable description. */
  description?: string;
  /** Optional default value. */
  default?: unknown;
}

/** A single slot declared in a component's YAML metadata. */
export interface SlotDefinition {
  /** Slot name as written in the YAML. */
  name: string;
  /** Optional human-readable description. */
  description?: string;
}

/** Fully-parsed metadata for a single Drupal SDC component. */
export interface ComponentMetadata {
  /** Machine ID in "provider:name" format. */
  id: string;
  /** Provider name inferred from the directory structure. */
  provider: string;
  /** Human-readable name from the YAML `name` field. */
  name: string;
  /** Optional human-readable description. */
  description?: string;
  /** Props declared by the component. */
  props: PropDefinition[];
  /** Slots declared by the component. */
  slots: SlotDefinition[];
  /** Absolute path to the paired .twig file, or null if it does not exist on disk. */
  twigFilePath: string | null;
  /** Absolute path to the .component.yml file. */
  yamlFilePath: string;
}

/** A Twig file entry with its resolved namespace path. */
export interface TwigFileEntry {
  /** Absolute path to the .twig file on disk. */
  absolutePath: string;
  /** Namespace path starting with `@provider/`. */
  namespacePath: string;
  /** Provider name the file belongs to. */
  provider: string;
}

/** Describes the cursor position as being inside a Twig include/embed with{} block. */
export interface InvocationContext {
  /** ID of the component being invoked. */
  componentId: string;
  /** Prop keys already written in the with{} block. */
  alreadyUsedKeys: string[];
}
