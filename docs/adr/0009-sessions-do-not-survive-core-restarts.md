# Sessions Do Not Survive Core Restarts

The MVP preserves Terminal Sessions across desktop UI detachment and restart, but not across termination, crash, or upgrade of the Core process that owns ConPTY. After a Core restart the system restores metadata, Agent Task history, and audit records while marking prior Sessions as interrupted; per-Session host processes and live reattachment are deferred until reliability requirements justify them.
