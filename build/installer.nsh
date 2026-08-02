; Custom NSIS include for Terminal Agent Windows installer.
; Reads upgrade state to preserve session and agent task data.

!macro customInit
  ; Check for existing installation and read upgrade state
  ReadINIStr $1 $0 "core" "sessions"
  ReadINIStr $2 $0 "core" "agentTasks"
  IfSilent +2 0
    ; Not silent: show retry/cancel if cleanup fails
    MessageBox MB_RETRYCANCEL "Please close Terminal Agent before upgrading." IDRETRY +2 IDCANCEL abort_install
abort_install:
    Abort
!macroend

!macro customInstall
  ; Write upgrade state for post-install verification
  WriteINIStr "$PLUGINSDIR\upgrade-state.ini" "core" "installed" "true"
!macroend
