# Local Core Owns Terminal Sessions

Terminal Sessions, Agent execution, policy enforcement, and audit recording live in a per-user local Core process rather than the desktop UI process. This lets sessions survive UI restarts, reduces the UI failure domain, and creates one enforcement boundary; the cost is a versioned local IPC protocol with replay and reconnection semantics.
