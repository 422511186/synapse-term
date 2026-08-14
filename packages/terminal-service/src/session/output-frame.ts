export const TERMINAL_OUTPUT_FRAME_BYTES = 32 * 1024;

export function splitUtf8(data: string, maxBytes: number): string[] {
  if (data.length === 0 || maxBytes < 1) return [];
  const chunks: string[] = [];
  let current = '';
  let currentBytes = 0;
  for (const character of data) {
    const size = Buffer.byteLength(character, 'utf8');
    if (currentBytes + size > maxBytes && current.length > 0) {
      chunks.push(current);
      current = '';
      currentBytes = 0;
    }
    current += character;
    currentBytes += size;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}
