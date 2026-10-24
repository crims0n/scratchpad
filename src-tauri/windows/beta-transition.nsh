; SPDX-License-Identifier: GPL-3.0-or-later
;
; The published NSIS beta was current-user, x64, with publisher "github".
; A product-name change bypasses Tauri's normal previous-install detection.
; Remove that installation before copying stable files, never its app data.
; /UPDATE is essential: the v0.8.2 uninstaller explicitly disables data deletion
; in that mode, even if its delete-data checkbox state were set.

!include LogicLib.nsh

!define SCRATCHPAD_BETA_UNINSTALL "Software\Microsoft\Windows\CurrentVersion\Uninstall\Scratchpad Beta"
!define SCRATCHPAD_BETA_INSTALL "Software\github\Scratchpad Beta"

Var ScratchpadBetaDirectory
Var ScratchpadBetaName
Var ScratchpadBetaPublisher
Var ScratchpadBetaLocation
Var ScratchpadBetaCommand
Var ScratchpadBetaHandle
Var ScratchpadBetaExit

!macro ScratchpadBetaStop Message
  DetailPrint "${Message}"
  MessageBox MB_OK|MB_ICONSTOP "${Message}" /SD IDOK
  SetErrorLevel 2
  Abort
!macroend

!macro NSIS_HOOK_PREINSTALL
  ; Never run the transition for development or retained pre-1.0 beta builds.
  !if "${PRODUCTNAME}" == "Scratchpad"
  !if "${BUNDLEID}" == "io.github.crims0n.scratchpad.beta"
    ReadRegStr $ScratchpadBetaDirectory HKCU "${SCRATCHPAD_BETA_INSTALL}" ""
    ReadRegStr $ScratchpadBetaName HKCU "${SCRATCHPAD_BETA_UNINSTALL}" "DisplayName"
    ReadRegStr $ScratchpadBetaCommand HKCU "${SCRATCHPAD_BETA_UNINSTALL}" "UninstallString"
    ${If} $ScratchpadBetaName == ""
    ${AndIf} $ScratchpadBetaCommand == ""
      ; A leftover uninstaller can still delete the shared data. Stop if its
      ; registration is incomplete rather than installing beside it.
      ${If} $ScratchpadBetaDirectory != ""
      ${AndIf} ${FileExists} "$ScratchpadBetaDirectory\uninstall.exe"
        !insertmacro ScratchpadBetaStop "Scratchpad Beta has an incomplete installation record. Repair its installation before retrying. Keep its application data."
      ${EndIf}
      Goto scratchpad_beta_done
    ${EndIf}

    ReadRegStr $ScratchpadBetaPublisher HKCU "${SCRATCHPAD_BETA_UNINSTALL}" "Publisher"
    ReadRegStr $ScratchpadBetaLocation HKCU "${SCRATCHPAD_BETA_UNINSTALL}" "InstallLocation"
    ${If} $ScratchpadBetaName != "Scratchpad Beta"
    ${OrIf} $ScratchpadBetaPublisher != "github"
    ${OrIf} $ScratchpadBetaDirectory == ""
    ${OrIf} $ScratchpadBetaLocation != '$\"$ScratchpadBetaDirectory$\"'
    ${OrIf} $ScratchpadBetaCommand != '$\"$ScratchpadBetaDirectory\uninstall.exe$\"'
      !insertmacro ScratchpadBetaStop "Scratchpad Beta's installation record could not be verified. Repair its installation before retrying. Keep its application data."
    ${EndIf}
    ${IfNot} ${FileExists} "$ScratchpadBetaDirectory\uninstall.exe"
      !insertmacro ScratchpadBetaStop "Scratchpad Beta's uninstaller is missing. Repair its installation before retrying. Keep its application data."
    ${EndIf}

    IfSilent scratchpad_beta_confirmed
    MessageBox MB_OKCANCEL|MB_ICONINFORMATION "The installer will replace Scratchpad Beta and keep your notes, preferences, workspaces, and recovery data. Close Scratchpad Beta and its MCP clients before continuing." /SD IDCANCEL IDOK scratchpad_beta_confirmed
    SetErrorLevel 1
    Abort

    scratchpad_beta_confirmed:
    ; The old silent uninstaller can forcibly stop a running app. Refuse a
    ; locked executable first, including a running GUI or MCP process. Open
    ; the existing file for exclusive write access without writing any bytes.
    ${If} ${FileExists} "$ScratchpadBetaDirectory\scratchpad.exe"
      System::Call 'kernel32::CreateFileW(w "$ScratchpadBetaDirectory\scratchpad.exe", i 0x40000000, i 0, p 0, i 3, i 0, p 0) p.s'
      Pop $ScratchpadBetaHandle
      ${If} $ScratchpadBetaHandle = -1
        !insertmacro ScratchpadBetaStop "Close Scratchpad Beta and its MCP clients before retrying. The previous executable must be unlocked and writable."
      ${EndIf}
      System::Call 'kernel32::CloseHandle(p $ScratchpadBetaHandle)'
    ${EndIf}

    DetailPrint "Removing Scratchpad Beta without deleting application data..."
    ClearErrors
    ; Derive the executable from the checked directory. Never execute a
    ; registry-supplied command line. _?= must be last and unquoted so we wait
    ; for the real uninstaller instead of its temporary launcher.
    ExecWait '$\"$ScratchpadBetaDirectory\uninstall.exe$\" /S /UPDATE _?=$ScratchpadBetaDirectory' $ScratchpadBetaExit
    ${If} ${Errors}
      !insertmacro ScratchpadBetaStop "Scratchpad Beta's uninstaller could not start. Installation stopped; keep your application data and retry after repairing Beta."
    ${EndIf}
    ${If} $ScratchpadBetaExit != 0
    ${OrIf} ${FileExists} "$ScratchpadBetaDirectory\scratchpad.exe"
      !insertmacro ScratchpadBetaStop "Scratchpad Beta was not fully removed. Installation stopped; keep your application data and retry after closing or repairing Beta."
    ${EndIf}
    ReadRegStr $ScratchpadBetaName HKCU "${SCRATCHPAD_BETA_UNINSTALL}" "DisplayName"
    ${If} $ScratchpadBetaName != ""
      !insertmacro ScratchpadBetaStop "Scratchpad Beta's uninstall registration remains. Installation stopped; repair Beta before retrying and keep its application data."
    ${EndIf}

    ; An in-place uninstaller cannot remove itself. Do not leave an old
    ; executable capable of deleting the now-shared stable data.
    Delete "$ScratchpadBetaDirectory\uninstall.exe"
    ${If} ${FileExists} "$ScratchpadBetaDirectory\uninstall.exe"
      !insertmacro ScratchpadBetaStop "Scratchpad Beta's old uninstaller could not be removed. Close it and retry before installing Scratchpad. Keep application data."
    ${EndIf}
    ; Non-recursive: preserve any unrelated files in the old install folder.
    RMDir "$ScratchpadBetaDirectory"
    DeleteRegKey HKCU "${SCRATCHPAD_BETA_INSTALL}"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Scratchpad Beta"
    Delete "$SMPROGRAMS\Scratchpad Beta.lnk"
    Delete "$DESKTOP\Scratchpad Beta.lnk"
    ClearErrors

    scratchpad_beta_done:
  !endif
  !endif
!macroend
