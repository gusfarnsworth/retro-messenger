# Retro Messenger v1.1.0 — Games & Activities

## Install

The full v1.1.0 project contains the old desktop app, staff moderation system, branded Windows installer, and the Games & Activities centre.

1. Preserve `.env` before extracting the ZIP over the existing `retro-messenger` folder.
2. Confirm **all previous migrations (0001–0015)** are installed in Supabase. In **Supabase → SQL Editor**, run `supabase/migrations/0016_games_and_activities.sql` **once**. Do not run the schema from a browser, and do not expose your service-role key.
3. Test the database with two accounts that are contacts. Open the same private conversation on two browsers or Windows clients, then press **Games**. One player sends an invitation and the other accepts it from **Games → Recent invitations & matches**.
4. Try **Shared Whiteboard** in the same Games & Activities window. Strokes should appear for both users within several seconds.
5. Run `npm install`, `npm run test:games`, `npm run build`, and `npm run desktop:dev`.
6. After local testing, deploy the website using `vercel --prod`. For the Windows installer, use `npm run desktop:build -- --bundles nsis`.

No Storage bucket or new secrets are required. Postgres Changes Realtime is enabled for the new activity tables if the project's publication exists; polling works as fallback.

## Games

| Activity | How it works |
|---|---|
| Minesweeper Flags | Two players alternate marking an 8×8 field. The database stores ten secret mines and determines whether each flag is correct. Most correct flags wins. |
| Checkers | 8×8 board with diagonal pieces, captures and king promotion. Casual edition, not yet full tournament rules (mandatory captures and multi-jump chains are not enforced). |
| Noughts & Crosses | Three-in-a-row on a 3×3 board. Server validates free squares and finishes winning or drawn games. |
| Solitaire Sprint | Original two-player speed adaptation. Cycle a 20-card deck and build four foundations (Ace–Five). |
| Four in a Row | Classic gravity board. Server validates column limits and detects four in a row or draws. |
| Chess | Chess board, legal movement, pawn promotion, check and basic checkmate/stalemate detection. Castling, en passant, threefold repetition and fifty-move draw rules are not yet implemented. |
| Colour Clash | Original colour-and-number matching game, in the spirit of matching card games. Six cards per player. |
| Gem Match | Swap adjacent gems in separate boards and race to a points target. |
| Sudoku Race | Solve the same fixed-layout Sudoku puzzle competitively. Server rejects incorrect digits. |
| Word Blitz | Use a shared letter set to find accepted words. Each account can submit each word once; first to eight wins. |
| Shared Whiteboard | Every member of the conversation can add brush strokes. Draw together, undo your own strokes, or export a PNG. |

The new centre works in **private conversations and group chats**. On Windows, **Games** opens an independent Tauri window; on the website it opens a draggable, unclipped panel above the conversations. A match is between two explicitly invited members, while whiteboards are shared with everyone in the conversation. Existing v1.0.4 Noughts & Crosses data is preserved in `group_games`; old matches aren't migrated into the new system.

## Security and feature limitations

- Supabase RLS limits room and whiteboard visibility to conversation members, and game RPCs check participation, membership and messaging permissions.
- Game actions have turn checks and bounds checks; Noughts & Crosses, Minesweeper Flags, Four in a Row and Sudoku have additional server-side validation. **Chess, Checkers, Solitaire Sprint, Colour Clash and Gem Match have client-side move/rule validation only beyond basic server shape checks**, so they aren't hardened against modified clients. This release is a casual/social first version, **not a secure competitive leaderboard**.
- Shared whiteboard updates are append-only stroke records; your own strokes can be undone. The history shown is capped at 600 recent strokes for performance.
- Game invitations can only be sent to members of the same conversation. An invitation won't launch a game on the recipient's computer automatically; the recipient accepts it in Games & Activities.
- Application Sharing (remote desktop/screen-sharing) is **not** included. That would require explicit user consent, streaming, and new privacy/security controls.
- These are original mini-game adaptations, not copies of copyrighted MSN game binaries, game art or proprietary assets.
- A live Supabase migration and production Windows build are still required before treating this as a publicly tested release.

## Unit checks

`npm run test:games` runs deterministic regression checks for all ten game rules, two sample wins, and selected board movements. It does **not** simulate two live clients or validate every possible game state.
