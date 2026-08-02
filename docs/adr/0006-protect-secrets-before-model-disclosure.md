# Protect Secrets Before Model Disclosure

Protected Input will never be forwarded to the Agent or persisted in terminal journals, and terminal output will pass through configurable secret detectors before entering model context or long-lived audit payloads. Automatic redaction is intentionally conservative and users may explicitly disclose a selected value for one task when it is genuinely required.
