# Interactive Programs Require User Takeover

The MVP Agent executes bounded Command Transactions and suspends when it detects a password prompt, pager, editor, confirmation dialogue, or other interactive terminal program. The user receives the Session Lease through User Takeover and may return it after completing the interaction; autonomous TUI operation is deliberately outside the MVP.
