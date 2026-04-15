import * as fs from 'fs';
import * as path from 'path';
import type { TwigFileEntry } from './types.js';

/**
 * Recursively walks a directory tree and returns absolute paths of all
 * `*.component.yml` files found under any `components/` directory.
 *
 * Never throws — all filesystem errors are caught and logged to stderr.
 *
 * @param rootDir - Absolute path to start scanning from
 * @returns Absolute paths of all discovered `.component.yml` files
 */
export async function scanForComponentFiles(rootDir: string): Promise<string[]> {
  const results: string[] = [];
  const visitedRealPaths = new Set<string>();

  await walkDirectory(rootDir, false, visitedRealPaths, results);

  return results;
}

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

// ---------------------------------------------------------------------------
// Twig template file scanner
// ---------------------------------------------------------------------------

/**
 * Recursively walks a directory tree and returns `TwigFileEntry` records for
 * all `*.twig` files found under any `templates/` directory.
 *
 * The namespace path is derived as `@{provider}/{relative/path.twig}` where
 * `provider` is the directory segment immediately before `templates/` and the
 * relative path is everything after `templates/`.
 *
 * Used to power `@namespace/path.twig` completions for non-SDC templates.
 *
 * Never throws — all filesystem errors are caught and logged to stderr.
 *
 * @param rootDir - Absolute path to start scanning from
 * @returns TwigFileEntry records for all discovered template files
 */
export async function scanForTwigTemplateFiles(rootDir: string): Promise<TwigFileEntry[]> {
  const results: TwigFileEntry[] = [];
  const visitedRealPaths = new Set<string>();
  await walkForTwigFiles(rootDir, null, [], visitedRealPaths, results);
  return results;
}

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
        const [newProvider, newParts] = resolveTemplatesDir(entry.name, dir, provider, relPathParts);
        await walkForTwigFiles(realPath, newProvider, newParts, visitedRealPaths, results);
      } else if (stat.isFile() && provider !== null && entry.name.endsWith('.twig')) {
        results.push(makeTwigEntry(entryPath, provider, relPathParts, entry.name));
      }
      continue;
    }

    if (entry.isDirectory()) {
      const [newProvider, newParts] = resolveTemplatesDir(entry.name, dir, provider, relPathParts);
      await walkForTwigFiles(entryPath, newProvider, newParts, visitedRealPaths, results);
      continue;
    }

    if (entry.isFile() && provider !== null && entry.name.endsWith('.twig')) {
      results.push(makeTwigEntry(entryPath, provider, relPathParts, entry.name));
    }
  }
}

/**
 * Determines the new provider and relative path parts when descending into a
 * directory. When entering a `templates/` directory for the first time, sets
 * the provider from the parent directory name and resets the relative path.
 */
function resolveTemplatesDir(
  dirName: string,
  parentDir: string,
  currentProvider: string | null,
  currentParts: string[],
): [string | null, string[]] {
  if (dirName === 'templates' && currentProvider === null) {
    return [path.basename(parentDir), []];
  }
  if (currentProvider !== null) {
    return [currentProvider, [...currentParts, dirName]];
  }
  return [null, []];
}

function makeTwigEntry(
  absolutePath: string,
  provider: string,
  relPathParts: string[],
  fileName: string,
): TwigFileEntry {
  const namespacePath = `@${provider}/${[...relPathParts, fileName].join('/')}`;
  return { absolutePath, namespacePath, provider };
}
