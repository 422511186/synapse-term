export interface ComposerPromptHistoryState {
  index: number | undefined;
  draft: string | undefined;
}

export function appendSentPrompt(history: readonly string[], prompt: string): string[] {
  const normalized = prompt.trim();
  if (normalized === '') return [...history];
  return [normalized, ...history.filter((item) => item !== normalized)];
}

export function buildPromptHistory(
  sentHistory: readonly string[] | undefined,
  persistedMessages: readonly string[],
): string[] {
  const persistedNewestFirst = [...persistedMessages].reverse();
  return Array.from(new Set([...(sentHistory ?? []), ...persistedNewestFirst]));
}

export function movePromptHistory(
  direction: 'previous' | 'next',
  history: readonly string[],
  currentInput: string,
  state: ComposerPromptHistoryState,
): { input: string; state: ComposerPromptHistoryState } | undefined {
  if (history.length === 0) return undefined;

  if (direction === 'previous') {
    const nextIndex = state.index === undefined ? 0 : Math.min(history.length - 1, state.index + 1);
    return {
      input: history[nextIndex]!,
      state: {
        index: nextIndex,
        draft: state.draft ?? currentInput,
      },
    };
  }

  if (state.index === undefined) return undefined;
  if (state.index > 0) {
    const nextIndex = state.index - 1;
    return {
      input: history[nextIndex]!,
      state: {
        index: nextIndex,
        draft: state.draft,
      },
    };
  }

  return {
    input: state.draft ?? '',
    state: {
      index: undefined,
      draft: undefined,
    },
  };
}
