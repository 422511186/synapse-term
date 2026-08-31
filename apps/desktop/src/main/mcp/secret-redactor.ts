export interface RedactionResult {
  text: string;
  redacted: boolean;
}

const PATTERNS: readonly RegExp[] = [
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9._-]{10,}\.[A-Za-z0-9._-]{10,}\b/g,
  /(?<=^|[\s&,])(?:api[_-]?key|apikey|token|secret|password|passwd)\s*[:=]\s*[^\s&;]+/gi,
];

export class SecretRedactor {
  redact(value: string): RedactionResult {
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
}
