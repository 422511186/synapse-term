export interface RedactionResult {
  text: string;
  redacted: boolean;
}

export interface RedactionStream {
  push(value: string): RedactionResult;
  flush(): RedactionResult;
  backspace(): boolean;
}

const PATTERNS: readonly RegExp[] = [
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9._-]{10,}\.[A-Za-z0-9._-]{10,}\b/g,
  /(?<=^|[\s&,])(?:api[_-]?key|apikey|token|secret|password|passwd)\s*[:=]\s*[^\s&;]+/gi,
];

const MAX_STREAM_CARRY_BYTES = 16 * 1024;

export class SecretRedactor {
  redact(value: string): RedactionResult {
    return redactValue(value);
  }

  createStream(): RedactionStream {
    return new StreamingRedactor(this);
  }
}

class StreamingRedactor implements RedactionStream {
  #pending = '';
  readonly #redactor: SecretRedactor;

  constructor(redactor: SecretRedactor) {
    this.#redactor = redactor;
  }

  push(value: string): RedactionResult {
    if (value.length === 0) return { text: '', redacted: false };
    const combined = `${this.#pending}${value}`;
    const openStart = findOpenSecretStart(combined);
    if (openStart === undefined) {
      this.#pending = '';
      return this.#redactor.redact(combined);
    }
    const pending = combined.slice(openStart);
    if (Buffer.byteLength(pending, 'utf8') > MAX_STREAM_CARRY_BYTES) {
      this.#pending = '';
      const prefix = this.#redactor.redact(combined.slice(0, openStart));
      return {
        text: `${prefix.text}[REDACTED]`,
        redacted: true,
      };
    }
    this.#pending = pending;
    return this.#redactor.redact(combined.slice(0, openStart));
  }

  flush(): RedactionResult {
    const pending = this.#pending;
    this.#pending = '';
    return this.#redactor.redact(pending);
  }

  backspace(): boolean {
    const previous = [...this.#pending].at(-1);
    if (previous === undefined) return false;
    this.#pending = this.#pending.slice(0, -previous.length);
    return true;
  }
}

function redactValue(value: string): RedactionResult {
  let text = value;
  let redacted = false;
  for (const pattern of PATTERNS) {
    text = text.replace(pattern, () => {
      redacted = true;
      return '[REDACTED]';
    });
  }
  return { text, redacted };
}

function findOpenSecretStart(value: string): number | undefined {
  const candidates = [
    /(?:AKIA|ASIA)[0-9A-Z]*$/,
    /gh[pousr]_[A-Za-z0-9]*$/,
    /Bearer\s+[A-Za-z0-9._~+/=-]*$/i,
    /eyJ[A-Za-z0-9_-]*(?:\.[A-Za-z0-9._-]*){0,2}$/,
    /(?:api[_-]?key|apikey|token|secret|password|passwd)\s*[:=]\s*[^\s&;]*$/i,
    /(?:api[_-]?key|apikey|token|secret|password|passwd)\s*$/i,
    /Bearer\s*$/i,
  ];
  for (const candidate of candidates) {
    const match = candidate.exec(value);
    if (match !== null) return match.index;
  }
  return undefined;
}
