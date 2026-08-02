/* eslint-disable no-control-regex -- ANSI terminal parsing intentionally matches ESC and C0 bytes. */

export type InteractionKind =
  'password' | 'confirmation' | 'pager' | 'editor' | 'alternate_screen' | 'complex_cursor';

export interface InteractionSignal {
  kind: InteractionKind;
  evidence: string;
}

export class InteractionDetector {
  #textTail = '';
  #escapeCarry = '';
  #alternate = false;

  get alternateScreen(): boolean {
    return this.#alternate;
  }

  feed(data: string): InteractionSignal | null {
    const input = this.#escapeCarry + data;
    this.#escapeCarry = '';

    const alternateEnter = /\u001b\[(?:\?|>)?(?:1049|47|1047)h/.exec(input);
    if (alternateEnter !== null) {
      this.#alternate = true;
      return { kind: 'alternate_screen', evidence: alternateEnter[0] };
    }
    if (/\u001b\[(?:\?|>)?(?:1049|47|1047)l/.test(input)) {
      this.#alternate = false;
    }

    // Readline routinely emits erase-line and horizontal-position controls, and Git Bash can
    // split ordinary cursor redraws across output chunks. Only a same-chunk screen reset is
    // strong evidence of a full-screen interactive takeover.
    const complexCursor = [...input.matchAll(/\u001b\[(?:\?|>)?[0-9;]*[ABCFHJSTf]/g)];
    const hasScreenReset = /\u001b\[(?:\?|>)?(?:2|3)J/.test(input);
    if (complexCursor.length >= 2 && hasScreenReset) {
      return {
        kind: 'complex_cursor',
        evidence: complexCursor.map((match) => match[0]).join(''),
      };
    }

    const visible = stripControlSequences(input);
    this.#textTail = `${this.#textTail}${visible}`.slice(-2048);

    const patterns: Array<[InteractionKind, RegExp]> = [
      ['password', /(?:password|passphrase|one[- ]time password|otp)[^\r\n]{0,48}:?\s*$/i],
      [
        'confirmation',
        /(?:\[[yYnN](?:\/[yYnN])?\]|\b(?:y\/n|yes\/no)\b|are you sure|continue\?)\s*$/i,
      ],
      ['pager', /(?:--More--|press\s+(?:q|space)|less\s+\d+%)\s*$/i],
      ['editor', /(?:please enter the commit message|^#\s+.*commit message|^\s*~\s*$)/im],
    ];
    for (const [kind, pattern] of patterns) {
      const match = pattern.exec(this.#textTail);
      if (match !== null) return { kind, evidence: match[0] };
    }
    return null;
  }

  reset(): void {
    this.#textTail = '';
    this.#escapeCarry = '';
    this.#alternate = false;
  }
}

function stripControlSequences(input: string): string {
  let value = input.replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, '');
  value = value.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '');
  value = value.replace(/\u001b[()][0-2AB]/g, '');
  value = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
  return value;
}
