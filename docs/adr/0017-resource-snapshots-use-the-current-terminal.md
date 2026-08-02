# Resource snapshots use the current Terminal Session

Server resources are collected by explicit, read-only commands in the current Ready Session after the user requests a refresh. The product does not create an SSH or host asset model and does not auto-poll an unknown login or TUI state, so the same resource view works after SSH, a bastion hop, container entry, or a purely local shell.
