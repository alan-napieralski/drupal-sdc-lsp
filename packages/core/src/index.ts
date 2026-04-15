export { scanForComponentFiles, scanForTwigTemplateFiles } from './scanner.js';
export { parseComponentYaml } from './parser.js';
export { SDCRegistry, buildRegistry } from './registry.js';
export { detectInvocationContext } from './context-detector.js';
export type {
  ComponentMetadata,
  PropDefinition,
  SlotDefinition,
  TwigFileEntry,
  InvocationContext,
} from './types.js';
