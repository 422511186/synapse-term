import semver from 'semver';

import { RELEASES_URL } from '../../shared/update-contracts.js';

export interface GithubRelease {
  version: string;
  releaseNotes: string;
  assetName: string;
  assetUrl: string;
  assetSize: number;
  baseUrl: string;
}

export const MAX_UPDATE_BYTES = 512 * 1024 * 1024;

export function releaseBaseUrl(version: string): string {
  if (semver.valid(version) !== version || semver.prerelease(version) || version.includes('+')) {
    throw new Error('Invalid stable release version');
  }
  return `${RELEASES_URL}/download/v${version}/`;
}

export function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid update metadata');
  return value as Record<string, unknown>;
}

export async function githubResponse(
  url: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  let current = new URL(url);
  for (let redirects = 0; redirects < 6; redirects++) {
    if (
      current.protocol !== 'https:' ||
      current.username ||
      current.password ||
      ![
        'api.github.com',
        'github.com',
        'objects.githubusercontent.com',
        'release-assets.githubusercontent.com',
      ].includes(current.hostname)
    )
      throw new Error('Untrusted update URL');
    const response = await fetcher(current.href, {
      signal,
      redirect: 'manual',
      headers: { 'User-Agent': 'Synapse-Term-Updater' },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw new Error('Missing update redirect');
      current = new URL(location, current);
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`GitHub returned HTTP ${response.status}`);
    }
    return response;
  }
  throw new Error('Too many update redirects');
}

export async function readMetadata(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Empty update metadata');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return Buffer.concat(chunks).toString('utf8');
      size += value.byteLength;
      if (size > 2 * 1024 * 1024) throw new Error('Update metadata exceeds size limit');
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
}

export async function discoverRelease(
  platform: 'win32' | 'darwin',
  currentVersion: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<GithubRelease | null> {
  const response = await githubResponse(
    'https://api.github.com/repos/422511186/synapse-term/releases?per_page=20',
    signal,
    fetcher,
  );
  const data: unknown = JSON.parse(await readMetadata(response));
  if (!Array.isArray(data)) throw new Error('Invalid GitHub release list');
  const candidates: GithubRelease[] = [];
  for (const value of data) {
    const release = record(value);
    if (
      release.draft !== false ||
      release.prerelease !== false ||
      typeof release.tag_name !== 'string'
    )
      continue;
    const version = release.tag_name.startsWith('v') ? release.tag_name.slice(1) : '';
    if (
      semver.valid(version) !== version ||
      semver.prerelease(version) ||
      version.includes('+') ||
      !semver.gt(version, currentVersion) ||
      !Array.isArray(release.assets)
    )
      continue;
    const baseUrl = releaseBaseUrl(version);
    const assetName =
      platform === 'win32'
        ? `Synapse-Term-${version}-x64-Setup.exe`
        : `Synapse-Term-${version}-arm64.dmg`;
    const names =
      platform === 'win32'
        ? [assetName, `${assetName}.blockmap`, 'latest.yml']
        : [assetName, 'appcast.xml'];
    const assets = release.assets.map(record);
    if (
      !names.every((name) =>
        assets.some(
          (asset) =>
            asset.name === name &&
            asset.browser_download_url === `${baseUrl}${name}` &&
            typeof asset.size === 'number' &&
            asset.size > 0 &&
            asset.size <= MAX_UPDATE_BYTES,
        ),
      )
    )
      continue;
    const asset = assets.find((item) => item.name === assetName)!;
    candidates.push({
      version,
      baseUrl,
      assetName,
      assetUrl: `${baseUrl}${assetName}`,
      assetSize: asset.size as number,
      releaseNotes: typeof release.body === 'string' ? release.body.slice(0, 32_000) : '',
    });
  }
  return candidates.sort((a, b) => semver.rcompare(a.version, b.version))[0] ?? null;
}
