# Settings Use a Dedicated Workspace

Global configuration and audit viewing use a dedicated Settings Workspace with persistent navigation and a separate content area. This replaces the mixed settings dropdown as the primary navigation surface so configuration can grow without competing with session actions, while preserving a clear return path to the Terminal Session workspace.

## Considered Options

- Keep adding entries to the header dropdown: rejected because configuration, audit, destructive actions, and lifecycle actions already form different interaction classes.
- Use independent modal dialogs: rejected because the existing configuration pages need room for lists, forms, and operational status.

## Consequences

- The settings navigation owns provider, model, MCP, ACP, and audit destinations.
- Navigation groups those destinations under configuration, external access, and security/diagnostics; each destination remains an independent Settings Topic rather than being merged into one page.
- Session actions such as clearing an Agent conversation remain separate from configuration navigation; normal application exit owns Core termination, so the Settings Workspace has no Core shutdown destination.
