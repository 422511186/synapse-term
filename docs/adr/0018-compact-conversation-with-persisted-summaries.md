# Compact Conversation history with persisted summaries

When a Context Budget is exceeded, Core creates a bounded summary of older structured Model Items and uses that summary plus recent exact items for later Model Runs. Original items remain stored for audit and user-visible history; simple truncation was rejected because it silently loses decisions, while always sending the full transcript eventually violates Provider context limits.
