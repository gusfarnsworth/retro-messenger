# Retro Messenger — Classic Vista / MSN-inspired Windows Setup

This folder is the real Tauri **NSIS installer customisation** used by the
`Retro Messenger` Windows `.exe` setup. It is not a web UI or standalone mockup.
It keeps Tauri's maintained NSIS install/uninstall/upgrade logic while branding
the entire wizard through NSIS MUI2 settings and branded image assets.

## What the installer looks like

- **Welcome page:** blue glass-like MSN/Vista sidebar with your official Retro Messenger logo, tailored introductory copy.
- **Destination page:** classic Windows setup folder picker with matching header art.
- **Start Menu:** creates a native Start Menu shortcut.
- **Install progress:** shows native extraction/install progress, with custom colours and completion text.
- **Finish page:** blue branded final screen with *Launch Retro Messenger* and *Create desktop shortcut* options.
- **Uninstaller:** uses branded header/icon, retains Tauri's standard uninstall behaviour.
- **Existing installs:** retains Tauri's same-app detection, reinstall/upgrade flow, and registered uninstall entry.
- **WebView2:** retains Tauri's framework detection/install handling.

The normal native window frame, page buttons, progress bar and installer folder
picker are real Windows/NSIS controls rather than HTML/CSS widgets. Windows 11
may use its own window-frame decorations.

## Files

- `vista-ui.nsh` — NSIS Modern UI wizard text/colours and safe installer hooks.
- `assets/vista-sidebar.bmp` — 164×314 RGB bitmap for Welcome and Finish screens.
- `assets/vista-header.bmp` — 150×57 RGB bitmap for other wizard screens.
- `preview-vista-welcome.png` — **illustrative layout preview**, not an actual Windows capture.
- `preview-vista-directory.png` — **illustrative layout preview** of folder picker.

Configured via `src-tauri/tauri.conf.json` in `bundle.windows.nsis` using
`installerHooks`, `sidebarImage`, `headerImage`, `installerIcon`, and
`uninstallerHeaderImage`.

## Build the actual public EXE on Windows

Open PowerShell in the project root, close any running Retro Messenger app, and run:

```powershell
npm install
npm run build
npm run desktop:build:windows
```

Or the equivalent direct Tauri command:

```powershell
npm run desktop:build -- --bundles nsis
```

Result:

`src-tauri\target\release\bundle\nsis\Retro Messenger_*_x64-setup.exe`

The filename may vary with the target architecture/version.

If Rust reports **Access is denied** for `target\release\retro-messenger.exe`,
quit the running app and close any `desktop:dev` sessions, then retry. No
need to delete your Rust build cache.

## Notes for a public release

- This installer is **per-user** (`installMode: "currentUser"`), so it does not
  normally require administrator approval and installs under user-local app data.
- The existing app identifier and manufacturer registry identity are preserved
  so the new branded setup can recognise prior versions.
- Sign the public installer with a trusted certificate before wide distribution;
  unsigned downloads may trigger Windows SmartScreen.
- Run the setup, **upgrade from the previous version**, uninstall, test desktop
  shortcut creation, and test WebView2 on a spare machine before release.
- This repository does not contain a precompiled `.exe` installer. NSIS/Tauri
  compilation must run on Windows.
- No Supabase migration is required for the installer UI.

## Edit the design

- To change the words/buttons/progress style: edit `vista-ui.nsh`.
- To replace art: replace the two BMPs, retaining recommended dimensions and
  RGB/BMP format. PNG will not work for MUI bitmap settings.
- To change the app setup `.ico`: change `src-tauri/icons/icon.ico`.
- The normal NSIS Windows controls cannot be replaced directly by React CSS.
  A fully non-native freeform UI would require a separate bootstrapping frontend.

References: https://v2.tauri.app/distribute/windows-installer/ and
https://nsis.sourceforge.io/Docs/Modern%20UI%202/Readme.html
