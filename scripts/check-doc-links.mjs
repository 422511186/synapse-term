import { access, readdir, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAINTAINED_MARKDOWN = new Set(['README.md', 'AGENTS.md', 'CONTRIBUTING.md', 'CONTEXT.md']);
const IGNORED_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  'dist',
  'out',
  'release',
  'coverage',
  'playwright-report',
  'test-results',
]);
const REQUIRED_DOCUMENTATION_CONTENT = [
  {
    file: 'docs/maintainers/release-notes.md',
    description: 'the fixed macOS unsigned-build instruction',
    content: 'xattr -dr com.apple.quarantine "/Applications/Synapse Term.app"',
  },
];

/**
 * Check links in the maintained project and docs Markdown files.
 * External URLs and links in fenced/inline code are intentionally ignored.
 */
export async function checkMarkdownLinks(rootDirectory) {
  const root = resolve(rootDirectory);
  const files = await collectMarkdownFiles(root);
  const brokenLinks = [];
  const missingRequiredContent = [];

  for (const file of files) {
    const source = await readFile(file, 'utf8');
    for (const link of extractLocalLinks(source)) {
      const target = resolveLink(file, link.target);
      if (target === undefined) continue;
      try {
        await access(target, constants.F_OK);
      } catch {
        brokenLinks.push({
          file: relative(root, file) || file,
          line: link.line,
          target: link.target,
        });
      }
    }
  }

  for (const requirement of REQUIRED_DOCUMENTATION_CONTENT) {
    const file = resolve(root, requirement.file);
    let source;
    try {
      source = await readFile(file, 'utf8');
    } catch {
      missingRequiredContent.push(requirement);
      continue;
    }
    if (!source.includes(requirement.content)) missingRequiredContent.push(requirement);
  }

  return { filesChecked: files.length, brokenLinks, missingRequiredContent };
}

async function collectMarkdownFiles(root) {
  const files = [];
  await walk(root, files, root);
  return files.sort();
}

async function walk(directory, files, root) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRECTORIES.has(entry.name)) await walk(path, files, root);
      continue;
    }
    if (!entry.isFile() || extname(entry.name).toLowerCase() !== '.md') continue;
    const relativePath = relative(root, path);
    if (relativePath.startsWith('docs' + sep) || MAINTAINED_MARKDOWN.has(entry.name)) {
      files.push(path);
    }
  }
}

function extractLocalLinks(source) {
  const links = [];
  let inFence = false;
  let fenceMarker = '';
  const lines = source.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fence = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fence !== null) {
      if (!inFence) {
        inFence = true;
        fenceMarker = fence[1][0];
      } else if (fence[1][0] === fenceMarker) {
        inFence = false;
        fenceMarker = '';
      }
      continue;
    }
    if (inFence) continue;

    const lineWithoutCode = maskInlineCode(line);
    const pattern = /!?(?:\[[^\]]*\])\(\s*(<[^>]*>|(?:\\.|[^)\s])+)(?:\s+[^)]*)?\)/g;
    for (const match of lineWithoutCode.matchAll(pattern)) {
      const rawTarget = match[1];
      const target = rawTarget.startsWith('<') ? rawTarget.slice(1, -1) : rawTarget;
      links.push({ line: index + 1, target });
    }
  }
  return links;
}

function maskInlineCode(line) {
  return line.replace(
    /(`+)(.*?)\1/g,
    (_match, marker, body) => `${marker}${' '.repeat(body.length)}${marker}`,
  );
}

function resolveLink(sourceFile, rawTarget) {
  if (rawTarget.length === 0 || rawTarget.startsWith('#') || rawTarget.startsWith('/')) return;
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(rawTarget)) return;

  const pathPart = rawTarget.split(/[?#]/, 1)[0];
  if (pathPart.length === 0) return;
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathPart);
  } catch {
    decodedPath = pathPart;
  }
  return resolve(dirname(sourceFile), decodedPath);
}

async function main() {
  const root = process.argv[2] ?? process.cwd();
  const result = await checkMarkdownLinks(root);
  if (result.brokenLinks.length > 0) {
    for (const link of result.brokenLinks) {
      console.error(`${link.file}:${link.line} -> ${link.target}`);
    }
    console.error(
      `Found ${result.brokenLinks.length} broken local Markdown link(s) in ${result.filesChecked} Markdown files.`,
    );
  }
  for (const requirement of result.missingRequiredContent) {
    console.error(`${requirement.file} is missing ${requirement.description}.`);
  }
  if (result.brokenLinks.length > 0 || result.missingRequiredContent.length > 0) {
    process.exitCode = 1;
    return;
  }
  console.log(`Checked ${result.filesChecked} Markdown files, no broken local links.`);
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  await main();
}
