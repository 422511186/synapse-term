# Agent Tools Are Scoped to One Terminal Session

An MVP Agent Task receives capabilities only for its single selected Terminal Session and cannot directly access local files, local processes, browsers, network clients, or plugin tools. This keeps effects visible in the terminal and gives policy and audit one capability boundary; additional local or plugin tools require a separate future security design.
