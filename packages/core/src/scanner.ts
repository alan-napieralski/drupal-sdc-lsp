import * as fs from 'fs';
import * as path from 'path';
import type { TwigFileEntry } from './types.js';

/**
 * Scans a directory tree and returns all SDC component YAML paths.
 * Never throws; filesystem errors are logged to stderr and skipped.
 *
 * @param rootDir - Absolute path to start scanning from
 * @returns Absolute paths of all discovered .component.yml files
 */
export async function scanForComponentFiles(rootDir: string): Promise<string[]> {
  const results: string[] = [];
  const visitedRealPaths = new Set<string>();

  await walkDirectory(rootDir, false, visitedRealPaths, results);

  return results;
}

/**
 * Recursively walks a directory, collecting .component.yml paths under components/.
 *
 * @param dir - Directory to walk
 * @param insideComponents - Whether the walk is already inside a components/ root
 * @param visitedRealPaths - Resolved symlink targets already visited
 * @param results - Accumulator for discovered .component.yml paths
 */
async function walkDirectory(
  dir: string,
  insideComponents: boolean,
  visitedRealPaths: Set<string>,
  results: string[],
): Promise<void> {
  let entries: fs.Dirent[];

  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code === 'ENOENT') {
      process.stderr.write(`[debug] Directory disappeared during scan: ${dir}\n`);
    } else if (nodeErr.code === 'EACCES') {
      process.stderr.write(`[warn] Permission denied scanning directory: ${dir}\n`);
    } else {
      process.stderr.write(`[warn] Error reading directory ${dir}: ${String(err)}\n`);
    }
    return;
  }

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);

    if (entry.isSymbolicLink()) {
      let realPath: string;
      try {
        realPath = await fs.promises.realpath(entryPath);
      } catch {
        process.stderr.write(`[debug] Could not resolve symlink: ${entryPath}\n`);
        continue;
      }

      if (visitedRealPaths.has(realPath)) {
        process.stderr.write(`[debug] Circular symlink detected, skipping: ${entryPath}\n`);
        continue;
      }

      let stat: fs.Stats;
      try {
        stat = await fs.promises.stat(realPath);
      } catch {
        process.stderr.write(`[debug] Could not stat symlink target: ${realPath}\n`);
        continue;
      }

      if (stat.isDirectory()) {
        visitedRealPaths.add(realPath);
        const isComponents = entry.name === 'components';
        await walkDirectory(realPath, insideComponents || isComponents, visitedRealPaths, results);
      } else if (stat.isFile() && insideComponents && entry.name.endsWith('.component.yml')) {
        results.push(entryPath);
      }

      continue;
    }

    if (entry.isDirectory()) {
      const isComponents = entry.name === 'components';
      await walkDirectory(entryPath, insideComponents || isComponents, visitedRealPaths, results);
      continue;
    }

    if (entry.isFile() && insideComponents && entry.name.endsWith('.component.yml')) {
      results.push(entryPath);
    }
  }
}

/**
 * Scans a directory tree and returns entries for non-SDC twig template files.
 * Namespace is `@{provider}/…`; templates/ drops the root segment, components/ keeps it.
 * Templates with a .component.yml sibling are excluded, and it never throws.
 *
 * @param rootDir - Absolute path to start scanning from
 * @returns TwigFileEntry records for all discovered non-SDC template files
 */
export async function scanForTwigTemplateFiles(rootDir: string): Promise<TwigFileEntry[]> {
  const results: TwigFileEntry[] = [];
  const visitedRealPaths = new Set<string>();
  await walkForTwigFiles(rootDir, null, [], visitedRealPaths, results);
  return results;
}

/**
 * Recursively walks a directory, collecting non-SDC twig entries with namespace paths.
 *
 * @param dir - Directory to walk
 * @param provider - Provider resolved so far, or null if not yet inside a root
 * @param relPathParts - Relative path parts accumulated so far
 * @param visitedRealPaths - Resolved symlink targets already visited
 * @param results - Accumulator for discovered twig file entries
 */
async function walkForTwigFiles(
  dir: string,
  provider: string | null,
  relPathParts: string[],
  visitedRealPaths: Set<string>,
  results: TwigFileEntry[],
): Promise<void> {
  let entries: fs.Dirent[];

  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code === 'ENOENT') {
      process.stderr.write(`[debug] Directory disappeared during scan: ${dir}\n`);
    } else if (nodeErr.code === 'EACCES') {
      process.stderr.write(`[warn] Permission denied scanning directory: ${dir}\n`);
    } else {
      process.stderr.write(`[warn] Error reading directory ${dir}: ${String(err)}\n`);
    }
    return;
  }

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);

    if (entry.isSymbolicLink()) {
      let realPath: string;
      try {
        realPath = await fs.promises.realpath(entryPath);
      } catch {
        continue;
      }

      if (visitedRealPaths.has(realPath)) continue;

      let stat: fs.Stats;
      try {
        stat = await fs.promises.stat(realPath);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        visitedRealPaths.add(realPath);
        const [newProvider, newParts] = resolveNamespaceRoot(entry.name, dir, provider, relPathParts);
        await walkForTwigFiles(realPath, newProvider, newParts, visitedRealPaths, results);
      } else if (stat.isFile() && provider !== null && entry.name.endsWith('.twig')) {
        if (!(await hasComponentYamlSibling(dir, entry.name))) {
          results.push(makeTwigEntry(entryPath, provider, relPathParts, entry.name));
        }
      }
      continue;
    }

    if (entry.isDirectory()) {
      const [newProvider, newParts] = resolveNamespaceRoot(entry.name, dir, provider, relPathParts);
      await walkForTwigFiles(entryPath, newProvider, newParts, visitedRealPaths, results);
      continue;
    }

    if (entry.isFile() && provider !== null && entry.name.endsWith('.twig')) {
      if (!(await hasComponentYamlSibling(dir, entry.name))) {
        results.push(makeTwigEntry(entryPath, provider, relPathParts, entry.name));
      }
    }
  }
}

/**
 * Determines the provider and relative path parts when descending into a directory.
 *
 * @param dirName - Name of the directory being entered
 * @param parentDir - Absolute path of the parent directory
 * @param currentProvider - Provider resolved so far, or null if not yet inside a root
 * @param currentParts - Relative path parts accumulated so far
 * @returns The updated provider and relative path parts
 */
function resolveNamespaceRoot(
  dirName: string,
  parentDir: string,
  currentProvider: string | null,
  currentParts: string[],
): [string | null, string[]] {
  if (currentProvider !== null) {
    return [currentProvider, [...currentParts, dirName]];
  }
  if (dirName === 'templates') {
    return [path.basename(parentDir), []];
  }
  if (dirName === 'components') {
    return [path.basename(parentDir), ['components']];
  }
  return [null, []];
}

/**
 * Reports whether a twig file has a sibling .component.yml, marking it as an SDC template.
 *
 * @param dir - Directory containing the twig file
 * @param twigFileName - Name of the twig file
 * @returns True if a matching .component.yml sibling exists
 */
async function hasComponentYamlSibling(dir: string, twigFileName: string): Promise<boolean> {
  const base = twigFileName.slice(0, -'.twig'.length);
  try {
    await fs.promises.access(path.join(dir, `${base}.component.yml`), fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Builds a TwigFileEntry from its path parts and provider.
 *
 * @param absolutePath - Absolute path to the twig file
 * @param provider - Provider name
 * @param relPathParts - Relative path parts from the namespace root
 * @param fileName - Twig file name
 * @returns The assembled twig file entry
 */
function makeTwigEntry(
  absolutePath: string,
  provider: string,
  relPathParts: string[],
  fileName: string,
): TwigFileEntry {
  const namespacePath = `@${provider}/${[...relPathParts, fileName].join('/')}`;
  return { absolutePath, namespacePath, provider };
}
