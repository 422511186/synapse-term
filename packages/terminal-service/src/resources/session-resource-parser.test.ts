import { Buffer } from 'node:buffer';

import { describe, expect, it } from 'vitest';

import * as resourceProtocol from './session-resource-parser.js';
import {
  MAX_RESOURCE_COLLECTION_ITEMS,
  RESOURCE_PROTOCOL_PREFIX,
  parseSessionResourceOutput,
} from './session-resource-parser.js';
import { PowerShellDriver } from '../shell/shell-driver.js';

const collectedAt = '2026-07-28T10:00:00.000Z';

describe('Session resource commands', () => {
  it('splits POSIX collection into short, one-line, fixed read-only commands', () => {
    const buildCommands = (
      resourceProtocol as {
        buildSessionResourceCommands?: (dialect: 'posix' | 'powershell') => readonly string[];
      }
    ).buildSessionResourceCommands;
    const commands = buildCommands?.('posix') ?? [];

    expect(commands).toHaveLength(8);
    expect(commands.join('\n')).toContain('hostname');
    expect(commands.join('\n')).toContain('/proc/meminfo');
    expect(commands.join('\n')).toContain('df -Pk');
    expect(commands.join('\n')).toContain('/proc/net/dev');
    expect(commands.every((command) => !/[\r\n]/.test(command))).toBe(true);
    expect(commands.every((command) => command.length <= 2_048)).toBe(true);
    expect(commands.join('\n')).toContain(RESOURCE_PROTOCOL_PREFIX);
    expect(commands.join('\n')).toContain(`ta_disk_limit=${MAX_RESOURCE_COLLECTION_ITEMS}`);
    expect(commands.join('\n')).not.toMatch(/\b(?:rm|mv|cp|chmod|chown|kill|shutdown|reboot)\b/);
  });

  it('splits PowerShell collection into short, one-line, fixed read-only commands', () => {
    const buildCommands = (
      resourceProtocol as {
        buildSessionResourceCommands?: (dialect: 'posix' | 'powershell') => readonly string[];
      }
    ).buildSessionResourceCommands;
    const commands = buildCommands?.('powershell') ?? [];

    expect(commands).toHaveLength(8);
    expect(commands.join('\n')).toContain('Get-CimInstance');
    expect(commands.join('\n')).toContain('Win32_OperatingSystem');
    expect(commands.join('\n')).toContain('[IO.DriveInfo]::GetDrives');
    expect(commands.join('\n')).toContain('NetworkInterface]::GetAllNetworkInterfaces');
    expect(commands.join('\n')).not.toContain('Get-NetAdapterStatistics');
    expect(commands.every((command) => !/[\r\n]/.test(command))).toBe(true);
    expect(commands.every((command) => command.length <= 2_048)).toBe(true);
    expect(commands.join('\n')).toContain(`Select-Object -First ${MAX_RESOURCE_COLLECTION_ITEMS}`);
    expect(commands.join('\n')).toContain(RESOURCE_PROTOCOL_PREFIX);
    expect(commands.join('\n')).not.toMatch(
      /\b(?:Set|New|Remove|Clear|Enable|Disable|Restart|Stop|Start)-/,
    );
  });

  it('keeps every PowerShell resource transaction on one physical PTY line', () => {
    const buildCommands = (
      resourceProtocol as {
        buildSessionResourceCommands?: (dialect: 'posix' | 'powershell') => readonly string[];
      }
    ).buildSessionResourceCommands;
    const commands = buildCommands?.('powershell') ?? [];
    const driver = new PowerShellDriver();

    expect(commands).toHaveLength(8);
    expect(
      commands.every(
        (command, index) => !/[\r\n]/.test(driver.wrapCommand(command, `resource-${index}`)),
      ),
    ).toBe(true);
  });
});

describe('parseSessionResourceOutput', () => {
  it('parses a complete POSIX snapshot from tagged metric output', () => {
    const output = [
      `__TA_START__${line('host', text('edge-node-1'))}`,
      line('os', text('Linux'), text('6.8.12'), text('x86_64')),
      line('uptime', '86461'),
      line('cpu', '8', '37.5', '0.24', '0.18', '0.12'),
      line('memory', '17179869184', '6442450944', '10737418240'),
      line('swap', '0', '0', '0'),
      line(
        'disk',
        text('/dev/vda1'),
        text('/'),
        '107374182400',
        '42949672960',
        '64424509440',
        '40',
      ),
      line('network', text('eth0'), '123456', '654321'),
    ].join('\n');

    expect(parseSessionResourceOutput('posix', output, { collectedAt })).toEqual({
      dialect: 'posix',
      collectedAt,
      status: 'complete',
      host: available({ name: 'edge-node-1' }),
      os: available({ name: 'Linux', version: '6.8.12', architecture: 'x86_64' }),
      uptime: available({ seconds: 86_461 }),
      cpu: available({
        logicalProcessors: 8,
        usagePercent: 37.5,
        loadAverage: { oneMinute: 0.24, fiveMinutes: 0.18, fifteenMinutes: 0.12 },
      }),
      memory: available({
        totalBytes: 17_179_869_184,
        usedBytes: 6_442_450_944,
        availableBytes: 10_737_418_240,
      }),
      swap: available({ totalBytes: 0, usedBytes: 0, availableBytes: 0 }),
      disks: available([
        {
          name: '/dev/vda1',
          mountPoint: '/',
          totalBytes: 107_374_182_400,
          usedBytes: 42_949_672_960,
          availableBytes: 64_424_509_440,
          usagePercent: 40,
        },
      ]),
      network: available([{ name: 'eth0', receivedBytes: 123_456, transmittedBytes: 654_321 }]),
    });
  });

  it('parses PowerShell metric output without depending on localized labels', () => {
    const output = [
      'PS C:\\Users\\operator>',
      line('host', text('WIN-BUILD-01')),
      line('os', text('Microsoft Windows Server 2025'), text('10.0.26100'), text('64-bit')),
      line('uptime', '43210'),
      line('cpu', '16', '12.25', '', '', ''),
      line('memory', '34359738368', '8589934592', '25769803776'),
      line('swap', '4294967296', '1073741824', '3221225472'),
      line('disk', text('C:'), text('C:\\'), '536870912000', '214748364800', '322122547200', '40'),
      line('network', text('Ethernet 2'), '9000', '12000'),
    ].join('\r\n');

    expect(parseSessionResourceOutput('powershell', output, { collectedAt })).toMatchObject({
      dialect: 'powershell',
      status: 'complete',
      host: available({ name: 'WIN-BUILD-01' }),
      os: available({
        name: 'Microsoft Windows Server 2025',
        version: '10.0.26100',
        architecture: '64-bit',
      }),
      cpu: available({ logicalProcessors: 16, usagePercent: 12.25 }),
      disks: available([
        {
          name: 'C:',
          mountPoint: 'C:\\',
          totalBytes: 536_870_912_000,
          usedBytes: 214_748_364_800,
          availableBytes: 322_122_547_200,
          usagePercent: 40,
        },
      ]),
      network: available([{ name: 'Ethernet 2', receivedBytes: 9000, transmittedBytes: 12000 }]),
    });
  });

  it('keeps confirmed fields and marks missing or malformed metrics unavailable', () => {
    const output = [
      line('host', text('partial-host')),
      unavailableLine('os'),
      line('uptime', 'not-a-number'),
      line('memory', '8192', '4096', '4096'),
      unavailableLine('network'),
    ].join('\n');

    const snapshot = parseSessionResourceOutput('posix', output, { collectedAt });

    expect(snapshot.status).toBe('partial');
    expect(snapshot.host).toEqual(available({ name: 'partial-host' }));
    expect(snapshot.memory).toEqual(
      available({ totalBytes: 8192, usedBytes: 4096, availableBytes: 4096 }),
    );
    expect(snapshot.os).toEqual(
      unavailable('command_unavailable', '目标环境不支持该指标的只读采集命令'),
    );
    expect(snapshot.uptime).toEqual(unavailable('invalid_output', '目标环境返回的指标格式无效'));
    expect(snapshot.cpu).toEqual(unavailable('not_reported', '目标环境未返回该指标'));
    expect(snapshot.swap).toEqual(unavailable('not_reported', '目标环境未返回该指标'));
    expect(snapshot.disks).toEqual(unavailable('not_reported', '目标环境未返回该指标'));
    expect(snapshot.network).toEqual(
      unavailable('command_unavailable', '目标环境不支持该指标的只读采集命令'),
    );
    expect(snapshot.cpu).not.toHaveProperty('value');
    expect(snapshot.swap).not.toHaveProperty('value');
    expect(snapshot.disks).not.toHaveProperty('value');
  });

  it('returns an unavailable snapshot for output with no valid metrics', () => {
    const snapshot = parseSessionResourceOutput(
      'powershell',
      'unrelated terminal output\ncommand not found',
      { collectedAt },
    );

    expect(snapshot.status).toBe('unavailable');
    for (const metric of [
      snapshot.host,
      snapshot.os,
      snapshot.uptime,
      snapshot.cpu,
      snapshot.memory,
      snapshot.swap,
      snapshot.disks,
      snapshot.network,
    ]) {
      expect(metric).toEqual(unavailable('not_reported', '目标环境未返回该指标'));
      expect(metric).not.toHaveProperty('value');
    }
  });

  it('bounds repeated disk and network records', () => {
    const diskLines = Array.from({ length: MAX_RESOURCE_COLLECTION_ITEMS + 8 }, (_, index) =>
      line('disk', text(`disk-${index}`), text(`/mnt/${index}`), '100', '50', '50', '50'),
    );
    const networkLines = Array.from({ length: MAX_RESOURCE_COLLECTION_ITEMS + 8 }, (_, index) =>
      line('network', text(`eth${index}`), '1', '2'),
    );

    const snapshot = parseSessionResourceOutput(
      'posix',
      [...diskLines, ...networkLines].join('\n'),
      {
        collectedAt,
      },
    );

    expect(snapshot.disks).toMatchObject({ status: 'available' });
    expect(snapshot.network).toMatchObject({ status: 'available' });
    if (snapshot.disks.status === 'available') {
      expect(snapshot.disks.value).toHaveLength(MAX_RESOURCE_COLLECTION_ITEMS);
    }
    if (snapshot.network.status === 'available') {
      expect(snapshot.network.value).toHaveLength(MAX_RESOURCE_COLLECTION_ITEMS);
    }
  });

  it('prioritizes the root filesystem ahead of temporary mounts', () => {
    const snapshot = parseSessionResourceOutput(
      'posix',
      [
        line('disk', text('tmpfs'), text('/run'), '100', '10', '90', '10'),
        line('disk', text('/dev/sda2'), text('/'), '1000', '400', '550', '40'),
      ].join('\n'),
      { collectedAt },
    );

    expect(snapshot.disks).toMatchObject({ status: 'available' });
    if (snapshot.disks.status === 'available') {
      expect(snapshot.disks.value[0]).toMatchObject({ name: '/dev/sda2', mountPoint: '/' });
    }
  });
});

function line(metric: string, ...fields: string[]): string {
  return [RESOURCE_PROTOCOL_PREFIX, metric, 'ok', ...fields].join('|');
}

function unavailableLine(metric: string): string {
  return [RESOURCE_PROTOCOL_PREFIX, metric, 'unavailable', 'command_unavailable'].join('|');
}

function text(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64');
}

function available<T>(value: T): { status: 'available'; value: T } {
  return { status: 'available', value };
}

function unavailable(reason: string, message: string): object {
  return { status: 'unavailable', reason, message };
}
