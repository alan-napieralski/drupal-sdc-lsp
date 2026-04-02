import * as fs from 'fs';
import * as path from 'path';

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
