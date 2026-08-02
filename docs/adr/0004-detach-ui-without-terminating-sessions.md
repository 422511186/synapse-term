# Detach the UI Without Terminating Sessions

Closing the desktop window detaches the UI while the per-user Core keeps active Terminal Sessions and Agent Tasks alive. An explicit quit flow offers termination or continued background operation, and an idle Core may exit after the last Session ends; this preserves terminal continuity without forcing a resident process when nothing is active.
