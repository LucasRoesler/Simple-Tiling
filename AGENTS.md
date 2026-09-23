# Simple-Tiling Project Notes

## Build & Test

```bash
npm run build                    # Compile TypeScript
npm run lint                     # Run ESLint
npm test                         # Unit tests for pure modules (Node 24+)
```

## GNOME Shell Extension

- Extension path when installed: `~/.local/share/gnome-shell/extensions/simple-tiling@lucasroesler/`
- Restart GNOME Shell after changes: `Alt+F2` then `r` (X11) or log out/in (Wayland)
- View logs: `journalctl -f -o cat /usr/bin/gnome-shell`
