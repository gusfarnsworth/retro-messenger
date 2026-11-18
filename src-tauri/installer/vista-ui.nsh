; Retro Messenger • Vista / Windows Live-inspired NSIS wizard design.
;
; Included before Tauri generates the MUI2 wizard pages via installerHooks.
; Keep Tauri's official installer logic intact: WebView2 prerequisites,
; install/upgrade/reinstall/uninstall, language selection, registry,
; Start Menu and desktop shortcuts, and silent/passive installs.
;
; Change welcome/finish copy here; change the bitmaps in ./assets/.
; MUI2.nsh has already been loaded by Tauri when this file is included.

!ifndef RETRO_MESSENGER_VISTA_UI
!define RETRO_MESSENGER_VISTA_UI

; Pale blue, square-edged wizard interior with navy text.
!define MUI_BGCOLOR "EDF6FF"
!define MUI_TEXTCOLOR "153D70"
!define MUI_LICENSEPAGE_BGCOLOR /windows
!define MUI_DIRECTORYPAGE_BGCOLOR "F5FAFF"
!define MUI_STARTMENUPAGE_BGCOLOR "F5FAFF"
!define MUI_INSTFILESPAGE_COLORS "215583 F6FAFF"
!define MUI_INSTFILESPAGE_PROGRESSBAR smooth

; Main Welcome splash. The custom sidebar bitmap is provided by Tauri's
; bundle.windows.nsis.sidebarImage setting (164x314, RGB BMP).
!define MUI_WELCOMEPAGE_TITLE "Welcome to Retro Messenger"
!define MUI_WELCOMEPAGE_TITLE_3LINES
!define MUI_WELCOMEPAGE_TEXT "Connect with friends, just like the good old days.$\r$\n$\r$\nThis setup wizard will install Retro Messenger on your computer.$\r$\n$\r$\nChoose an installation folder, create your shortcuts and start chatting.$\r$\n$\r$\nClick Next to continue."

; Installation folder and Start Menu choices remain real, functional pages.
!define MUI_DIRECTORYPAGE_TEXT_TOP "Choose where Retro Messenger should be installed. Setup will create the folder if it doesn't exist."
!define MUI_STARTMENUPAGE_TEXT_TOP "Choose the Start Menu folder for Retro Messenger shortcuts."

; Installation progress / completion. Tauri still performs the actual file
; copying, WebView2 checks and application registry/shortcut integration.
!define MUI_INSTFILESPAGE_FINISHHEADER_TEXT "Retro Messenger installed"
!define MUI_INSTFILESPAGE_FINISHHEADER_SUBTEXT "Your messenger is ready to launch."

; Welcome / Finish share our custom 164x314 blue-gradient artwork.
!define MUI_FINISHPAGE_TITLE "You're ready to chat!"
!define MUI_FINISHPAGE_TITLE_3LINES
!define MUI_FINISHPAGE_TEXT "Retro Messenger has been successfully installed.$\r$\n$\r$\nClick Finish to exit setup, or tick Launch Retro Messenger to start connecting with friends."
!define MUI_FINISHPAGE_RUN_TEXT "Launch Retro Messenger"
!define MUI_FINISHPAGE_BUTTON "Finish"

; Preserve Tauri's two supported finish-page actions:
;   • Launch Retro Messenger
;   • Create a desktop shortcut
; They're bound by Tauri to real NSIS functions.

!define MUI_ABORTWARNING
!define MUI_ABORTWARNING_TEXT "Do you want to cancel Retro Messenger Setup? Installation has not finished."

!endif

; Optional installer hooks run at Tauri's documented safe points.
; No custom file deletion, registry modification, elevated commands, or
; filesystem side effects beyond the normal Tauri installer are needed.
!macro NSIS_HOOK_PREINSTALL
  DetailPrint "Retro Messenger: installing application files..."
!macroend

!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "Retro Messenger: setup completed."
!macroend
