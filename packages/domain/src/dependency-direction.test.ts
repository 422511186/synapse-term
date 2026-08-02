/**
 * 依赖方向约束测试（workspace 级守卫）
 *
 * 保护整个 monorepo 的分层边界：
 *   domain ← protocol ← infrastructure ← services/tooling ← platform-kernel/application ← apps
 * 只检查生产依赖（dependencies）；devDependencies 仅允许测试夹具
 * （如 test-kit、terminal-service 测试用到的 platform-kernel），不构成运行期依赖环。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(import.meta.dirname, '../../..');
const PACKAGES_ROOT = join(REPO_ROOT, 'packages');

/** 各包允许依赖的同仓库生产包（依据架构文档第 3 节依赖方向） */
const ALLOWED_DEPENDENCIES: Record<string, string[]> = {
  domain: [],
  protocol: ['domain'],
  infrastructure: ['domain', 'protocol'],
  tooling: ['domain', 'protocol'],
  'terminal-service': ['domain', 'infrastructure', 'protocol'],
  'model-providers': ['domain', 'infrastructure', 'protocol'],
  'platform-kernel': ['domain', 'infrastructure', 'protocol', 'terminal-service', 'tooling'],
  'agent-service': ['domain', 'infrastructure', 'model-providers', 'protocol'],
  application: [
    'agent-service',
    'domain',
    'infrastructure',
    'model-providers',
    'platform-kernel',
    'protocol',
    'terminal-service',
    'tooling',
  ],
  'ui-platform': [],
  'test-kit': ['domain'],
};

interface PackageManifest {
  name: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/** 读取 packages 下所有包的 manifest，返回 { 包名 -> 生产依赖包名列表 } */
function readWorkspacePackages(): Map<string, PackageManifest> {
  const manifests = new Map<string, PackageManifest>();
  for (const dir of readdirSync(PACKAGES_ROOT)) {
    const manifestPath = join(PACKAGES_ROOT, dir, 'package.json');
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as PackageManifest;
      manifests.set(manifest.name.replace('@synapse-term/', ''), manifest);
    } catch {
      // 目录中没有 package.json（如 node_modules 等），跳过
    }
  }
  return manifests;
}

/** 提取生产依赖中的同仓库包名（过滤外部 npm 包） */
function workspaceDependencies(manifest: PackageManifest): string[] {
  return Object.keys(manifest.dependencies ?? {})
    .filter((name) => name.startsWith('@synapse-term/'))
    .map((name) => name.replace('@synapse-term/', ''));
}

describe('workspace 依赖方向', () => {
  const manifests = readWorkspacePackages();

  it('每个包的生产依赖都在允许集合内（禁止反向/跨层依赖）', () => {
    const violations: string[] = [];
    for (const [name, manifest] of manifests) {
      const allowed = ALLOWED_DEPENDENCIES[name] ?? [];
      for (const dep of workspaceDependencies(manifest)) {
        if (!allowed.includes(dep)) {
          violations.push(`${name} 不允许依赖 ${dep}（允许：${allowed.join(', ') || '无'}）`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('生产依赖图无环', () => {
    const edges = new Map<string, string[]>();
    for (const [name, manifest] of manifests) {
      edges.set(name, workspaceDependencies(manifest));
    }

    const visiting = new Set<string>();
    const visited = new Set<string>();
    const stack: string[] = [];

    const visit = (node: string): string[] | null => {
      if (visiting.has(node)) {
        // 找到环：从当前节点回到起点截取环路径
        const start = stack.indexOf(node);
        return [...stack.slice(start), node];
      }
      if (visited.has(node)) return null;
      visiting.add(node);
      stack.push(node);
      for (const next of edges.get(node) ?? []) {
        const cycle = visit(next);
        if (cycle !== null) return cycle;
      }
      stack.pop();
      visiting.delete(node);
      visited.add(node);
      return null;
    };

    const cycles: string[][] = [];
    for (const node of edges.keys()) {
      const cycle = visit(node);
      if (cycle !== null) cycles.push(cycle);
    }
    expect(cycles).toEqual([]);
  });
});

describe('包间引用边界', () => {
  it('包间导入只走公共 API（不允许深路径或越界相对路径）', () => {
    const violations: string[] = [];
    const scan = (dir: string, packageName: string, srcRoot: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules') continue;
          scan(fullPath, packageName, srcRoot);
          continue;
        }
        if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) continue;
        const content = readFileSync(fullPath, 'utf8');
        const importPattern = /(?:from\s*['"]|import\(\s*['"]|import\s+['"])([^'"]+)(?:['"])/g;
        for (const match of content.matchAll(importPattern)) {
          const specifier = match[1]!;
          // 深路径：@synapse-term/<pkg>/... 应只允许 @synapse-term/<pkg>（公共 API 入口）
          if (specifier.startsWith('@synapse-term/') && specifier.split('/').length > 2) {
            violations.push(`${packageName}/${entry.name}: 深路径导入 ${specifier}`);
          }
          // 越界相对路径：允许包内子包间使用 ../（如 session -> provider），
          // 但解析后目标不得逃出本包 src 根
          if (specifier.startsWith('../')) {
            const resolved = join(dir, specifier);
            if (resolved !== srcRoot && !resolved.startsWith(`${srcRoot}${sep}`)) {
              violations.push(`${packageName}/${entry.name}: 越界相对导入 ${specifier}`);
            }
          }
        }
      }
    };

    for (const dir of readdirSync(PACKAGES_ROOT)) {
      const srcDir = join(PACKAGES_ROOT, dir, 'src');
      try {
        readdirSync(srcDir);
      } catch {
        continue; // 无 src 目录的包跳过
      }
      scan(srcDir, dir, srcDir);
    }
    expect(violations).toEqual([]);
  });
});
