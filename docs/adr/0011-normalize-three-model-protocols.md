# Normalize Three Model Protocols

Provider Profiles may select OpenAI Responses, OpenAI-compatible Chat Completions, or Anthropic Messages. The Core will adapt all three into one internal stream of text deltas, reasoning metadata when available, tool calls, usage, completion, and provider errors, preserving broad custom-endpoint compatibility without allowing provider-specific event formats to leak into Agent or UI logic.
