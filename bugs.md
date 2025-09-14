bugs:
- we don't track windows in the exception list, which breaks the workspace fingerprint logic. The _onWindowAdded and _onWindowRemoved handlers should use both the workspace and window arguments to correctly track _all_ windows and update the workspace fingerprint.  We should probably have two list of windows: one for tileable windows and one for exceptions. it also seems like the window list should be per workspace,right? how does the current tiling logic behave?

-
- is there a built-in way to get the all or just the current workspace? if so, then we can get the current windows using workspace.list_windows() instead of using dbus.