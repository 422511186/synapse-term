# Layered Terminal Output Retention

The Core will retain a bounded raw output journal while a Session is active and for a short recovery window, then remove it according to a configurable cleanup policy. Long-lived audit storage will keep structured commands, approvals, tool calls, exit results, and timestamps rather than complete terminal transcripts, reducing secret exposure while preserving accountability.
