export interface SecretMatch {
  start: number;
  end: number;
  label: string;
}

export interface SecretDetector {
  name: string;
  detect(value: string): readonly SecretMatch[];
}

export interface RedactionResult {
  text: string;
  redacted: boolean;
  detectorError?: boolean;
}

export class ProtectedInputController {
  readonly #write: (value: string) => Promise<void> | void;
  #active = false;

  constructor(write: (value: string) => Promise<void> | void) {
    this.#write = write;
  }

  get active(): boolean {
    return this.#active;
  }

  get history(): readonly string[] {
    return [];
  }

  async enter(): Promise<void> {
    this.#active = true;
  }

  async leave(): Promise<void> {
    this.#active = false;
  }

  async send(value: string): Promise<void> {
    if (!this.#active) throw new Error('protected input is not active');
    await this.#write(value);
  }
}

export class SecretRedactor {
  readonly #detectors: readonly SecretDetector[];

  constructor(options: { detectors?: readonly SecretDetector[] } = {}) {
    this.#detectors = options.detectors ?? defaultDetectors;
  }

  redact(value: string): RedactionResult {
    const matches: Array<SecretMatch & { detector: string }> = [];
    for (const detector of this.#detectors) {
      let detected: readonly SecretMatch[];
      try {
        detected = detector.detect(value);
      } catch {
        return { text: '[REDACTED:detector-error]', redacted: true, detectorError: true };
      }
      for (const match of detected) {
        if (
          !Number.isInteger(match.start) ||
          !Number.isInteger(match.end) ||
          match.start < 0 ||
          match.end <= match.start ||
          match.end > value.length
        ) {
          return { text: '[REDACTED:detector-error]', redacted: true, detectorError: true };
        }
        matches.push({ ...match, detector: detector.name });
      }
    }
    if (matches.length === 0) return { text: value, redacted: false };

    const merged = mergeMatches(matches);
    let text = '';
    let cursor = 0;
    for (const match of merged) {
      text += value.slice(cursor, match.start);
      text += '[REDACTED]';
      cursor = match.end;
    }
    text += value.slice(cursor);
    return { text, redacted: true };
  }
}

const defaultDetectors: readonly SecretDetector[] = [
  {
    name: 'private-key',
    detect: (value) =>
      matchesFor(
        value,
        /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
        'private-key',
      ),
  },
  {
    name: 'bearer-token',
    detect: (value) =>
      matchesFor(value, /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'bearer-token').map((match) => {
        const text = value.slice(match.start, match.end);
        const whitespace = text.search(/\s+/);
        const offset =
          whitespace < 0 ? 0 : whitespace + (text.slice(whitespace).match(/^\s+/)?.[0].length ?? 0);
        return { ...match, start: match.start + offset };
      }),
  },
  {
    name: 'secret-assignment',
    detect: (value) =>
      matchesFor(
        value,
        /\b(?:api[_-]?key|token|password|passphrase|secret)\s*[:=]\s*[^\s,;]+/gi,
        'secret-assignment',
      ).map((match) => {
        const text = value.slice(match.start, match.end);
        const separator = text.match(/[:=]\s*/);
        const offset = separator?.index ?? 0;
        return { ...match, start: match.start + offset + (separator?.[0].length ?? 0) };
      }),
  },
];

function matchesFor(value: string, pattern: RegExp, label: string): SecretMatch[] {
  return [...value.matchAll(pattern)].flatMap((match) => {
    const start = match.index;
    return start === undefined ? [] : [{ start, end: start + match[0].length, label }];
  });
}

function mergeMatches(matches: readonly SecretMatch[]): SecretMatch[] {
  const sorted = [...matches].sort(
    (left, right) => left.start - right.start || right.end - left.end,
  );
  const merged: SecretMatch[] = [];
  for (const match of sorted) {
    const previous = merged.at(-1);
    if (previous !== undefined && match.start <= previous.end) {
      previous.end = Math.max(previous.end, match.end);
    } else {
      merged.push({ ...match });
    }
  }
  return merged;
}
