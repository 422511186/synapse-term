# Unknown Commands Require Approval

Only commands that deterministic policy rules can classify as safely read-only may run without user approval. Model-provided risk labels are advisory, and any unknown, ambiguous, state-changing, privileged, or destructive command is routed through the approval flow; this accepts false positives in exchange for preventing probabilistic classification from becoming the security boundary.
