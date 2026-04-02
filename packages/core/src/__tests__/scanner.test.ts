import { describe, it, expect } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { scanForComponentFiles } from '../scanner.js';

const FIXTURES_DIR = path.resolve(__dirname, '../../../../fixtures/example');

describe('scanForComponentFiles', () => {
  it('returns all .component.yml paths from the fixtures directory', async () => {
    const paths = await scanForComponentFiles(FIXTURES_DIR);

    expect(paths.length).toBeGreaterThanOrEqual(9);

    const names = paths.map((p) => path.basename(p));
    expect(names).toContain('button.component.yml');
    expect(names).toContain('card.component.yml');
    expect(names).toContain('wysiwyg.component.yml');
    expect(names).toContain('hero.component.yml');
    expect(names).toContain('footer.component.yml');
    expect(names).toContain('icon.component.yml');
  });

  it('returns absolute paths', async () => {
    const paths = await scanForComponentFiles(FIXTURES_DIR);
    for (const p of paths) {
      expect(path.isAbsolute(p)).toBe(true);
    }
  });

  it('only returns files under a components/ directory', async () => {
    const paths = await scanForComponentFiles(FIXTURES_DIR);
    for (const p of paths) {
      const segments = p.split(path.sep);
      expect(segments).toContain('components');
    }
  });

  it('includes malformed fixture files (they are under components/)', async () => {
    const paths = await scanForComponentFiles(FIXTURES_DIR);
    const names = paths.map((p) => path.basename(p));
    expect(names).toContain('broken.component.yml');
    expect(names).toContain('no-name.component.yml');
  });

  it('returns [] for a non-existent rootDir without throwing', async () => {
    const result = await scanForComponentFiles('/this/path/does/not/exist/at/all');
    expect(result).toEqual([]);
  });

  it('returns [] for a directory that has no .component.yml files', async () => {
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'sdc-test-empty-'));
    try {
      const result = await scanForComponentFiles(tempDir);
      expect(result).toEqual([]);
    } finally {
      await fs.promises.rmdir(tempDir);
    }
  });

  it('returns [] for a directory with .component.yml files not under components/', async () => {
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'sdc-test-no-comp-'));
    try {
      const subDir = path.join(tempDir, 'widgets');
      await fs.promises.mkdir(subDir);
      await fs.promises.writeFile(
        path.join(subDir, 'widget.component.yml'),
        'name: Widget\n',
      );

      const result = await scanForComponentFiles(tempDir);
      expect(result).toEqual([]);
    } finally {
      await fs.promises.rm(tempDir, { recursive: true });
    }
  });

  it('does not follow circular symlinks', async () => {
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'sdc-test-symlink-'));
    try {
      const componentsDir = path.join(tempDir, 'components');
      await fs.promises.mkdir(componentsDir);

      // Create a circular symlink: components/loop -> components
      const symlinkPath = path.join(componentsDir, 'loop');
      await fs.promises.symlink(componentsDir, symlinkPath);

      // Should not hang and should return empty (no yml files)
      const result = await scanForComponentFiles(tempDir);
      expect(Array.isArray(result)).toBe(true);
    } finally {
      await fs.promises.rm(tempDir, { recursive: true });
    }
  });

  it('handles nested component structures correctly', async () => {
    const paths = await scanForComponentFiles(FIXTURES_DIR);
    const relPaths = paths.map((p) => p.replace(FIXTURES_DIR, ''));

    // Verify atoms, molecules, organisms, shared all present
    expect(relPaths.some((p) => p.includes('atoms'))).toBe(true);
    expect(relPaths.some((p) => p.includes('molecules'))).toBe(true);
    expect(relPaths.some((p) => p.includes('organisms'))).toBe(true);
    expect(relPaths.some((p) => p.includes('shared'))).toBe(true);
  });

  it('scans 100 components in a reasonable time', async () => {
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'sdc-bench-'));
    try {
      const componentsDir = path.join(tempDir, 'components');
      await fs.promises.mkdir(componentsDir);

      const componentCount = 100;
      await Promise.all(
        Array.from({ length: componentCount }, (_, i) => {
          const dir = path.join(componentsDir, `component-${i}`);
          return fs.promises.mkdir(dir).then(() =>
            fs.promises.writeFile(
              path.join(dir, `component-${i}.component.yml`),
              `name: Component ${i}\n`,
            ),
          );
        }),
      );

      const start = Date.now();
      const result = await scanForComponentFiles(tempDir);
      const duration = Date.now() - start;

      expect(result.length).toBe(componentCount);
      expect(duration).toBeLessThan(2000);
    } finally {
      await fs.promises.rm(tempDir, { recursive: true });
    }
  });
});
