import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { buildPosixCommand, parseCompletionFrame, shellSingleQuote } from './command-protocol.js';

const defaultWindowsBash = join(
  process.env.ProgramW6432 ?? process.env.ProgramFiles ?? '',
  'Git',
  'bin',
  'bash.exe',
);
const bashExecutable =
  process.env.TERMINAL_AGENT_BASH ??
  (process.platform === 'win32' && existsSync(defaultWindowsBash) ? defaultWindowsBash : 'bash');

function runBash(script: string) {
  return spawnSync(bashExecutable, ['--noprofile', '--norc'], {
    encoding: 'utf8',
    input: script,
  });
}

function runBashCommand(script: string) {
  return spawnSync(bashExecutable, ['--noprofile', '--norc', '-c', script], {
    encoding: 'utf8',
  });
}

describe('command protocol with a real POSIX shell', () => {
  it('round-trips arbitrary non-NUL POSIX text through one shell literal', () => {
    const shellText = fc.string({
      unit: fc.oneof(
        fc.string({ unit: 'grapheme', minLength: 1, maxLength: 1 }),
        fc.constantFrom("'", '\n', '\t', '\\', '$', ';'),
      ),
      maxLength: 64,
    });

    const values = ["single ' quote\n中文🙂\nnext line", ...fc.sample(shellText, { numRuns: 40 })];
    const script = values
      .map(
        (value) =>
          `printf '%s' ${shellSingleQuote(value)} | od -An -tx1 | tr -d ' \\n'; printf '\\n'`,
      )
      .join('\n');
    const encodedScript = Buffer.from(script).toString('base64');
    const result = runBashCommand(`eval "$(printf '%s' '${encodedScript}' | base64 -d)"`);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout.replace(/\n$/, '').split('\n')).toEqual(
      values.map((value) => Buffer.from(value).toString('hex')),
    );
  }, 60_000);

  it('emits a matching completion frame for arbitrary generated nonces', () => {
    fc.assert(
      fc.property(fc.uuid(), (nonce) => {
        const result = runBash(buildPosixCommand(':', nonce, '\n'));

        expect(result.status).toBe(0);
        expect(parseCompletionFrame(result.stdout)).toEqual({ nonce, exitCode: 0 });
      }),
      { numRuns: 20 },
    );
  }, 30_000);

  it('preserves directory and exported environment changes', () => {
    const result = runBash(
      [
        buildPosixCommand('cd / && export TA_SPIKE=kept', 'state', '\n'),
        'printf "STATE:%s:%s\\n" "$PWD" "$TA_SPIKE"',
      ].join('\n'),
    );

    expect(result.status).toBe(0);
    expect(parseCompletionFrame(result.stdout)).toEqual({ nonce: 'state', exitCode: 0 });
    expect(result.stdout).toContain('STATE:/:kept');
  });

  it('preserves quotes, multiline text, and here-doc content', () => {
    const command = `printf "%s\\n" "a'b"
cat <<'TA_EOF'
line-1
line-2
TA_EOF`;
    const result = runBash(buildPosixCommand(command, 'multiline', '\n'));

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("a'b");
    expect(result.stdout).toContain('line-1');
    expect(result.stdout).toContain('line-2');
    expect(parseCompletionFrame(result.stdout)).toEqual({ nonce: 'multiline', exitCode: 0 });
  });

  it('reports the pipeline exit status exposed by the current shell', () => {
    const result = runBash(buildPosixCommand('false | true', 'pipeline', '\n'));

    expect(parseCompletionFrame(result.stdout)).toEqual({ nonce: 'pipeline', exitCode: 0 });
  });

  it.each([
    ['set -e failure', `set -e\n${buildPosixCommand('false', 'errexit', '\n')}`, 1],
    ['exit', buildPosixCommand('exit 9', 'exit', '\n'), 9],
    ['exec', buildPosixCommand('exec printf exec-ok', 'exec', '\n'), 0],
  ])('does not fabricate a completion frame after %s', (_name, script, expectedStatus) => {
    const result = runBash(script);

    expect(result.status).toBe(expectedStatus);
    expect(parseCompletionFrame(result.stdout)).toBeNull();
  });

  it('runs an EXIT trap without corrupting the completion frame', () => {
    const result = runBash(
      buildPosixCommand("trap 'printf trap-ok' EXIT; printf body-ok", 'trap', '\n'),
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('body-ok');
    expect(result.stdout).toContain('trap-ok');
    expect(parseCompletionFrame(result.stdout)).toEqual({ nonce: 'trap', exitCode: 0 });
  });
});
