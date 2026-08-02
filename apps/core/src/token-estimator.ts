import type { ModelInputItem } from './model-adapter.js';

export function estimateTextTokens(value: string): number {
  let cjk = 0;
  let other = 0;
  for (const character of value) {
    if (
      /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u.test(character)
    ) {
      cjk += 1;
    } else {
      other += character.length;
    }
  }
  return cjk + Math.ceil(other / 4);
}

export function estimateModelItemTokens(item: ModelInputItem): number {
  if ('role' in item) return 6 + estimateTextTokens(item.role) + estimateTextTokens(item.content);
  if (item.type === 'tool_result') {
    return 10 + estimateTextTokens(item.toolCallId) + estimateTextTokens(item.content);
  }
  return (
    12 +
    estimateTextTokens(item.toolCallId) +
    estimateTextTokens(item.name) +
    estimateTextTokens(item.argumentsJson)
  );
}

export function estimateModelItemsTokens(items: readonly ModelInputItem[]): number {
  return items.reduce((total, item) => total + estimateModelItemTokens(item), 0);
}
