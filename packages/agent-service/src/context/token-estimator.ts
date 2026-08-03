import type { ModelContentPart, ModelInputItem } from '@synapse-term/model-providers';

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
  if ('role' in item) {
    return 6 + estimateTextTokens(item.role) + estimateContentTokens(item.content);
  }
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

function estimateContentTokens(content: string | readonly ModelContentPart[]): number {
  if (typeof content === 'string') return estimateTextTokens(content);
  return content.reduce(
    (total, part) => total + (part.type === 'text' ? estimateTextTokens(part.text) : 256),
    0,
  );
}

export function estimateModelItemsTokens(items: readonly ModelInputItem[]): number {
  return items.reduce((total, item) => total + estimateModelItemTokens(item), 0);
}
