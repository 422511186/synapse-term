; Custom NSIS include for Synapse Term Windows installer.

!macro customInstall
  ; Mark installation for post-install verification
  WriteINIStr "$PLUGINSDIR\upgrade-state.ini" "app" "installed" "true"
!macroend
