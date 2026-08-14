import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

if (process.platform !== 'darwin') {
  throw new Error('icon generation currently requires macOS (sips + iconutil)');
}

const workspace = resolve(import.meta.dirname, '..');
const svg = join(workspace, 'apps/desktop/src/renderer/assets/synapse-term-logo.svg');
const png512 = join(workspace, '.tmp-icon-512.png');
const png1024 = join(workspace, 'build/icon.png');
const iconset = join(workspace, 'build/icon.iconset');
const icns = join(workspace, 'build/icon.icns');

mkdirSync(join(workspace, 'build'), { recursive: true });
rmSync(iconset, { recursive: true, force: true });

execFileSync('sips', ['-s', 'format', 'png', svg, '--out', png512], { stdio: 'inherit' });
execFileSync('sips', ['-z', '1024', '1024', png512, '--out', png1024], { stdio: 'inherit' });
rmSync(png512, { force: true });

mkdirSync(iconset, { recursive: true });
for (const size of [16, 32, 128, 256, 512]) {
  const base = join(iconset, `icon_${size}x${size}.png`);
  const retina = join(iconset, `icon_${size}x${size}@2x.png`);
  execFileSync('sips', ['-z', String(size), String(size), png1024, '--out', base], {
    stdio: 'ignore',
  });
  execFileSync('sips', ['-z', String(size * 2), String(size * 2), png1024, '--out', retina], {
    stdio: 'ignore',
  });
}
execFileSync(
  'sips',
  ['-z', '1024', '1024', png1024, '--out', join(iconset, 'icon_512x512@2x.png')],
  {
    stdio: 'ignore',
  },
);
execFileSync('iconutil', ['-c', 'icns', iconset, '-o', icns], { stdio: 'inherit' });
rmSync(iconset, { recursive: true, force: true });

console.log(`generated ${png1024} and ${icns}`);
