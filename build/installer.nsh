!include "nsDialogs.nsh"

!ifndef BUILD_UNINSTALLER

Var desktopShortcutCheckbox
Var createDesktopShortcut

Function desktopShortcutPageCreate
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 24u "Choose whether to create a VibeGit shortcut on your desktop."
  Pop $0
  ${NSD_CreateCheckbox} 0 32u 100% 12u "Create a desktop shortcut"
  Pop $desktopShortcutCheckbox
  ${NSD_SetState} $desktopShortcutCheckbox ${BST_CHECKED}
  nsDialogs::Show
FunctionEnd

Function desktopShortcutPageLeave
  ${NSD_GetState} $desktopShortcutCheckbox $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $createDesktopShortcut "true"
  ${Else}
    StrCpy $createDesktopShortcut "false"
  ${EndIf}
FunctionEnd

!macro customPageAfterChangeDir
  Page custom desktopShortcutPageCreate desktopShortcutPageLeave
!macroend

!macro customInstall
  ${If} $createDesktopShortcut == "true"
    CreateShortCut "$DESKTOP\${SHORTCUT_NAME}.lnk" "$INSTDIR\${APP_FILENAME}.exe" "" "$INSTDIR\${APP_FILENAME}.exe" 0 "" "" "${APP_DESCRIPTION}"
  ${EndIf}
!macroend

!endif
