# Pause the Agent After UI Disconnect

If the desktop UI disconnects during a Command Transaction, the Core lets that command reach its natural completion but then marks the Agent Task suspended before another model turn or command begins. This avoids interrupting a remote operation mid-effect while preventing unattended continuation when the user can no longer observe, interrupt, or approve the task.
