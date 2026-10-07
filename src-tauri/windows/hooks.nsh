; NSIS installer hooks (tauri.conf.json → bundle.windows.nsis.installerHooks).
;
; The installer closes a running Astali through Windows' Restart Manager, which asks a program's
; windows to close. The MCP server (`astali.exe mcp`, started by Claude Code or Claude Desktop) has no
; window: it just waits on its input, so it can't be asked and the install stops on it. These hooks run
; just before that check and end the MCP servers of this installation. Their clients start them again
; when needed. The app itself is left to the installer's usual "close Astali?" prompt.

!macro AstaliStopMcpServers
  DetailPrint "Stopping Astali MCP servers..."
  ; Only `astali.exe mcp` processes started from this installation's folder.
  nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process | Where-Object { $$_.Name -eq '${MAINBINARYNAME}.exe' -and $$_.ExecutablePath -eq '$INSTDIR\${MAINBINARYNAME}.exe' -and $$_.CommandLine -match '\smcp(\s|$$)' } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force }"`
  Pop $0
  ; Give Windows a moment to release the executable.
  Sleep 500
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro AstaliStopMcpServers
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro AstaliStopMcpServers
!macroend
