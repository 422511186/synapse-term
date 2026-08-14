; Custom NSIS include for Synapse Term Windows installer.

!macro customInit
  IfSilent +2 0
    ; Not silent: show retry/cancel if cleanup fails
    MessageBox MB_RETRYCANCEL "Please close Synapse Term before upgrading." IDRETRY +2 IDCANCEL abort_install
abort_install:
    Abort
!macroend

!macro customInstall
  ; Mark installation for post-install verification
  WriteINIStr "$PLUGINSDIR\upgrade-state.ini" "app" "installed" "true"
!macroend
