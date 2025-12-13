# Simple-Tiling Project Notes

## Task Tracking

This project uses `bd` (beads) for local issue tracking in **stealth mode** (no sync needed).

```bash
bd create "Issue title"          # Create issue
bd list                          # List all issues
bd list --status open            # List open issues
bd ready                         # Show unblocked work
bd show <id>                     # Show issue details
bd dep add <id1> <id2>           # id2 blocks id1
bd update <id> --status in_progress
bd close <id>
```

Note: Do not run `bd sync` - beads is configured for local-only tracking.

## Build & Test

```bash
npm run build                    # Compile TypeScript
npm run lint                     # Run ESLint
```

## GNOME Shell Extension

- Extension path when installed: `~/.local/share/gnome-shell/extensions/simple-tiling@lucasroesler/`
- Restart GNOME Shell after changes: `Alt+F2` then `r` (X11) or log out/in (Wayland)
- View logs: `journalctl -f -o cat /usr/bin/gnome-shell`
