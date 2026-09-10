import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const script = fileURLToPath(new URL('./check-doc-links.mjs', import.meta.url));

describe('documentation link check', () => {
  it('accepts local Markdown targets and ignores external URLs and code examples', async () => {
    const root = await mkdtemp(join(tmpdir(), 'synapse-doc-links-'));
    try {
      await mkdir(join(root, 'docs', 'maintainers'), { recursive: true });
      await writeFile(join(root, 'docs', 'guide.md'), '# Guide\n');
      await writeRequiredReleaseDocumentation(root);
      await writeFile(join(root, 'AGENTS.md'), '[Guide](docs/guide.md)\n');
      await writeFile(
        join(root, 'README.md'),
        [
          '# Project',
          '',
          '[Guide](docs/guide.md#guide)',
          '[External](https://example.com/docs)',
          '',
          '```markdown',
          '[Example only](docs/missing.md)',
          '```',
        ].join('\n'),
      );

      const result = run(root);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Checked 4 Markdown files');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('reports every missing local target with its source line', async () => {
    const root = await mkdtemp(join(tmpdir(), 'synapse-doc-links-'));
    try {
      await mkdir(join(root, 'docs', 'maintainers'), { recursive: true });
      await writeRequiredReleaseDocumentation(root);
      await writeFile(
        join(root, 'README.md'),
        ['# Project', '', '[Missing](docs/missing.md)', '[Also missing](docs/other.md)'].join('\n'),
      );

      const result = run(root);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('README.md:3 -> docs/missing.md');
      expect(result.stderr).toContain('README.md:4 -> docs/other.md');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('checks links in the root AGENTS.md routing file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'synapse-doc-links-'));
    try {
      await mkdir(join(root, 'docs', 'maintainers'), { recursive: true });
      await writeRequiredReleaseDocumentation(root);
      await writeFile(join(root, 'AGENTS.md'), '[Missing](docs/missing.md)\n');

      const result = run(root);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('AGENTS.md:1 -> docs/missing.md');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('requires the fixed macOS unsigned-build instruction in the canonical release-notes guide', async () => {
    const root = await mkdtemp(join(tmpdir(), 'synapse-doc-links-'));
    try {
      await mkdir(join(root, 'docs', 'maintainers'), { recursive: true });
      await writeFile(join(root, 'README.md'), '# Project\n');
      await writeFile(join(root, 'docs', 'maintainers', 'release-notes.md'), '# Release notes\n');

      const result = run(root);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        'docs/maintainers/release-notes.md is missing the fixed macOS unsigned-build instruction.',
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

async function writeRequiredReleaseDocumentation(root) {
  await writeFile(
    join(root, 'docs', 'maintainers', 'release-notes.md'),
    'xattr -dr com.apple.quarantine "/Applications/Synapse Term.app"\n',
  );
}

function run(root) {
  return spawnSync(process.execPath, [script, root], {
    cwd: root,
    encoding: 'utf8',
  });
}
