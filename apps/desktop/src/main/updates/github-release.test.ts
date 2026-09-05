import { describe, expect, it } from 'vitest';

import { discoverRelease } from './github-release.js';

describe('GitHub release discovery', () => {
  it('only selects complete stable releases for the exact platform', async () => {
    const release = (version: string, names: string[], extra = {}) => ({
      tag_name: `v${version}`,
      draft: false,
      prerelease: false,
      body: '<script>plain text</script>',
      assets: names.map((name) => ({
        name,
        size: 100,
        browser_download_url: `https://github.com/422511186/synapse-term/releases/download/v${version}/${name}`,
      })),
      ...extra,
    });
    const fetcher: typeof fetch = async () =>
      Response.json([
        release('0.8.0', ['Synapse-Term-0.8.0-arm64.dmg', 'appcast.xml']),
        release('0.7.0', ['Synapse-Term-0.7.0-x64-Setup.exe', 'latest.yml']),
        release('0.6.0', [
          'Synapse-Term-0.6.0-x64-Setup.exe',
          'Synapse-Term-0.6.0-x64-Setup.exe.blockmap',
          'latest.yml',
        ]),
        release(
          '0.9.0',
          [
            'Synapse-Term-0.9.0-x64-Setup.exe',
            'Synapse-Term-0.9.0-x64-Setup.exe.blockmap',
            'latest.yml',
          ],
          { prerelease: true },
        ),
      ]);
    expect(
      await discoverRelease('win32', '0.5.1', new AbortController().signal, fetcher),
    ).toMatchObject({ version: '0.6.0', releaseNotes: '<script>plain text</script>' });
  });
});
