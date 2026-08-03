#!/usr/bin/env node
/**
 * 校验 .codex/skills 与 .trae/skills 的 OpenSpec 技能镜像一致性。
 *
 * 约定：两个镜像的唯一允许差异是命令前缀写法 ——
 * .codex 使用 `$openspec-*`（Codex 技能引用），.trae 使用 `/openspec-*`（Trae 斜杠命令）。
 * 将 `$openspec-` 规范化为 `/openspec-` 后，两侧必须逐字节一致，防止技能内容漂移。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SKILLS = [
  'apply-change',
  'archive-change',
  'explore',
  'propose',
  'sync-specs',
  'update-change',
];
const ROOT = process.cwd();

function normalize(codex) {
  return codex.replaceAll('$openspec-', '/openspec-');
}

let failed = false;
for (const name of SKILLS) {
  const codexPath = join(ROOT, '.codex', 'skills', `openspec-${name}`, 'SKILL.md');
  const traePath = join(ROOT, '.trae', 'skills', `openspec-${name}`, 'SKILL.md');
  if (!existsSync(codexPath) || !existsSync(traePath)) {
    console.error(`[skills-mirror] 缺少镜像文件: ${codexPath} 或 ${traePath}`);
    failed = true;
    continue;
  }
  const codex = normalize(readFileSync(codexPath, 'utf8'));
  const trae = readFileSync(traePath, 'utf8');
  if (codex !== trae) {
    failed = true;
    const codexLines = codex.split('\n');
    const traeLines = trae.split('\n');
    const firstDiff = codexLines.findIndex((line, i) => line !== traeLines[i]);
    console.error(`[skills-mirror] openspec-${name}/SKILL.md 镜像不一致（规范化前缀后仍有差异）`);
    console.error(`  .codex 第 ${firstDiff + 1} 行: ${codexLines[firstDiff]}`);
    console.error(`  .trae  第 ${firstDiff + 1} 行: ${traeLines[firstDiff]}`);
  }
}

if (failed) {
  console.error(
    '[skills-mirror] 检查失败：请同步两侧技能内容（仅允许 $openspec-* 与 /openspec-* 前缀差异）',
  );
  process.exit(1);
}
console.log(`[skills-mirror] OK: ${SKILLS.length} 个 OpenSpec 技能镜像一致（仅命令前缀差异）`);
