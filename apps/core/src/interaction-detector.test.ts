import { describe, expect, it } from 'vitest';

import { InteractionDetector } from './interaction-detector.js';

describe('InteractionDetector', () => {
  it.each([
    ['password', 'Password: '],
    ['confirmation', 'Continue? [y/N]'],
    ['pager', '--More--'],
    ['editor', 'Please enter the commit message for your changes'],
  ] as const)('detects %s prompts conservatively', (kind, output) => {
    expect(new InteractionDetector().feed(output)).toMatchObject({ kind });
  });

  it('detects alternate screen and complex cursor control sequences', () => {
    const detector = new InteractionDetector();
    expect(detector.feed('\u001b[?1049h')).toMatchObject({ kind: 'alternate_screen' });
    expect(detector.alternateScreen).toBe(true);
    expect(detector.feed('\u001b[2J\u001b[H')).toMatchObject({ kind: 'complex_cursor' });
  });

  it('does not treat ordinary command output or completion OSC as interaction', () => {
    const detector = new InteractionDetector();
    expect(detector.feed('status: ok\n\u001b]777;TA;nonce;0\u0007')).toBeNull();
    expect(detector.alternateScreen).toBe(false);
  });

  it('does not treat a single readline cursor redraw as an interactive takeover', () => {
    const detector = new InteractionDetector();

    expect(detector.feed('\u001b[1A')).toBeNull();
    expect(detector.feed('GIT_BASH_AGENT_READY\r\n')).toBeNull();
  });

  it('does not combine ordinary Git Bash cursor redraws from separate output chunks', () => {
    const detector = new InteractionDetector();

    expect(detector.feed('\u001b[1A')).toBeNull();
    expect(detector.feed('\u001b[1A\u001b[2K\u001b[1G')).toBeNull();
    expect(detector.feed('MINGW64_NT-10.0-17763\r\n$ ')).toBeNull();
  });
});
