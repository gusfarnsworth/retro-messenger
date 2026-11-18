## v1.1.1 - Signed Windows updater integration

See **docs/WINDOWS_UPDATER_SETUP.md** for safe signing key provisioning, GitHub Releases and Windows update tests. The updater cannot publish releases until configured with your own public key and repository.

---

## v1.1.0 — Classic Games & Activities Centre

- **Games** button in private and group conversations, with opponent invitations and acceptance/decline controls. Games open in a separate Tauri window on Windows and a draggable overlay on the website.
- Ten original casual multiplayer games: Minesweeper Flags, Checkers, Noughts & Crosses, Solitaire Sprint, Four in a Row, Chess, Colour Clash, Gem Match, Sudoku Race and Word Blitz.
- Shared collaborative whiteboard for all conversation members, with pen colours, eraser, stroke undo and PNG export.
- Supabase-enforced conversation membership, game participants, turn order and basic game-move validation.
- **Required:** install `supabase/migrations/0016_games_and_activities.sql` after `0015`.
- `npm run test:games` for quick deterministic regression tests.
- See [`docs/GAMES_AND_ACTIVITIES.md`](docs/GAMES_AND_ACTIVITIES.md) for game rules, installation, limits and outstanding validation requirements.

## v1.0.4 – Compact pop-up and Windows build fix

- Fixed emoji selector appearing as an abnormally tall panel in Windows and the website.
- Reset inherited `bottom` / `right` positioning for all document-level floating pop-ups, including reactions, colour palettes and menu pop-outs.
- Private-chat and group-chat emoji selectors now use compact, consistently sized grid cells.
- Removed unused React `useEffect` import from `src/FloatingUI.tsx`, which caused `TS6133` and stopped `npm run build`.
- Unchanged: all SQL migrations, Supabase configuration, accounts, conversations, drawings and installer branding.
- `npm audit` vulnerabilities are separate from the TS build error; run `npm audit` locally to identify affected packages, and avoid `npm audit fix --force` without testing incompatible upgrades.

# Retro Messenger

A lightweight MSN/Windows XP-inspired instant messenger built with **React + TypeScript + Vite, Tauri 2 and Supabase**. The same React code runs as a website or an installable Windows desktop application.

## What's included

- Windows XP-inspired login screen, contact list and chat windows
- Email registration/sign-in, with unique usernames and display names
- Contact requests (approve/decline), remove and block
- Persisted private direct messages and realtime message updates
- Contact-only presence via restricted Supabase Realtime channels
- Personal status (Online, Away, Busy, Appear Offline)
- User-uploaded display pictures (JPG/PNG/WebP, maximum 2 MB) shown on profile, contacts and chat windows
- Web multi-chat panels and native separate Tauri chat windows
- PostgreSQL migration with Row Level Security and transactional RPCs
- Setup screen if Supabase credentials haven't been configured

## Requirements

- Node.js 20.19+ or 22.12+, npm
- A new Supabase project
- To run Tauri on Windows: Rust toolchain (rustup), Microsoft C++ Build Tools and WebView2. See https://v2.tauri.app/start/prerequisites/

## Get started

1. Create a new Supabase project at https://supabase.com/dashboard.
2. Open **SQL Editor** and execute `supabase/migrations/0001_initial.sql` once for a new project, then execute `supabase/migrations/0002_avatars.sql`, then `supabase/migrations/0003_chat_events.sql`. **Existing installs:** run only migrations you have not previously run (for this upgrade, `0003_chat_events.sql`).
3. In Supabase **Authentication → Providers → Email**, keep email confirmation enabled for production. For local testing you can configure confirmation options. Configure redirect URLs for your production web origin.
4. Copy `.env.example` to `.env` and insert your Supabase **Project URL** and **publishable key** (from Connect / API Keys). **Never put a secret or service-role key in a frontend environment variable.**
5. Run:

   ```powershell
   npm install
   npm run dev
   ```

6. Open http://127.0.0.1:1420 in a browser. Create two accounts with two different email addresses, accept a contact request and test a conversation in two browser sessions.
7. Install Windows Tauri prerequisites, then run:

   ```powershell
   npm run desktop:dev
   ```

8. To produce a browser bundle run `npm run build`; it generates `dist/`. To build Windows installers run `npm run desktop:build` on Windows.

## Website deployment

Deploy the `dist` folder to a static host (Cloudflare Pages, Vercel, Netlify, etc.) and set the same `VITE_` environment variables at build time. HTTPS is required for production. Configure web redirects/origins in Supabase Auth. For a root-relative SPA on the host, add a fallback to `index.html` if needed.

## New in v0.2 — classic conversation tools

- Emoticon palette and recognizable keyboard shortcuts, rendered from text safely (without HTML injection).
- Persistent nudges with database-enforced 15-second cooldown. The conversation shakes unless Reduced Motion is enabled in the OS.
- Blue, rose and mint conversation backgrounds and Tahoma, Comic Sans and Georgia message fonts (preferences saved on this device).
- Optional message notification sounds (browser audio may require a user interaction first).
- Download a conversation transcript as a local text file.
- Organize contacts with Friends / Family / Work / Other labels; labels are saved in this browser or desktop app, **not** synchronized across devices yet.
- Square image crop with adjustable zoom before uploading the display picture.

Apply `supabase/migrations/0003_chat_events.sql` to an existing installation before testing nudges. **This release adds classic conversation tools, but does not yet implement every historical MSN feature.**

## Current limitations and release checklist

This is an **MVP foundation**, not a production-audited messaging platform. Before a public launch:

- Test all SQL policies with separate user accounts, unauthorised users, blocked contacts, unverified signups, duplicate usernames, and concurrency.
- Implement server-side limits for invite and messaging abuse, CAPTCHA or other bot mitigation, account recovery, and account deletion workflows.
- Audit presence channel access, user data exposure, content and retention policies, and moderation/reporting needs.
- Add message pagination, unread counters, robust reconnect and acknowledgement behaviours, and accessible keyboard focus management.
- Configure a real logo/icon for Tauri bundle metadata, sign the installer, and establish update/release processes.
- Revisit desktop session handling for multiwindow use and test with packaged Windows installers.
- For scale, migrate Postgres Changes messaging to **private Realtime Broadcast** with RLS-bound channel policies.
- This version does **not** provide end-to-end encryption. Don't advertise it as end-to-end encrypted.

## Security model

- Profiles expose only public display fields; email belongs to Supabase Auth, not public profiles.
- Contact requests require the current sender, no blocks, and no duplicate pending request in the same direction.
- Users cannot insert contacts or conversation memberships directly. Database functions accept requests and create paired memberships.
- Messages can only be sent by an authenticated conversation member with a current mutual contact relationship. Participants can read historical conversations even after removal; block new messaging.
- Native desktop windows are same-origin app pages; only the `core:webview:allow-create-webview-window` permission is added to the Tauri capability.

## Useful links

- Tauri 2: https://v2.tauri.app/
- Supabase Realtime: https://supabase.com/docs/guides/realtime
- Supabase Row Level Security: https://supabase.com/docs/guides/database/postgres/row-level-security

## Display pictures / profile pictures

Open **Options → Personal Settings → Choose picture**, select a JPG, PNG or WebP of at most 2 MB, and click **Save changes**. Pictures appear in your contact list, profile panel, and conversations. The `avatars` Supabase Storage bucket is public so contacts can see the image, but uploads and deletes are limited by Storage RLS to the signed-in user's own folder. Avoid uploading private images. Removing a picture clears it from your profile; unused uploaded objects are not automatically purged in this MVP and should be cleaned up by a later maintenance task.


## New in v0.2.1

- Dedicated **Messenger Options** window with sections for **Personal**, **Fonts & appearance**, and **Sounds**.
- Customisable **interface font** and **conversation font**.
- Live font preview inside the settings window.
- Login and contacts screens adjusted to feel closer to classic MSN Messenger layouts.

Open **Options** from the contacts window to change fonts and appearance.


## New in v0.3.0

This pass adds a fuller MSN-style feature set:

- More authentic **MSN-style login layout**
- **Remember Me**, **Remember my Password**, and **Sign me in automatically** options
- Contact list grouped more like classic MSN using **Friends / Family / Work / Other** sections
- Classic-feeling **left sidebar buttons** inside the contacts window
- Chat formatting controls for **text colour**, **bold**, **italic**, and **underline**

### Notes
- The login remembers only the email/preferences in **localStorage**. **No plaintext password is stored**; Supabase session persistence is used for returning users. The “Remember my Password” option is visually retained for historical familiarity, but a credentials manager / OS keychain integration is not included.
- Message formatting is stored in the existing message body field in a backward-compatible way, so older plain-text messages still render normally.


## v0.3.1 — MSN 7.5 visual pass

- `src/msn-classic.css` supplies a cohesive Windows XP-era design layer for the login, contacts, conversation and settings surfaces.
- Compact 295px sign-in pane, 300px contact window, blue gradient window chrome, small status symbols, dense lists, and traditional conversation UI.
- Visual artwork and icons are newly drawn approximations; this is **not an asset-identical Microsoft MSN recreation**.
- Do not distribute or bundle proprietary Microsoft MSN Messenger icon/font files without permission.
- Old builds may have saved a plaintext password in localStorage. This build deletes the `retro-login-password` key on the login screen, and no longer saves passwords. For extra safety clear the old site's local storage manually if upgrading from v0.3.0.

No Supabase migration is required for this CSS-focused release.


## Version 0.4 — MSN 7.5 desktop/web feature expansion

The same React UI powers the website and the native Tauri Windows desktop application.

**Implemented in source:**
- Windows XP-inspired contact/login/chat screens, user profile pictures and editable personal messages.
- Working **File / Contacts / Actions / Tools / Help** dropdown menus and functional shortcuts.
- Browser windows with draggable title bars, movable independent conversations and settings, minimise/restore taskbar, maximise/restore, close controls, remembered positions, and CSS resize handles.
- Windows desktop **frameless Tauri windows**, including independent native conversation and settings windows, draggable title bars and OS minimise/maximise/close controls.
- Online, Away, Busy, Be Right Back, On the Phone, Out to Lunch and Appear Offline statuses (run migration 0004 first).
- Collapsible Online/Offline sections, contact categories and per-contact custom nicknames, saved in Supabase (migration 0004).
- Private direct messaging with coloured, bold, italic and underlined message text, message history export, display pictures and file messages. Existing v0.3-format messages remain readable.
- Personal message sounds, simple classic emoticon substitutions, Nudge, animated **Wink**, typing indicators (private Realtime broadcast), and private file transfers of images, PDF, TXT or ZIP up to 10 MB.
- Sign-in interface with Remember Me (email), Remember Password (Supabase session, **never plaintext password**) and Sign In Automatically (from remembered session).

### Upgrade steps
1. Back up your existing project and preserve `.env`.
2. Install this v0.4 source over the old source.
3. In Supabase SQL Editor, run **`supabase/migrations/0004_msn_features.sql`** after `0001`, `0002`, `0003` have already been applied. Do not re-run older migrations on an existing database.
4. Run `npm install` then `npm run dev`. For Windows Tauri prerequisites and `npm run desktop:dev`, see the main setup instructions.
5. Test with two accounts on **different devices or browsers**: contact requests, status, formatted message, Wink, typing and private file transfer.

### What is not yet 1:1 with historical MSN Messenger
This is a development build, not a feature-for-feature recreation. The following are **not finished**:
- Webcam/voice calling (excluded by request), voice clips, digital ink/handwriting and synchronized photo-slideshow sessions.
- Multiplayer built-in games and activity invitations, custom-uploaded emoticon packs, dynamic avatars/backgrounds and true historical animation assets.
- Full Hotmail/Windows Live services integration, legacy protocol compatibility, original Microsoft icons/sounds/assets or original sign-in infrastructure.
- Production-grade notification badges/unread counters, background auto-away and full search/pagination; extensive accessibility and cross-device sync validation.
- Native Windows installer signing and QA across Windows versions.

**Technical verification:** source syntax/transpilation checked. The build was **not** executed successfully here because npm dependency installation timed out. Do not publish this as a production-ready messenger until `npm run build`, `npm run desktop:build` and two-user Supabase security tests pass.

### Security notes
Supabase RLS guards messages, contacts and private file paths. Do not put service-role keys in frontend variables. Files uploaded to the `transfers` bucket are private; the app generates short-lived URLs for downloads. Messages are **not** end-to-end encrypted. Public usernames and profile pictures should be treated as public to signed-in users.

## Version 0.5 — Official staff alerts and XP-style message popups

This version introduces a **secure, no-reply staff announcement system** and small
**MSN-style toast windows** on Windows (plus in-tab equivalents on the website).

### Setup — update your existing Supabase project

1. Back up your current project and `.env`. Extract the v0.5 ZIP over the old source.
2. In **Supabase SQL Editor**, run `supabase/migrations/0005_staff_alerts.sql` **once**, after migration `0004_msn_features.sql`.
3. Sign up / sign in with the account that should become a Retro Messenger administrator.
4. In **Supabase SQL Editor**, run this as the database administrator, replacing the username with your account's exact **Retro Messenger username**:

```sql
insert into public.messenger_staff(user_id, role)
select id, 'admin' from public.profiles where username = 'your_username'
on conflict(user_id) do update set role = excluded.role;
```

To add another staff member, use the same statement with `role = 'staff'` and their username. **No client can grant itself staff access**, because ordinary users have no INSERT/UPDATE access to `messenger_staff` and the sending RPC verifies the staff identity using `auth.uid()`.

5. Restart Messenger and sign in again. Staff will see a **shield icon** in the left sidebar and **Staff Announcement Console** under Tools.
6. To send an alert, choose **One username** or **Everyone**, enter a subject and message, and click **Send Staff Alert**.
7. Recipients see the notice in the **Alerts** area. It is read-only with an unread badge and **Mark read**. Everyone means all **existing** account profiles at send time (future accounts are not automatically included).

### Popup notifications

- With the **Windows Tauri app**, new direct messages and staff alerts can create an actual XP-style popup window at the **bottom-right of the current monitor's usable work area**, just above the Windows taskbar. The popup does not add a separate taskbar button, stays on top, and disappears after approximately eight seconds.
- Click a message popup to open that contact's conversation; click a staff alert to bring up the Alerts inbox.
- The **website** uses the same styled popup in the bottom-right **inside its browser tab**, because a website cannot place arbitrary popups outside the browser.
- **Options → Sounds** contains **Show MSN-style popup for messages and staff alerts** and **Test desktop popup**. Alerts also provides a test button.
- Sound and popup preferences are local per device, not shared between Windows and browser sessions.
- Broadcast alerts and messages are saved in Supabase; users who were offline can still read them later. On-line popups use Supabase Realtime Postgres Changes and require the SQL publication from the migrations.

### Security and limitations

- Staff sending is **server-authorized**, role records require manual assignment, and the database restricts alerts to their actual recipients using RLS. Users can change only the `read_at` field on their own alerts.
- The staff function allows a maximum of **10 alert sends per staff member per 15 minutes**, and limits the title to 100 characters and body to 2,500 characters.
- There is no two-way reply channel for staff alerts. Do not use staff alerts to impersonate other users.
- This is a **development update**, not a compiled `.exe` or a production-certified Windows notification implementation. Source-level syntax checks passed; full npm/Tauri builds and live two-user tests require a Windows machine with dependencies and a configured Supabase project.

### Testing checklist

1. Run `npm install`, then `npm run build`; for desktop, run `npm run desktop:dev`.
2. Grant yourself `admin` as above and send a **single-recipient** test alert to a second account.
3. Confirm only that recipient sees the alert and that it cannot be edited or replied to.
4. Send an **Everyone** test alert and confirm both accounts receive it.
5. Use **Test desktop popup** while the Tauri app is open and while it is minimised. Confirm the toast is above the taskbar, especially if you use Windows display scaling or multiple monitors.
6. Have the second account send a direct message while its chat window is closed, and confirm the popup opens the chat when clicked.
7. Check that ordinary users cannot open the staff composer or call the `send_staff_alert` RPC successfully.


## v0.5.1 — Chronological nudges and genuine Windows desktop login

This is a full source update on top of v0.5.0. There is **no new Supabase migration**.

- **Fixed: Nudge and Wink events no longer stay below all messages.** The conversation renderer combines saved messages and chat events into one timestamp-sorted timeline. A newer message now appears **under** an older nudge, even after reopening the chat.
- Conversations scroll to the newest item if you are already near the bottom. Scrolling up to read history prevents automatic jumping.
- **Fixed: native Windows sign-in is no longer inside a simulated desktop.** The Tauri sign-in screen now fills the actual app window and removes the fake blue wallpaper and fake taskbar. The original Vista/XP-inspired Messenger title bar remains functional. The browser version still has the draggable simulated desktop and taskbar.
- Existing staff alerts, bottom-right toast notifications, profile pictures, messaging, file transfers, Winks and settings are preserved.

### Update instructions

1. Back up your existing `retro-messenger` folder.
2. Unzip v0.5.1 over the project while preserving your existing `.env`.
3. Stop the existing development server (`Ctrl+C`), then run `npm install` and `npm run desktop:dev`.
4. Open the web version at `http://127.0.0.1:1420` **without starting another Vite server**.
5. Test in a conversation: **message → nudge → message**. The nudge should remain between the two messages, including after reopening the conversation.
6. Test the Windows login window: no simulated wallpaper or blue taskbar should appear behind it. The browser version remains independently movable.

### Validation

The chronological timeline helper passed standalone Node.js tests covering ordering and timestamp precision. The updated TypeScript/TSX files passed syntax/transpilation checks. A full npm/Tauri build and real Supabase two-user test have **not** been completed in this environment.


## v0.5.2 — Windows frameless UI correction

- Eliminated the **8px blue desktop margin** around the main Windows app. The narrow-width media rule was unintentionally restoring this padding in the desktop (Tauri) version.
- Removed the **extra CSS outline, corner rounding, border and shadow** around native contact, chat and settings windows. The Messenger content fills the Tauri window directly; the blue in-app title bar and its working controls remain.
- Applied the native layout class to the separate chat window route too.
- The **website is unchanged**: it keeps draggable, framed windows and the simulated taskbar.
- No Supabase migration is required. Preserve your existing `.env` when copying the updated source.
- Stop the old development process and run `npm run desktop:dev`; Vite will also serve the website at `http://127.0.0.1:1420`.


## v0.5.3 — Square-edge classic interface

- Every app window, panel, button, menu, setting, avatar frame and taskbar item now has **square corners** (both desktop and website). No rounded card/window chrome remains.
- The stylised character in the login logo and the small circular presence indicators remain rounded, because these are **illustrations/status symbols**, not rounded interface borders.
- The Windows desktop app remains edge-to-edge without the blue border/outline fixed in v0.5.2.
- Implemented as `src/square-chrome.css`, loaded **after** the original styles in `src/main.tsx`, so other MSN design details and functionality remain unchanged.
- No Supabase migration required. Keep your `.env` when replacing the project files.

To run both versions from one server: `npm run desktop:dev` and open `http://127.0.0.1:1420` in your browser.


## New in v0.5.4 — native Windows 11 square corners

Windows 11 rounds application window corners at the DWM level, even if all CSS
`border-radius` properties are zero. This version calls
`DwmSetWindowAttribute(DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_DONOTROUND)`
from the Tauri Rust backend when each window is created, including new chat
windows and notification popups. This is a Windows-only change; the website is
unchanged. The main undecorated window also disables the native shadow.

**Restart `npm run desktop:dev`** (not just browser hot reload) so Rust is
recompiled. No Supabase migration is required. This change must be verified
on Windows 11; no Windows build was run in the packaging environment.


## v0.5.5 — Tauri 2 Rust plugin build fix

Fixes Rust compiler error `E0283: type annotations needed` in
`src-tauri/src/lib.rs` with Tauri 2.12.x by explicitly specifying
`tauri::plugin::Builder::<tauri::Wry, ()>` for the Windows-only square-corner
plugin. The actual Windows DWM corner preference and other features are
unchanged. This release also aligns npm, Tauri and Cargo package versions.

Stop the currently running development process before restarting with
`npm run desktop:dev`. No `npm install`, database migration, or cache
removal is needed specifically for this fix.

Verification: inspected against Tauri plugin generic API documentation;
no Rust compiler or Windows toolchain was available in the packaging
environment.


## v0.6.0 — One-to-one System Direct Messages (No Reply)

A separate official system identity now delivers **private, one-to-one messages** to a
specific account. This is **not** the existing staff Alerts broadcast feature.

### For the administrator

1. Apply `supabase/migrations/0006_system_direct_messages.sql` in the Supabase
   SQL Editor. This must run **after migration 0005**.
2. Sign in to an account that already has `role = 'admin'` in `public.messenger_staff`.
   (If necessary, assign the role through the Supabase SQL Editor as described in
   the v0.5 staff-alert instructions.) The `staff` role is not enough for system DMs.
3. Open **Staff** in the Messenger sidebar or **Tools → Staff Messaging Console**.
4. Select **System Direct Message** (available to administrators only).
5. Enter the user's exact username, a subject, and the message, then click
   **Send System Message** and confirm the recipient.

### For the recipient

- The **Official Messenger → Retro Messenger System** contact appears whenever
  their first system message arrives. It is independent of the normal contacts list.
- Opening it shows a familiar MSN-style conversation window. Messages contain a
  timestamp, subject and body. **No composer, Reply, Nudge or file-transfer
  control is available.** The System account is not a real user profile.
- Unread system messages have a count on the system contact entry. Opening the
  thread marks them read.
- A new system message triggers the usual XP-style popup notification, subject
  to the user's existing popup/sound preferences. The popup opens the system
  thread. Website users get an in-browser toast; Tauri users get a native
  bottom-right popup. Previously received messages remain available after
  sign-out and sign-in.

### Security and delivery

- Users cannot insert into `system_direct_messages`; all sends pass through
  `send_system_direct_message`, which checks the **admin** role server-side.
- Messages are visible only to their recipient and the original sending admin.
  Ordinary staff cannot send them or read other users' messages.
- Recipients can update only their own `read_at` field; they cannot change the
  message body, subject, sender or recipient, or send a reply to this identity.
- The sending function checks exact usernames, message lengths, and applies a
  20-message-per-15-minute limit per administrator.
- Stored messages are not end-to-end encrypted; they follow the existing
  Supabase access-control model.

### Suggested smoke test (two separate accounts)

1. Have an admin send a test system message to another account via **Staff →
   System Direct Message**.
2. Confirm that the second account receives a toast and sees **Retro Messenger
   System** with unread count in the contact list.
3. Open the thread and confirm the message can be read **but not replied to**.
4. Send a second message and confirm chronological ordering, persistence after
   restarting, and that the first one's read marker stays read.
5. Sign in as a non-admin account and confirm it cannot access the sending UI.
   Independently verify that calling `send_system_direct_message` under a
   non-admin session is rejected by Supabase.
6. Confirm a second ordinary account cannot query the first recipient's
   messages (RLS), including after changing URL parameters.
7. Confirm the Tauri-created system window can be dragged, minimised and closed.

No changes to the old staff-alert tables or existing DMs are required. The new
migration is **required** before any System DM functionality can work.

This package has been syntax-checked, but a real Supabase integration test and a
Windows desktop build still need to be performed on a configured machine.


## v0.6.1 — Automatic personalised welcome messages

Every **new account** receives a friendly, one-time direct message from
**Retro Messenger System**. The message uses the profile's display name and
username, describes how to add friends and customise the profile, and remains
**NO REPLY**, just like other official System messages.

### Install (existing v0.6.0 projects)

1. Preserve your `.env` file and replace the project source with v0.6.1.
2. In the Supabase SQL Editor, run **only the new migration**
   `supabase/migrations/0007_personalised_welcome.sql` (requires `0006`).
3. Restart the desktop app using `npm run desktop:dev`; its web version will
   remain available at `http://127.0.0.1:1420`.
4. Register a **new test account**. Complete e-mail verification if enabled.
   Upon first sign-in the user sees **Official Messenger → Retro Messenger System**
   with their personal greeting and an unread indicator. A once-only popup is
   displayed if message popups are enabled.
5. Open the System conversation to read the message. No reply box is available.

### Implementation details

- The greeting is created by a database trigger on `public.profiles`, so it
  works whether registration happens via the website or Tauri. It does not
  rely on the client staying open.
- A partial unique index guarantees **at most one automatic welcome per user**.
  The trigger tolerates a delivery error rather than blocking account creation.
- The `message_kind` column distinguishes automated welcomes from staff-authored
  messages; existing messages are still classified as `admin`. Existing account
  messages and staff permissions are unchanged.
- **v0.6.2 correction:** the updated `0007_personalised_welcome.sql` also backfills all existing profiles on its first successful run. Subsequent runs skip accounts that already have an automated welcome.
- The greeting is queued at signup, even if the user needs to verify their
  email before signing in. The initial popup is shown once per message/device
  when enabled, while the System message itself stays saved in Supabase.

No accounts, private conversations, staff alerts, or previously sent System
messages need to be deleted or recreated.

Validation: TypeScript syntax and package structure were checked; a live
Supabase registration test and Windows installer build have not been performed
in this environment.


## v0.6.2 — Fixed welcome migration and one-time backfill

The original v0.6.1 migration had a missing dollar-quote terminator in a
`DO` block (`end;` was not followed by `$$;`), causing PostgreSQL syntax
error 42601 near the function's `begin`. The migration in this version
fixes the block terminator using named dollar-quote tags.

**Apply migration:**

1. You must have previously applied `0006_system_direct_messages.sql`.
2. Paste the **entire corrected** `supabase/migrations/0007_personalised_welcome.sql`
   into the Supabase SQL Editor and run it as a database administrator.
3. The new trigger handles accounts created afterward.
4. During this run, the migration also queues exactly one personalised
   `welcome` System DM for each existing profile that does not have one.
5. The final SELECT shows `total_accounts`, `accounts_with_welcome` and
   `accounts_missing_welcome` to confirm the result (normally 0 missing).

The backfill is intentionally **not** a repeating trigger or scheduled task.
Rerunning the script is safe because of the partial unique index on
`system_direct_messages(recipient_id)` where `message_kind = 'welcome'`.
Staff-authored System messages and regular conversations remain unchanged.

**No TypeScript changes required.** As with earlier updates, test registration
and message delivery in your Supabase environment before public release.


## New in v0.6.3

- Applied the new official Retro Messenger logo across the interface
- Updated the sign-in screen, title bars, top brand strip, About window, website taskbar, and toast notifications
- Replaced the Tauri application icon with the new logo
- Added website favicon support using the same logo

## v0.7.0 — User reporting and staff moderation queue

This version adds **Report User** and **Report Message** throughout the website and Windows desktop application. Members can report an account using a contact's **••• → Report User…** menu, the username search results, or the **Report User** action in a conversation. On individual incoming messages, click **Report message** to attach that specific message as evidence.

The report form offers reasons (harassment, hate speech, spam, scams, impersonation, inappropriate content, threats, other) and optional details. For **Other**, an explanation of at least ten characters is required. On success, a unique case reference is shown.

### Installation

1. Extract the full v0.7.0 project ZIP over your existing project, preserving your `.env` file.
2. In **Supabase → SQL Editor**, run `supabase/migrations/0008_user_reporting.sql` **after migrations 0001–0007**. This only creates reporting tables and functions; it does not delete or backfill data.
3. Start the app with `npm run desktop:dev`. The website also runs at `http://127.0.0.1:1420`.
4. Send a test message between two accounts. From the recipient account, use **Report message**, select a reason and submit.
5. Sign in with an account assigned an existing `messenger_staff` role of `staff` or `admin`. Go to **Staff → Reports**, inspect the evidence, add internal notes, and change its status to **Reviewing**, **Resolved**, or **Dismissed**.

### Permissions and limitations

- Only signed-in accounts can submit reports. Users cannot report themselves.
- Message reports are verified server-side: the message must have been sent by the reported account in a conversation in which the reporter participated.
- The server captures the original message as evidence; it does not trust client-submitted screenshots or text.
- Reports, their evidence and staff review notes are readable only by staff/admin.
- Only staff/admin may update statuses. Review actions create an audit history.
- Each account is limited to 10 reports per 24 hours; repeat reports against the same account/message from the same user are blocked for 24 hours.
- No automated punishments, bans, or warnings are triggered by reports.
- Staff review shows the most recent 200 reports and refreshes every 45 seconds while open, with a manual refresh action.
- File-message reports preserve the filename and message metadata, not an actual copy of the file. Full chat transcripts are not collected automatically.

### Testing

TypeScript/TSX syntax was checked. A full `npm run build`, Windows installer build and live Supabase migration could not be completed in this environment because the npm registry was inaccessible. Test with two accounts and one staff account before public release.


## New in v0.7.1 — six-digit email verification

**Supabase dashboard setup is required.** This version changes how new sign-ups verify their email.

1. Go to **Supabase → Authentication → Email Templates → Confirm signup**.
2. Replace the complete HTML content with `supabase/email-templates/confirm-signup-otp.html`. Keep `{{ .Token }}` exactly as written.
3. Set the email subject to **Retro Messenger — Your verification code**. Save the email template.
4. In **Authentication → Providers → Email**, enable **Confirm email**. Optionally configure the OTP lifetime in your auth settings.
5. Restart the web or Windows app. New sign-ups now enter their emailed six-digit code inside Retro Messenger.

A user with an unconfirmed email who attempts to sign in is directed to code verification. The **Have a verification code?** link also lets users resume after restarting the app. **Send a new code** uses Supabase's `auth.resend({type:'signup',email})`, with a 60-second client cooldown; Supabase still applies server-side rate limits. The code is never stored in localStorage. Upon successful `verifyOtp({email, token, type:'email'})`, the session is used to open the app; if none is returned, the user is directed to password sign-in.

**No database migration is needed.** Existing verified accounts continue to sign in normally. Password-reset emails still use the configured reset-password template; this upgrade only changes **Confirm signup**. If email confirmations are disabled, Supabase can sign users in at registration without sending a verification code.


## v0.7.2 — email verification length compatibility

Supabase projects can issue 6–10 digit email one-time codes. The verification
input now allows any numeric OTP in that supported range and submits the full
code to `supabase.auth.verifyOtp`. The updated email template no longer claims
all codes are six digits. If you prefer **six-digit** codes, configure the
Supabase hosted project at Authentication → Sign In / Providers → Email →
Email OTP length = 6, then resend the confirmation email. Changing the email
template does not change the number of digits Supabase generates.

No database migration is needed for v0.7.2.


## v0.8.0 — Report-linked moderation actions

**Apply `supabase/migrations/0009_moderation_actions.sql` in the Supabase SQL Editor (after 0008).** Existing reports are retained. No automatic punishments occur; a staff reviewer must manually select an action for a report.

The Staff → Reports panel now supports an **official warning**, a **messaging restriction** (1h / 24h / 7d / admin-only 30d), or an **account suspension** (24h / 7d / 30d / until revoked; admin only). Staff can revoke warnings and mutes; only admins can revoke suspensions. Each action is recorded in `moderation_actions` / `moderation_action_events`, updates the report, and sends a no-reply System DM. Warnings do not disable messaging. Mutes prevent sending text, files, nudges, winks, typing events and new contact requests. Suspensions additionally prevent normal profile editing and reading ordinary chat data; an account-restriction screen is shown in the React/Tauri client.

**Scope:** Suspensions in this release are app/database access restrictions (Postgres policies), not an Auth ban or token revocation at Supabase's auth service. They do not block general Internet access or revoke a previously issued Auth token. Active sessions can take up to 15 seconds to display a new restriction in the UI. Database policies enforce chat sending immediately. Staff should review evidence before imposing sanctions.

### Vercel deployment improvement
The project now contains `.vercelignore` to exclude `src-tauri/`, Rust build artifacts and installers from website uploads. This avoids the multi-GB deployment upload caused by Tauri's `src-tauri/target` directory. Run `vercel deploy --dry` to inspect the included paths before `vercel --prod`.


## v0.8.1 — Vercel production build fix

- Added `src/vite-env.d.ts` to activate Vite TypeScript module and environment types (`import.meta.env`, `.png` imports).
- Removed two unused icon imports rejected by `noUnusedLocals` in CI.
- Preserved the custom logo in `src/assets/retro-messenger-logo.png` and the website `public` folder.
- Kept `.vercelignore` to prevent uploading Tauri/Rust files to Vercel.

To deploy, extract this full project into your `retro-messenger` project directory, preserve `.env`, then run `npm install`, `npm run build`, and `vercel --prod`.

On Vercel, configure Environment Variables for production: `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. The `VITE_` variables are public by design; **never** put the Supabase service-role or secret key into them.


## v0.9.0 — System Polls, Message Replies, Group Chats and Profiles

**New Supabase migrations (required, install in this order):**

1. `supabase/migrations/0010_system_polls.sql`
2. `supabase/migrations/0011_groups_and_replies.sql`

Alternatively, run the combined `supabase/install_v0.9.0.sql` **once, instead of** running the two migration files separately. Do not run the combined file and the individual migrations together.

**System Polls (admin only):**

- Open **Staff → System Polls**, type your question, optional description, and 2–6 choices.
- Choose 1, 3, 7, 14 or 30 days, or leave the poll open until manually closed.
- Click **Send poll to everyone**. Every **existing account** gets a separate official message under **Official Messenger → Retro Messenger System**.
- Members vote directly from the no-reply System conversation. They may change their vote until the closing time. They cannot send a text reply to the System account.
- Review aggregate vote counts in the System Polls tab; only administrators can close polls. Vote identities are not publicly accessible.
- Automated account welcome messages, private System DMs, Reports, Alerts and moderation remain unchanged.

**Reply to a message:**

- In any normal one-to-one conversation, click **Reply** below a message. The composer displays a quoted preview. Send your message normally; the reply link is stored on the server and validated to be from the same conversation.
- Clicking a quote attempts to jump to the original message. Quotes can also be used in group chats.
- Replying to official System DMs is intentionally disabled (poll voting is allowed).

**Group chats (3–12 people):**

- In the Contacts window, open **Group chats → New**, choose a group name and **2 or more accepted contacts**, then create the group.
- Group messages, message quotes, attachments, and reporting work in both browser and desktop windows.
- Group owners can add accepted contacts (maximum 12 including the owner). Participants may leave; ownership transfers automatically if the owner leaves.
- Membership is enforced by Supabase RLS and private group-management RPC functions. Muted/suspended users cannot send group messages; a suspended user cannot join a new group.
- Group lists and messages refresh automatically; new chat messages also use Supabase Realtime.

**Contact overview:**

- Click a contact's name or picture to see the profile picture, username, display name, public status, personal message, and member-since date.
- The overview has **Message** and **Report** controls where appropriate. Email addresses remain private.

**Deploy / development:**

```powershell
npm install
npm run build
npm run desktop:dev
# Or to deploy the website (with Vercel environment variables configured):
vercel --prod
```

Use `.vercelignore` from this project to exclude Tauri/Rust build outputs. Preserve `.env`. No Auth email-template change is necessary for v0.9.0.

**Test plan:** Create a poll from an administrator account and vote from two regular accounts; try changing a vote and closing a poll; verify a normal message reply and a rejected cross-conversation reply; create a group with three accounts and test membership, reporting, file transfers, and leaving. The SQL migration and a complete Vercel/Windows build require testing against a real Supabase project.


## v0.9.1 — Separate Staff & Administration Window

- Staff/Admin is no longer embedded inside the contacts sidebar.
- Click **Staff** / **Admin** in the left sidebar or **Tools → Staff / Admin Console** to open it.
- On Windows (Tauri), it opens a dedicated, independently resizable, movable application window. It is reused and focused if already open.
- On the website, it appears as a draggable, minimisable/maximisable window with its own taskbar entry.
- Admin tabs remain Announcements, System Direct Messages, Polls and Reports/Moderation. Regular staff only see authorised tabs.
- A standalone admin window authenticates with Supabase and checks the `messenger_staff` role before rendering the console; server-side RLS and RPCs still enforce the permissions.
- No additional Supabase migrations are required.


## v0.9.2 — readable colours and synced message formatting

- Rich-text **bold**, **italic**, **underline** and message colour are sent in the `messages.format` JSON column and displayed using the same component in both private and group conversations, for all recipients and on all devices.
- Group chat now has the same rich-text toolbar as a private chat. The toolbar controls apply to the entire message, not individual words.
- A validated colour picker rejects white, near-white, greys, muted grey-ish shades and any hue with insufficient contrast on white. Use the approved colour swatches or pick another dark, vivid colour.
- Old messages whose colours would be invisible are displayed in the normal dark colour; their bold/italic/underline formatting is still preserved.
- New Supabase migration: **`supabase/migrations/0012_readable_message_formatting.sql`**. It adds a database CHECK for future colour metadata, and does not rewrite existing messages. Run this migration after 0010 and 0011.
- In the project folder run `npm install`, `npm run build`, then `npm run desktop:dev` (and `vercel --prod` only after the web build passes).


## v0.9.3 — Colour restrictions and signup uniqueness feedback

**Run `supabase/install_v0.9.3.sql` in Supabase SQL Editor after migrations through 0011.** It applies the previously undelivered 0012 colour-validation migration and new 0013 username availability RPC. Alternatively, run those two individual migrations in order. Do not confuse this with `install_v0.9.0.sql`; both are needed on a fresh 0.9.x install.

### Safer message colours and shared formatting

- The picker rejects white, pale, grey and greyish hues, including dark neutral shades. The accepted colours have at least 65% saturation and 4.5:1 contrast on white. Ten tested vivid colour presets are included.
- Both DMs and group chats save `bold`, `italic`, `underline`, and `color` to `public.messages.format`; the **recipient** renders the same metadata, not just the sender's local editor. The database CHECK also rejects unsupported colours in future writes.
- Previously sent messages remain stored. The renderer substitutes a readable dark-blue colour when old metadata contains unsafe light/grey colours. The old text formatting flags are preserved.

### Signup errors

- Usernames are checked on leaving the field and before sign-up. The new anonymous username-only RPC returns availability; the existing UNIQUE constraint still prevents a signup race or parallel duplicate. Users see **“This username is already taken”** or the detailed account error.
- Supabase Authentication already controls email uniqueness. When Auth explicitly indicates a duplicate email (including when an obfuscated response has an empty identity list), the interface says **“You cannot make more than one account with this email. Please sign in or reset your password.”**
- **Privacy limitation:** When Supabase deliberately conceals whether an email exists, Retro Messenger will not create a public email-existence lookup. In those cases the app may show the normal verification screen. Advise users to sign in or reset their password. This prevents accidental disclosure of private email registrations.
- This update does not change the successful email OTP flow, SMTP template or existing accounts.

### Test and deploy

1. Run `supabase/install_v0.9.3.sql` once in Supabase SQL Editor. Confirm `select public.username_is_available('new_handle_123');` returns `true` (for an unused name).
2. Register with an existing **username** and confirm it is rejected before creating a new Auth record. Try an unused username.
3. Sign up using an already registered **email**, and check the sign-in/reset guidance. Supabase may intentionally avoid confirming registration status in the signup API.
4. Send a bold, italic, underlined dark-colour DM and group message to a second account. Verify all flags and the colour appear for the receiver. Test selecting white/grey and verify they are rejected.
5. `npm install`, `npm run build`, then `npm run desktop:dev` or `vercel --prod`. Preserve `.env` when updating the project.

No changes to the email OTP HTML template are needed.

## v0.9.4 — password recovery and inline chat images

### Production password reset setup (required)

1. In **Supabase → Authentication → URL Configuration**, set **Site URL** to `https://retromessenge.vercel.app`.
2. Add the **exact Redirect URL** `https://retromessenge.vercel.app/reset-password` to the allowed redirect list. Supabase will reject the redirect if it is not allowlisted.
3. Under **Authentication → Email Templates → Reset Password**, set the subject to `Retro Messenger — Reset your password` and paste `supabase/email-templates/reset-password.html` into the template. This template **must** use `{{ .ConfirmationURL }}` (a secure password recovery link). The signup **Confirm signup** template still uses the six-digit `{{ .Token }}`; do not replace that template.
4. Redeploy the React website to Vercel. `vercel.json` rewrites `/reset-password` to `index.html` so the recovery page loads on a direct visit. Continue to configure `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in Vercel Production environment variables.
5. From the sign-in screen on either the website or the Windows app, enter the registered email and click **Forgot your password?**. Open the email, follow the secure link, choose a new password (minimum eight characters) and sign in again. Recovery links are single-use and expire according to your Supabase Auth settings.

`resetPasswordForEmail()` intentionally does not indicate whether an email exists. The UI displays the same success message in either case, helping prevent email-account enumeration.

### Photos, file transfers and group-chat formatting

- JPG, PNG, GIF and WebP attachments are rendered as inline thumbnails inside both private and group chats. Click a thumbnail for the in-app full-size viewer, or select **Save** to download the actual image.
- Other supported files remain downloadable from inside the conversation. The `transfers` bucket stays private; read access still requires chat membership, with 10-minute signed preview URLs. Upload size remains 10 MB.
- Both chat types have separate image/file controls and also accept pasted images from the clipboard in the message editor.
- Group chat formatting controls (colour, bold, italic and underline) remain persistent and recipient-visible through the existing `messages.format` column and the shared `FormattedMessageText` renderer.
- No new Supabase SQL migration is required for v0.9.4 if the database migrations through **0013** are already installed.

A live Supabase recovery email and file transfer test, plus a Windows build, should be performed before releasing to all users.


## v0.9.5 — Vercel TypeScript fix

- Adds the missing `Flag` import in `src/GroupChats.tsx` for the Report action.
- No Supabase migration required. Run `npm run build` locally, then `vercel --prod`.


## v0.9.6 — Compact text colour picker

- Replaced the large native Windows/browser colour chooser and always-visible grid of swatches with one compact **Colour** toolbar button.
- Clicking Colour opens a 10-colour palette above the composer; choosing a shade closes it. Click outside the palette or press Escape to dismiss it.
- The 10 presets are dark, saturated, and contrast-safe. Pale, white, and greyish colours cannot be selected.
- Updated both direct-message and group-chat formatting toolbars without changing the message format or existing database constraints.
- No additional Supabase migration is required beyond the previous v0.9.3 colour restriction migrations.

## v0.9.7 — Retro Messenger classic Vista setup wizard

The Windows installer now uses a custom MSN/Vista-inspired NSIS wizard with your official
logo, glass-blue Welcome and Finish sidebar, branded page headers, installer
text, destination-folder picker, native progress display, Start Menu shortcut,
optional desktop shortcut, and Launch Retro Messenger action. The customised
installer uses Tauri's supported `installerHooks`/`sidebarImage`/`headerImage`
features; Tauri still owns the actual install/uninstall process.

All installer source/graphics/preview assets are in `src-tauri/installer/`, with
full build and testing instructions in `src-tauri/installer/README.md`.

To build a public Windows setup `.exe` (Windows PowerShell):

```powershell
npm install
npm run desktop:build:windows
explorer .\src-tauri\target\release\bundle\nsis
```

No database changes are needed. This ZIP includes installer source/assets but
**not** a compiled public installer executable; compile and test it on Windows.


---

# v1.0.0 — Classic Messenger & Safety Toolkit

This update builds on **v0.9.7**; it keeps the MSN/Vista Windows installer, Supabase auth, website, system DMs, groups, polls, reports and moderation.

## New features

- **Ink & Handwriting:** Press **Ink / Draw** in any one-to-one or group conversation. Draw with a mouse, pen or touch, choose brush size/colour/eraser and send the result as a **private PNG message attachment**. The existing signed URL inline image viewer handles the preview.
- **Edit / delete / reactions:** Edit your own text messages within 15 minutes, remove your own messages, and react with classic emojis. The RPCs enforce authorship and the message references; only authenticated conversation members can add/view reactions. Message history and reported evidence should be backed up before deletion.
- **Search:** Search text inside the currently open conversation. Results show dates and excerpts; messages older than the currently loaded history may not be scrollable until the older history is loaded.
- **Now Playing:** Manually publish a song/artist from Messenger Options → Now Playing; appears in your profile, contact overview, and main contacts panel. Spotify and external apps are **not automatically synchronised**.
- **Animated avatars:** JPG, PNG, WebP and GIF avatars accepted up to 2MB. Animated GIFs bypass the static-image crop and preserve their animation.
- **Custom GIF Winks:** Send an animated GIF using the new **Custom Wink GIF** control. These animate **inline**; the existing heart Wink animation remains available. This is not a general-purpose downloadable Wink marketplace.
- **Notification sounds:** Four original synth melodies or upload a small custom audio alert (150KB max, stored locally on that device). Other devices need their own custom sound selection.
- **Auto Away:** If your account is Online, the client automatically switches to Away after about ten minutes of inactivity and restores Online after local activity. Other running clients can affect presence, so test across multiple windows.
- **Group management:** Owner can promote/demote moderators, owners and moderators can rename and remove regular members, and approved group managers can invite accepted contacts. Group limit stays at twelve members.
- **Group games:** Server-validated **Noughts & Crosses** for two members, with an active-game limit and automatic result detection. In group chat click **Play Noughts & Crosses**.
- **Moderation appeals:** Suspended users can submit one pending appeal; staff see an **Appeals** tab in the separate Staff Console and can accept or decline with a written reason. Accepting lifts active suspensions for that user.
- **Privacy controls:** Settings → Privacy can disable new contact requests or hide your profile from non-contacts. Direct messages from contacts remain available. A username availability check may still reveal that a username is taken.
- **Update checker:** Options → Updates checks the published `updates.json` version and can open your official download page. This is **not** a signed automatic installer; secure installation requires the signing-key setup in `docs/SIGNED_WINDOWS_UPDATES.md`.

## Install after v0.9.7

1. Preserve your existing `.env` file and extract the updated ZIP into the project folder. Do not overwrite your Supabase credentials with `.env.example`.
2. Open **Supabase → SQL Editor** and run only the new migration: `supabase/migrations/0014_classic_social_features.sql`. It requires the previous migrations through `0013`.
3. On Windows, run `npm install`, `npm run build`, then `npm run desktop:dev` to test. For your website, run `vercel --prod` only after the local build passes.
4. Test using two accounts plus a staff account (drawing transfers, reactions, group game turns, appeal acceptance, GIF avatar, privacy changes). No part of the migration has been run on your live database here.
5. Run `npm run desktop:build -- --bundles nsis` to create the Vista-style Windows installer. Close existing Retro Messenger programs first to avoid Windows access-denied locks on `retro-messenger.exe`.

The new server-side features need migration 0014 before the new frontend can use them. `updates.json` is included for manual release metadata; change its `version` and official HTTPS download URL whenever you actually publish a new Windows build. **Do not automatically install an unsigned download.**

### Validation limitation

Source files passed TypeScript/TSX syntax parsing, but this environment lacks cached npm dependencies, a running Windows/Tauri toolchain, and access to your Supabase project. Run a full TypeScript/Vite build and test the SQL on a development database before public deployment.


## v1.0.1 — Supabase setup and update feed repair

See `docs/V1.0.1_REPAIR.md` for the missing-migration diagnostic, CORS fix,
and verification steps. This release prevents an empty chat from requesting
reactions using a placeholder UUID. It requires applying migration `0014`
if it has not been installed, and redeploying Vercel for CORS headers.


## v1.0.2 — 10-before / 10-after conversation evidence for reports

**Install `supabase/migrations/0015_report_message_context.sql` in Supabase SQL Editor AFTER migration 0014.** This is required before opening the updated reports panel. No changes to existing `submit_user_report` calls are needed.

When a user reports a **specific message**, Postgres (not the reporter's browser) captures the 10 preceding messages, the reported message, and up to 10 following messages from the same conversation. Messages are ordered by server-stored creation time and UUID to break ties. This applies to direct conversations and group chats.

If fewer than 10 messages follow at submission, a database trigger captures newly sent messages until the 10-after limit is reached while the report is Open or Reviewing, provided the reporter is still a member of the conversation. Closed/Dismissed reports stop collecting new messages. Collection is permanently frozen if the case closes or the reporter leaves, so reopening/rejoining cannot create a misleading gap in the evidence.

The context is in `public.user_report_message_context` with a copy of each message's body, author display name, timestamp, attachment metadata, and whether it was edited/deleted **at capture time**. It is limited to 21 rows per case, does not grant extra access to the conversation, and is visible only to authorised staff through RLS. Since the table stores snapshots independently of the source message FK, subsequent changes or hard deletion of messages do not alter this evidence.

The separate Administration → Reports window shows the evidence in time order, with the reported message highlighted and a Refresh button (it also refreshes every 20 seconds). Existing reports created before migration 0015 **do not receive invented historical evidence**; they continue to show the original captured message. Group attachments are shown by their file name/metadata; a private Storage image itself is not exposed to staff outside that chat.

Verify after a test report:

```sql
SELECT position, sender_name, message_body, sent_at
FROM public.user_report_message_context
WHERE report_id = 'YOUR_TEST_REPORT_UUID'::uuid
ORDER BY position;
```

Important: The migration and native Windows build cannot be validated against your live environment here. Test with two accounts in a development Supabase project first.


## v1.0.3 — Website popup clipping fix

Floating UI controls now use a page-level React portal instead of rendering under
`overflow:hidden` draggable windows. Updated: text-colour palettes, private/group
emoticons, reactions, File/Contacts/Tools/Help menus, contact dropdowns,
drawing windows, group games, user reports, profile dialogs and image zoom.

Menus are clamped to the browser viewport, flip above/below when space is tight,
and follow their anchor as a web window moves, resizes or scrolls. Popup CSS is
kept in `src/floating-ui.css`, with reusable positioning in `src/FloatingUI.tsx`.

No Supabase migration is required. No desktop installer changes are needed beyond
rebuilding the updated application. Native Tauri webviews cannot draw outside
the operating-system window itself.
