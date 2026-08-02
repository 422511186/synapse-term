const CLEAR_SCREEN = new RegExp(`${String.fromCharCode(0x1b)}\\[(?:2|3)J`);

export function containsTerminalClearSequence(data: string): boolean {
  return CLEAR_SCREEN.test(data);
}
