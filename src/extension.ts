/////////////////////////////////////////////////////////////
//      Simple‑Tiling – MODERN (GNOME Shell 45+)          //
//     Original © 2025 Domoel – MIT                       //
//     Fork © 2025 Lucas Roesler – MIT                    //
/////////////////////////////////////////////////////////////


// ── GLOBAL IMPORTS ────────────────────────────────────────
import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as QuickSettings from 'resource:///org/gnome/shell/ui/quickSettings.js';

import Meta from 'gi://Meta';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';

import { Logger } from './utils/logger.js';
import { TimeoutRegistry } from './managers/timeoutRegistry.js';
import { WorkspaceTracker } from './managers/workspaceTracker.js';
import { SignalTracker } from './managers/signalTracker.js';
import { computeLayout, DEFAULT_PRIMARY_PERCENT } from './layout/tilingLayout.js';
import { parseDBusAccess, whenCallerAllowed } from './dbus/callerPolicy.js';

// ── CONST ────────────────────────────────────────────
const WM_SCHEMA = 'org.gnome.desktop.wm.keybindings';

const TILING_DELAY_MS = 20;   // Change Tiling Window Delay
const CENTERING_DELAY_MS = 5;    // Change Centered Window Delay

// D-Bus interface for communication with preferences
const SimpleTilingIface = `
<node>
  <interface name="org.gnome.Shell.Extensions.SimpleTiling">
    <method name="GetWindowList">
      <arg type="s" direction="out" name="windows"/>
    </method>
    <method name="ForceRetile">
    </method>
  </interface>
</node>`;

const KEYBINDINGS: { [key: string]: (self: InteractionHandler) => void } = {
    'swap-primary-window': (self) => self._swapWithPrimary(),
    'swap-left-window': (self) => self._swapInDirection('left'),
    'swap-right-window': (self) => self._swapInDirection('right'),
    'swap-up-window': (self) => self._swapInDirection('up'),
    'swap-down-window': (self) => self._swapInDirection('down'),
    'focus-left': (self) => self._focusInDirection('left'),
    'focus-right': (self) => self._focusInDirection('right'),
    'focus-up': (self) => self._focusInDirection('up'),
    'focus-down': (self) => self._focusInDirection('down'),
};

// ── HELPER‑FUNCTION ────────────────────────────────────────
function getPointerXY(): [number, number] {
    if (global.get_pointer) {
        const [x, y] = global.get_pointer();
        return [x, y];
    }

    const ev = Clutter.get_current_event();
    if (ev) {
        const coords = ev.get_coords();
        if (Array.isArray(coords)) {
            return coords;
        }
    }

    // TODO: Clutter 17 removed Seat.get_pointer(). The fallback to
    // overlap-based window finding in _findTargetUnderPointer() works fine.
    // If we need exact pointer position in future, check Clutter 17 docs
    // for alternative APIs like get_pointer_sprite() or event-based methods.
    return [0, 0];
}

// Drag-to-swap targets the window under the pointer, so only pointer moves qualify.
function isPointerMove(op: Meta.GrabOp): boolean {
    return op === Meta.GrabOp.MOVING || op === Meta.GrabOp.MOVING_UNCONSTRAINED;
}

// ── INTERACTIONHANDLER ───────────────────────────────────
class InteractionHandler {
    private tiler: Tiler;
    private _settings: Gio.Settings;
    private _wmSettings: Gio.Settings;
    private _wmKeysToDisable: string[];
    private _savedWmShortcuts: { [key: string]: GLib.Variant };
    private _signals: SignalTracker;
    private _shortcutsBound: boolean;

    constructor(tiler: Tiler) {
        this.tiler = tiler;
        this._settings = this.tiler.settings;
        this._wmSettings = new Gio.Settings({ schema: WM_SCHEMA });

        this._wmKeysToDisable = [];
        this._savedWmShortcuts = {};
        this._signals = new SignalTracker();
        this._shortcutsBound = false;
    }

    enable(): void {
        this._prepareWmShortcuts();

        if (this._wmKeysToDisable.length) {
            this._wmKeysToDisable.forEach(k =>
                this._wmSettings.set_value(k, new GLib.Variant('as', [])));
        }

        // Shortcuts are bound by setShortcutsEnabled(), which the extension
        // calls according to the lock state.
        this._signals.connect('settings-changed', this._settings, 'changed',
            () => this._onSettingsChanged());

        this._signals.connect('grab-op-begin', global.display, 'grab-op-begin',
            (_display: Meta.Display, win: Meta.Window, op: Meta.GrabOp) => {
                if (this.tiler.windows.includes(win)) {
                    this.tiler.grabbedWindow = win;
                    this.tiler.grabOp = op;
                }
            });
        this._signals.connect('grab-op-end', global.display, 'grab-op-end',
            (_display: Meta.Display, win: Meta.Window) => this._onGrabEnd(win));
    }

    disable(): void {
        if (this._wmKeysToDisable.length) {
            this._wmKeysToDisable.forEach(k => {
                const savedValue = this._savedWmShortcuts[k];
                if (savedValue) {
                    this._wmSettings.set_value(k, savedValue);
                }
            });
        }

        this.setShortcutsEnabled(false);

        this._signals.disconnectAll();
    }

    setShortcutsEnabled(enabled: boolean): void {
        if (enabled === this._shortcutsBound) return;
        if (enabled) {
            this._bindAllShortcuts();
        } else {
            this._unbindAllShortcuts();
        }
    }

    _bindAllShortcuts(): void {
        this._shortcutsBound = true;
        for (const [key, handler] of Object.entries(KEYBINDINGS)) {
            Main.wm.addKeybinding(
                key,
                this._settings,
                Meta.KeyBindingFlags.NONE,
                Shell.ActionMode.NORMAL,
                () => handler(this)
            );
        }
    }

    _unbindAllShortcuts(): void {
        this._shortcutsBound = false;
        for (const key in KEYBINDINGS) {
            Main.wm.removeKeybinding(key);
        }
    }

    _onSettingsChanged(): void {
        // Shortcuts stay unbound while the screen is locked.
        if (!this._shortcutsBound) return;
        this._unbindAllShortcuts();
        this._bindAllShortcuts();
    }

    _prepareWmShortcuts(): void {
        const schema = this._wmSettings.settings_schema;
        if (!schema) return;

        const keys = [];

        const add = (key: string) => { if (schema.has_key(key)) keys.push(key); };

        // Only disable tiling shortcuts since they conflict with our swap shortcuts
        // Maximize shortcuts are now compatible with our respect-maximized-windows feature
        if (schema.has_key('toggle-tiled-left')) {
            keys.push('toggle-tiled-left', 'toggle-tiled-right');
        } else {
            add('tile-left'); add('tile-right');
        }

        if (keys.length) {
            this._wmKeysToDisable = keys;
            keys.forEach(k => this._savedWmShortcuts[k] =
                this._wmSettings.get_value(k));
        }
    }

    _focusInDirection(direction: string): void {
        const src = global.display.get_focus_window();
        if (!src || !this.tiler.windows.includes(src)) return;
        const tgt = this._findTargetInDirection(src, direction);
        if (tgt) tgt.activate(global.get_current_time());
    }

    _swapWithPrimary(): void {
        const w = this.tiler.windows;
        if (w.length < 2) return;
        const foc = global.display.get_focus_window();
        if (!foc || !w.includes(foc)) return;
        const idx = w.indexOf(foc);
        const w0 = w[0];
        const wIdx = w[idx];
        const w1 = w[1];
        if (!w0 || !w1 || !wIdx) return;
        if (idx > 0) {
            [w[0], w[idx]] = [wIdx, w0];
        } else {
            [w[0], w[1]] = [w1, w0];
        }
        this.tiler.tileNow();
        w[0]?.activate(global.get_current_time());
    }

    _swapInDirection(direction: string): void {
        const src = global.display.get_focus_window();
        if (!src || !this.tiler.windows.includes(src)) return;
        let tgt = null;
        const idx = this.tiler.windows.indexOf(src);
        if (idx === 0 && direction === 'right' && this.tiler.windows.length > 1) {
            tgt = this.tiler.windows[1];
        } else {
            tgt = this._findTargetInDirection(src, direction);
        }
        if (!tgt) return;
        const tidx = this.tiler.windows.indexOf(tgt);
        const winIdx = this.tiler.windows[idx];
        const winTidx = this.tiler.windows[tidx];
        if (!winIdx || !winTidx) return;
        [this.tiler.windows[idx], this.tiler.windows[tidx]] =
            [winTidx, winIdx];
        this.tiler.tileNow();
        src.activate(global.get_current_time());
    }

    _findTargetInDirection(src: Meta.Window, dir: string): Meta.Window | null {
        const sRect = src.get_frame_rect(), cand = [];
        for (const win of this.tiler.windows) {
            if (win === src) continue;
            const r = win.get_frame_rect();
            if (dir === 'left' && r.x < sRect.x) cand.push(win);
            if (dir === 'right' && r.x > sRect.x) cand.push(win);
            if (dir === 'up' && r.y < sRect.y) cand.push(win);
            if (dir === 'down' && r.y > sRect.y) cand.push(win);
        }
        if (!cand.length) return null;
        let best = null, min = Infinity;
        for (const w of cand) {
            const r = w.get_frame_rect();
            const dev = (dir === 'left' || dir === 'right')
                ? Math.abs(sRect.y - r.y)
                : Math.abs(sRect.x - r.x);
            if (dev < min) { min = dev; best = w; }
        }
        return best;
    }

    _onGrabEnd(win: Meta.Window): void {
        const grabbed = this.tiler.grabbedWindow;
        const op = this.tiler.grabOp;
        this.tiler.clearGrab();
        if (!grabbed || grabbed !== win) return;

        if (this._swapWithWindowUnderPointer(grabbed, op)) {
            // Apply the new order even where queueTile() would hold back,
            // as the swap keybindings do.
            this.tiler.tileNow();
        } else {
            this.tiler.queueTile();
        }
    }

    _swapWithWindowUnderPointer(grabbed: Meta.Window, op: Meta.GrabOp): boolean {
        // Resizes never swap: a widened window overlaps its neighbour, and the
        // overlap fallback in _findTargetUnderPointer would pick it.
        if (!isPointerMove(op) || !this.tiler.settings.get_boolean('tiling-enabled')) {
            return false;
        }
        const tgt = this._findTargetUnderPointer(grabbed);
        if (!tgt) return false;
        const a = this.tiler.windows.indexOf(grabbed);
        const b = this.tiler.windows.indexOf(tgt);
        const winA = this.tiler.windows[a];
        const winB = this.tiler.windows[b];
        if (!winA || !winB) return false;
        [this.tiler.windows[a], this.tiler.windows[b]] = [winB, winA];
        return true;
    }

    _findTargetUnderPointer(exclude: Meta.Window): Meta.Window | null {
        const [x, y] = getPointerXY();
        const wins = global.get_window_actors()
            .map(a => a.meta_window)
            .filter((w): w is Meta.Window => w !== null && w !== undefined && w !== exclude &&
                !w.minimized && this.tiler.windows.includes(w) && (() => {
                    const f = w.get_frame_rect();
                    return x >= f.x && x < f.x + f.width &&
                        y >= f.y && y < f.y + f.height;
                })());
        if (wins.length) {
            const lastWin = wins[wins.length - 1];
            return lastWin ?? null;
        }

        let best: Meta.Window | null = null;
        let max = 0;
        const sRect = exclude.get_frame_rect();
        for (const w of this.tiler.windows) {
            if (w === exclude || w.minimized) continue;
            const r = w.get_frame_rect();
            const ovX = Math.max(0, Math.min(sRect.x + sRect.width, r.x + r.width) - Math.max(sRect.x, r.x));
            const ovY = Math.max(0, Math.min(sRect.y + sRect.height, r.y + r.height) - Math.max(sRect.y, r.y));
            const area = ovX * ovY;
            if (area > max) { max = area; best = w; }
        }
        return best;
    }
}

// ── TILING TOGGLE QUICK SETTING ───────────────────────────
const TilingToggle = GObject.registerClass(
    // `as any` is required: the GJS GObject subclassing idiom overrides _init
    // with custom params and touches private GNOME internals (_settingsActions),
    // neither of which the @girs base-class types model. Removing the cast does
    // not typecheck. Do not "fix" this.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    class TilingToggle extends (QuickSettings.QuickMenuToggle as any) {
        private _extensionObject!: SimpleTilingExtension;
        private _settings!: Gio.Settings;

        _init(extensionObject: SimpleTilingExtension) {
            super._init({
                title: _('Tiling'),
                subtitle: _('Automatic window tiling'),
                iconName: 'view-grid-symbolic',
                toggleMode: true,
            });

            this._extensionObject = extensionObject;

            // Bind the toggle to our tiling-enabled setting
            this._settings = extensionObject.getSettings();
            this._settings.bind('tiling-enabled',
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                this as any, 'checked',
                Gio.SettingsBindFlags.DEFAULT);

            // Add a header to the menu
            this.menu.setHeader('view-grid-symbolic', _('Simple Tiling'));

            // Add force retiling action
            this.menu.addAction(_('Force Retiling'),
                () => this._extensionObject.tiler?.tileNow());

            // Add settings menu item
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            const settingsItem = this.menu.addAction(_('Settings'),
                () => this._extensionObject.openPreferences());
            this.menu._settingsActions[extensionObject.uuid] = settingsItem;
        }

        // The toggle is recreated on every unlock; release the settings
        // binding so each cycle does not leave one behind.
        destroy(): void {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            Gio.Settings.unbind(this as any, 'checked');
            super.destroy();
        }
    });

// ── SYSTEM INDICATOR ────────────────────────────────────────
const SimpleTilingIndicator = GObject.registerClass(
    // `as any` is required for the same reason as TilingToggle above: the
    // @girs SystemIndicator types don't model the GJS _init override idiom.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    class SimpleTilingIndicator extends (QuickSettings.SystemIndicator as any) {
        // GNOME-internal members the @girs types don't model.
        /* eslint-disable @typescript-eslint/no-explicit-any */
        private _tilingToggle?: any;
        public declare quickSettingsItems: any[];
        /* eslint-enable @typescript-eslint/no-explicit-any */

        _init(extensionObject: SimpleTilingExtension) {
            super._init();

            // Optional: Create an indicator icon (uncomment if desired)
            // this._indicator = this._addIndicator();
            // this._indicator.icon_name = 'view-grid-symbolic';
            // this._indicator.visible = false; // Only show when needed

            // Create the tiling toggle
            this._tilingToggle = new TilingToggle(extensionObject);

            // Add the toggle to our items
            this.quickSettingsItems.push(this._tilingToggle);
        }

        destroy() {
            this.quickSettingsItems.forEach(item => item.destroy());
            super.destroy();
        }
    });

// ── TILER ────────────────────────────────────────────────
class Tiler {
    public grabbedWindow: Meta.Window | null;
    public grabOp: Meta.GrabOp;
    public settings: Gio.Settings;

    private _extension: Extension;
    private _logger: Logger;
    private _timeoutRegistry: TimeoutRegistry;
    private _workspaceTracker: WorkspaceTracker;
    private _signals: SignalTracker;
    private _tileInProgress: boolean;
    private _innerGap: number;
    private _outerGapVertical: number;
    private _outerGapHorizontal: number;
    private _tilingDelay: number;
    private _centeringDelay: number;
    private _exceptions: string[];
    private _interactionHandler: InteractionHandler;
    private _tileTimeoutId: number | null;
    // Pending window-ready poll per window, as TimeoutRegistry ids. Owned by
    // this Tiler so disable() drops it together with the registry.
    private _readyTimers: Map<Meta.Window, number>;
    private _workspaceManager: Meta.WorkspaceManager | null;

    constructor(extension: Extension) {
        this._extension = extension;
        this.settings = this._extension.getSettings();
        this._logger = new Logger(this.settings);
        this._timeoutRegistry = new TimeoutRegistry(this._logger);
        this._workspaceTracker = new WorkspaceTracker(this._logger);

        this.grabbedWindow = null;
        this.grabOp = Meta.GrabOp.NONE;
        this._signals = new SignalTracker(this._logger);
        this._tileInProgress = false;

        this._innerGap = this.settings.get_int('inner-gap');
        this._outerGapVertical = this.settings.get_int('outer-gap-vertical');
        this._outerGapHorizontal = this.settings.get_int('outer-gap-horizontal');

        this._tilingDelay = TILING_DELAY_MS;
        this._centeringDelay = CENTERING_DELAY_MS;

        this._exceptions = [];
        this._interactionHandler = new InteractionHandler(this);

        this._tileTimeoutId = null;
        this._readyTimers = new Map();
        this._workspaceManager = null;
    }

    // Getter for backwards compatibility with InteractionHandler
    get windows(): Meta.Window[] {
        const data = this._workspaceTracker.getActiveWorkspaceData();
        return data ? data.tiled : [];
    }

    enable(): void {
        this._loadExceptions();
        this._workspaceManager = global.workspace_manager;

        // Enable workspace tracker
        this._workspaceTracker.enable(this._workspaceManager);

        // Connect to workspace changed signal
        this._signals.connect('workspace-changed', this._workspaceManager,
            'active-workspace-changed', () => this._onActiveWorkspaceChanged());

        // Connect to all existing workspaces via WorkspaceTracker
        this._workspaceTracker.connectToAllWorkspaces({
            onWindowAdded: (ws, win) => this._onWindowAdded(ws, win),
            onWindowRemoved: (ws, win) => this._onWindowRemoved(ws, win)
        });

        // Add existing windows to tracking
        for (let i = 0; i < this._workspaceManager.get_n_workspaces(); i++) {
            const workspace = this._workspaceManager.get_workspace_by_index(i);
            if (workspace) {
                workspace.list_windows().forEach((win: Meta.Window) => {
                    this._onWindowAdded(workspace, win);
                });
            }
        }

        // Listen for new workspaces being added
        this._signals.connect('workspace-added', this._workspaceManager, 'workspace-added',
            (_: unknown, index: number) => {
                if (!this._workspaceManager) return;
                const workspace = this._workspaceManager.get_workspace_by_index(index);
                if (workspace) {
                    this._workspaceTracker.connectToWorkspace(workspace, {
                        onWindowAdded: (ws, win) => this._onWindowAdded(ws, win),
                        onWindowRemoved: (ws, win) => this._onWindowRemoved(ws, win)
                    });
                }
            });

        // Prune tracking for workspaces that get removed, so stale signal
        // entries don't accumulate (indices are reused on removal).
        this._signals.connect('workspace-removed', this._workspaceManager, 'workspace-removed',
            () => this._workspaceTracker.pruneRemovedWorkspaces());

        this._interactionHandler.enable();

        this._signals.connect('settings-changed', this.settings, 'changed',
            () => this._onSettingsChanged());
    }

    disable(): void {
        // Clean up all timeouts managed by TimeoutRegistry
        this._timeoutRegistry.clearAll();
        this._readyTimers.clear();

        // Reset state
        this._tileTimeoutId = null;
        this._tileInProgress = false;

        this._interactionHandler.disable();

        // Disconnect all signals
        this._signals.disconnectAll();

        // Disable workspace tracker (cleans up workspace signals and data)
        this._workspaceTracker.disable();
        this._workspaceManager = null;
    }

    _onSettingsChanged(): void {
        this._innerGap = this.settings.get_int('inner-gap');
        this._outerGapVertical = this.settings.get_int('outer-gap-vertical');
        this._outerGapHorizontal = this.settings.get_int('outer-gap-horizontal');
        this._loadExceptions(); // Reload exceptions when settings change

        // If tiling was just re-enabled, tile all current windows
        if (this.settings.get_boolean('tiling-enabled')) {
            this.queueTile();
        }
    }

    _loadExceptions(): void {
        const defaults = this.settings.get_strv('default-exceptions').map(s => s.toLowerCase());
        const custom = this.settings.get_strv('custom-exceptions').map(s => s.toLowerCase());
        this._exceptions = [...new Set([...defaults, ...custom])];
    }

    _isException(win: Meta.Window): boolean {
        if (!win) return false;
        const wmClass = (win.get_wm_class() || "").toLowerCase();
        const appId = (win.get_gtk_application_id() || "").toLowerCase();
        return this._exceptions.includes(wmClass) || this._exceptions.includes(appId);
    }

    _hasMaximizedWindows(): boolean {
        const data = this._workspaceTracker.getActiveWorkspaceData();
        if (!data) return false;
        return data.tiled.some(win =>
            win && typeof win.is_maximized === 'function' &&
            win.is_maximized() && !win.minimized
        );
    }

    _isTileable(win: Meta.Window): boolean {
        return (
            win &&
            !win.minimized &&
            win.get_window_type() === Meta.WindowType.NORMAL &&
            !win.is_on_all_workspaces() &&
            !win.is_attached_dialog() &&
            win.get_transient_for() === null &&
            !win.skip_taskbar &&
            !this._isException(win)  // Most expensive check last
        );
    }

    _isWindowReady(win: Meta.Window): boolean {
        if (!win || !win.get_display()) return false;
        const frame = win.get_frame_rect();
        const hasGeometry = frame.width > 0 && frame.height > 0;
        const hasWmClass = win.get_wm_class() !== null && win.get_wm_class() !== '';
        const hasCompositor = win.get_compositor_private() !== null;
        return hasGeometry && hasWmClass && hasCompositor;
    }

    /**
     * Check if a window is still valid (not destroyed).
     * Use this before any window operations to prevent crashes from stale references.
     */
    _isWindowValid(win: Meta.Window | null | undefined): win is Meta.Window {
        return win !== null && win !== undefined && win.get_display() !== null;
    }

    _waitForWindowReady(
        win: Meta.Window,
        _workspace: Meta.Workspace,
        callback: () => void,
        maxAttempts = 20
    ): void {
        const windowId = win.get_id();
        const pollInterval = 50; // ms

        // Cancel any existing timer for this window
        const existingRegistryId = this._readyTimers.get(win);
        if (existingRegistryId !== undefined) {
            this._timeoutRegistry.remove(existingRegistryId);
            this._readyTimers.delete(win);
        }

        // If already ready, call immediately
        if (this._isWindowReady(win)) {
            callback();
            return;
        }

        let attempts = 0;

        const check = (): boolean => {
            attempts++;

            // Window was destroyed while waiting - clean up and exit
            if (!win || !win.get_display()) {
                this._logger.debug(`Window ${windowId} destroyed while waiting for geometry`);
                this._readyTimers.delete(win);
                return GLib.SOURCE_REMOVE;
            }

            if (this._isWindowReady(win)) {
                this._logger.debug(`Window ready after ${attempts} attempts: "${win.get_title()}"`);
                this._readyTimers.delete(win);
                callback();
                return GLib.SOURCE_REMOVE;
            }

            if (attempts >= maxAttempts) {
                this._logger.debug(`Window geometry timeout after ${attempts} attempts: "${win.get_title()}" - skipping`);
                this._readyTimers.delete(win);
                // Don't proceed on timeout - window may not be ready for tiling
                return GLib.SOURCE_REMOVE;
            }

            // Need to reschedule for next check
            const newRegistryId = this._timeoutRegistry.add(pollInterval, check, `window-ready-${windowId}`);
            this._readyTimers.set(win, newRegistryId);
            return GLib.SOURCE_REMOVE;
        };

        const registryId = this._timeoutRegistry.add(pollInterval, check, `window-ready-${windowId}`);
        this._readyTimers.set(win, registryId);
    }

    _centerWindow(win: Meta.Window): void {
        this._timeoutRegistry.add(
            this._centeringDelay,
            () => {
                if (!win || !win.get_display()) return GLib.SOURCE_REMOVE;
                if (!this._workspaceManager) return GLib.SOURCE_REMOVE; // Extension disabled

                // Conditional unmaximize for exception windows based on setting
                if (!this.settings.get_boolean('respect-maximized-windows') &&
                    win.is_maximized()) {
                    win.unmaximize();
                }

                // Only center if the setting is enabled
                if (this.settings.get_boolean('exceptions-always-center')) {
                    const monitorIndex = win.get_monitor();
                    const workspace = this._workspaceManager.get_active_workspace();
                    const workArea = workspace.get_work_area_for_monitor(
                        monitorIndex
                    );

                    // Only center if not maximized (or if we just unmaximized it)
                    if (!win.is_maximized()) {
                        const frame = win.get_frame_rect();
                        win.move_frame(
                            true,
                            workArea.x + Math.floor((workArea.width - frame.width) / 2),
                            workArea.y +
                            Math.floor((workArea.height - frame.height) / 2)
                        );
                    }
                }

                // Only make window on top if the setting is enabled
                if (this.settings.get_boolean('exceptions-always-on-top')) {
                    this._timeoutRegistry.addIdle(() => {
                        if (win.get_display()) {
                            // set_keep_above/make_above availability varies across
                            // Meta versions; feature-detect at runtime.
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            const w = win as any;
                            if (typeof w.set_keep_above === "function") {
                                w.set_keep_above(true);
                            } else if (typeof w.make_above === "function") {
                                w.make_above();
                            }
                        }
                        return GLib.SOURCE_REMOVE;
                    }, 'center-window-above');
                }
                return GLib.SOURCE_REMOVE;
            },
            'center-window'
        );
    }

    _onWindowMinimizedStateChanged(): void {
        this.queueTile();
    }

    _onWindowAdded(workspace: Meta.Workspace, win: Meta.Window): void {
        if (!workspace) return;

        const data = this._workspaceTracker.getWorkspaceData(workspace);

        // Check if already tracked in this workspace
        if (data.tiled.includes(win) || data.exceptions.includes(win)) return;

        // Wait for window geometry to be ready before processing
        this._waitForWindowReady(win, workspace, () => {
            this._processNewWindow(workspace, win);
        });
    }

    _processNewWindow(workspace: Meta.Workspace, win: Meta.Window): void {
        // Window may have been destroyed while waiting
        if (!win || !win.get_display()) return;

        const data = this._workspaceTracker.getWorkspaceData(workspace);

        // Re-check if already tracked (might have been added while waiting)
        if (data.tiled.includes(win) || data.exceptions.includes(win)) return;

        const winTitle = win.get_title() || '(untitled)';
        const wmClass = win.get_wm_class() || '(unknown)';
        const wsIndex = workspace.index();
        const monitorIndex = win.get_monitor();

        if (this._isException(win)) {
            // Add to exceptions list for this workspace
            this._workspaceTracker.addWindow(workspace, win, true);
            this._logger.debug(`Window added (exception): "${winTitle}" [${wmClass}] ws=${wsIndex} monitor=${monitorIndex}`);

            // Only apply exception window settings when tiling is enabled and at least one setting is on
            if (this.settings.get_boolean('tiling-enabled') &&
                (this.settings.get_boolean('exceptions-always-center') ||
                 this.settings.get_boolean('exceptions-always-on-top'))) {
                this._centerWindow(win);
            }
            return;
        }

        if (!this._isTileable(win)) {
            // Log why the window was skipped
            const type = win.get_window_type();
            this._logger.debug(
                `Window skipped (not tileable): "${winTitle}" [${wmClass}] ws=${wsIndex}` +
                ` type=${type} minimized=${win.minimized}` +
                ` allWorkspaces=${win.is_on_all_workspaces()}` +
                ` attachedDialog=${win.is_attached_dialog()}` +
                ` transient=${win.get_transient_for() !== null}` +
                ` skipTaskbar=${win.skip_taskbar}`
            );
            if (win.minimized) {
                this._watchForUnminimize(win);
            }
            return;
        }

        // Add to tiled list for this workspace
        this._workspaceTracker.addWindow(workspace, win, false);

        // Reorder if needed based on new-window-behavior setting
        if (this.settings.get_string("new-window-behavior") === "primary") {
            // Move newly added window to front
            const index = data.tiled.indexOf(win);
            if (index > 0) {
                data.tiled.splice(index, 1);
                data.tiled.unshift(win);
            }
        }

        this._logger.debug(`Window added (tiled): "${winTitle}" [${wmClass}] ws=${wsIndex} monitor=${monitorIndex}, total tiled=${data.tiled.length}`);

        const id = win.get_id();
        // Only connect signals if not already connected
        if (!this._signals.has(`unmanaged-${id}`)) {
            this._signals.connect(`unmanaged-${id}`, win, "unmanaged",
                () => this._onWindowRemoved(null, win)); // Pass null to indicate destruction
            this._signals.connect(`size-changed-${id}`, win, "size-changed",
                () => { if (!this.grabbedWindow) this.queueTile(); });
            this._signals.connect(`minimized-${id}`, win, "notify::minimized",
                () => this._onWindowMinimizedStateChanged());
        }

        // Only queue tiling if tiling is enabled
        if (this.settings.get_boolean('tiling-enabled')) {
            this.queueTile();
        }
    }

    // A window that is minimized when added gets no per-window signals, so
    // nothing would re-check it once restored. Re-run the add on unminimize.
    _watchForUnminimize(win: Meta.Window): void {
        const key = `unminimize-${win.get_id()}`;
        this._signals.connect(key, win, 'notify::minimized', () => {
            if (win.minimized) return;
            this._signals.disconnect(key);
            const workspace = win.get_workspace();
            if (workspace) {
                this._onWindowAdded(workspace, win);
            }
        });
    }

    _onWindowRemoved(workspace: Meta.Workspace | null, win: Meta.Window): void {
        const winTitle = win.get_title() || '(untitled)';
        const wmClass = win.get_wm_class() || '(unknown)';
        const wsIndex = workspace?.index() ?? -1;

        // The destination workspace's window-added sets up a new watch if needed.
        this._signals.disconnect(`unminimize-${win.get_id()}`);

        // Cancel any pending geometry wait timer for this window
        const readyTimerId = this._readyTimers.get(win);
        if (readyTimerId !== undefined) {
            this._timeoutRegistry.remove(readyTimerId);
            this._readyTimers.delete(win);
        }

        // Remove from the specific workspace if provided
        if (workspace) {
            const data = this._workspaceTracker.getWorkspaceData(workspace);
            const wasInTiled = data.tiled.includes(win);
            const wasInExceptions = data.exceptions.includes(win);

            this._workspaceTracker.removeWindow(workspace, win);

            const windowType = wasInTiled ? 'tiled' : (wasInExceptions ? 'exception' : 'unknown');
            this._logger.debug(`Window removed (${windowType}): "${winTitle}" [${wmClass}] ws=${wsIndex}, remaining tiled=${data.tiled.length}`);
        } else {
            // Mutter also emits window-removed on the window's workspace during
            // unmanage, which removes it from tracker data.
            this._logger.debug(`Window destroyed: "${winTitle}" [${wmClass}]`);
        }

        // Clean up signals only if window is being destroyed (workspace is null)
        if (!workspace) {
            ["unmanaged", "size-changed", "minimized"].forEach((prefix) => {
                this._signals.disconnect(`${prefix}-${win.get_id()}`);
            });
            // A window destroyed mid-grab may never get grab-op-end, and a
            // stale grabbedWindow suppresses every size-changed retile.
            if (win === this.grabbedWindow) this.clearGrab();
        }

        this.queueTile();
    }

    _onActiveWorkspaceChanged(): void {
        if (!this._workspaceManager) return; // Extension disabled

        // Just queue a retile for the new workspace, no disconnection needed
        const workspace = this._workspaceManager.get_active_workspace();
        const wsIndex = workspace?.index() ?? -1;
        const data = workspace ? this._workspaceTracker.getWorkspaceData(workspace) : null;
        this._logger.debug(`Active workspace changed to workspace ${wsIndex} with ${data?.tiled.length ?? 0} tiled windows`);
        this.queueTile();
    }


    queueTile(): void {
        if (this._tileInProgress || this._tileTimeoutId) {
            this._logger.debug('Tiling already in progress or queued, skipping');
            return;
        }
        if (!this.settings.get_boolean('tiling-enabled')) {
            this._logger.debug('Tiling disabled, skipping queue');
            return;
        }

        // Check if we should respect maximized windows
        if (this.settings.get_boolean('respect-maximized-windows') &&
            this._hasMaximizedWindows()) {
            this._logger.debug('Maximized windows detected, skipping tiling');
            return; // Skip tiling when maximized windows exist
        }

        this._logger.debug(`Tiling queued, will execute in ${this._tilingDelay}ms`);
        this._tileInProgress = true;
        this._tileTimeoutId = this._timeoutRegistry.add(
            this._tilingDelay,
            () => {
                // Reset the flags even if tiling throws, or every later
                // queueTile() call returns at the in-progress guard.
                try {
                    this._tileWindows();
                } catch (e) {
                    this._logger.error(`Tiling failed: ${e}\n${e instanceof Error ? e.stack : ''}`);
                } finally {
                    this._tileInProgress = false;
                    this._tileTimeoutId = null;
                }
                return GLib.SOURCE_REMOVE;
            },
            'tiling-queue'
        );
    }

    setShortcutsEnabled(enabled: boolean): void {
        this._interactionHandler.setShortcutsEnabled(enabled);
    }

    clearGrab(): void {
        this.grabbedWindow = null;
        this.grabOp = Meta.GrabOp.NONE;
    }

    // Runs for explicit user actions (swap keybindings, Force Retile), so it
    // tiles even when respect-maximized-windows would hold back queueTile():
    // the swaps have already reordered the list and must be applied.
    tileNow(): void {
        if (!this.settings.get_boolean('tiling-enabled')) return;
        if (!this._tileInProgress) {
            this._tileWindows();
        }
    }

    _tileWindows(): void {
        if (!this._workspaceManager) return; // Extension disabled

        const workspace = this._workspaceManager.get_active_workspace();
        if (!workspace) return; // No active workspace

        const data = this._workspaceTracker.getWorkspaceData(workspace);
        const wsIndex = workspace.index();

        this._logger.debug(`_tileWindows() executing for workspace ${wsIndex}`);

        // Recheck for exceptions after delay - window properties may now be set
        const windowsToRecheck = [...data.tiled];
        for (const win of windowsToRecheck) {
            // Skip if window was destroyed while we were processing
            if (!this._isWindowValid(win)) {
                this._logger.debug(`Skipping stale window reference during exception recheck`);
                this._workspaceTracker.removeWindow(workspace, win);
                continue;
            }

            if (this._isException(win)) {
                // Move from tiled to exceptions
                this._workspaceTracker.removeWindow(workspace, win);
                this._workspaceTracker.addWindow(workspace, win, true);
                this._logger.debug(`Rechecked window "${win.get_title()}" is now an exception, moved to exceptions list`);

                // Apply exception window settings if enabled
                if (this.settings.get_boolean('tiling-enabled') &&
                    (this.settings.get_boolean('exceptions-always-center') ||
                     this.settings.get_boolean('exceptions-always-on-top'))) {
                    this._centerWindow(win);
                }
            }
        }

        const primaryMonitor = Main.layoutManager.primaryMonitor;
        const windowsToTile = data.tiled.filter((win) => {
            // Skip destroyed windows (can happen due to race between destroy event and tiling)
            if (!win || !win.get_display()) {
                this._logger.debug(`  Skipping window (no display): id=${win?.get_id()}`);
                return false;
            }
            if (win.minimized) {
                this._logger.debug(`  Skipping window (minimized): "${win.get_title()}"`);
                return false;
            }
            // Handle windows with invalid monitor assignment (monitor == -1).
            // This can happen when Mutter clears the monitor ref during destruction,
            // or when a window gets stuck without a monitor after monitor hotplug
            // (known issue with Electron/Wayland apps, see GNOME Shell #4713).
            // If the window is otherwise healthy, recover by moving it to the primary monitor.
            if (win.get_monitor() < 0 && !(primaryMonitor && this._isWindowReady(win))) {
                this._logger.debug(`  Skipping window (invalid monitor, not recoverable): "${win.get_title()}"`);
                return false;
            }
            return true;
        });
        for (const win of windowsToTile) {
            if (primaryMonitor && win.get_monitor() < 0) {
                this._logger.debug(`  Recovering window with invalid monitor: "${win.get_title()}" -> monitor ${primaryMonitor.index}`);
                win.move_to_monitor(primaryMonitor.index);
            }
        }
        if (windowsToTile.length === 0) {
            this._logger.debug(`No windows to tile on workspace ${wsIndex}`);
            return;
        }

        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor) {
            this._logger.error('No primary monitor found');
            return;
        }
        const workArea = workspace.get_work_area_for_monitor(monitor.index);

        // Log monitor and window details for multi-monitor diagnostics
        this._logger.debug(`Tiling ${windowsToTile.length} windows on workspace ${wsIndex}`);
        this._logger.debug(`  Using primary monitor index ${monitor.index}, work area: x=${workArea.x} y=${workArea.y} w=${workArea.width} h=${workArea.height}`);
        windowsToTile.forEach((win, idx) => {
            if (!this._isWindowValid(win)) return;
            const winMonitor = win.get_monitor();
            this._logger.debug(`    [${idx}] "${win.get_title()}" is on monitor ${winMonitor}`);
        });

        const innerArea = {
            x: workArea.x + this._outerGapHorizontal,
            y: workArea.y + this._outerGapVertical,
            width: workArea.width - 2 * this._outerGapHorizontal,
            height: workArea.height - 2 * this._outerGapVertical,
        };

        // Conditional unmaximize behavior based on setting
        if (!this.settings.get_boolean('respect-maximized-windows')) {
            // Current behavior: force unmaximize all windows
            windowsToTile.forEach((win) => {
                if (!this._isWindowValid(win)) return;
                if (win.is_maximized()) {
                    win.unmaximize();
                }
            });
        }
        // If respecting maximized windows, don't force unmaximize

        // Compute the target rectangle for each window, then apply.
        const rects = computeLayout(windowsToTile.length, innerArea, this._innerGap, DEFAULT_PRIMARY_PERCENT);
        windowsToTile.forEach((win, i) => {
            // Re-check validity: a window may have been destroyed between the
            // filter above and here.
            if (!this._isWindowValid(win)) return;
            const rect = rects[i];
            if (!rect) return;
            win.move_resize_frame(true, rect.x, rect.y, rect.width, rect.height);
        });
    }
}

// ── EXTENSION‑WRAPPER ───────────────────────────────────
export default class SimpleTilingExtension extends Extension {
    public tiler?: Tiler;
    // Instance of the registerClass'd SimpleTilingIndicator, whose constructed
    // type the @girs types don't expose.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private _indicator?: any;
    private _dbus?: Gio.DBusExportedObject;
    private _signals?: SignalTracker;

    override enable(): void {
        this.tiler = new Tiler(this);
        this.tiler.enable();

        this._signals = new SignalTracker();
        this._signals.connect('session-mode', Main.sessionMode, 'updated',
            () => this._syncLockState());
        this._syncLockState();
    }

    // The extension declares the unlock-dialog session mode so the tiler keeps
    // its window order across a screen lock. Without it, GNOME Shell disables
    // the extension on every lock and enable() rebuilds the order on unlock.
    // While locked, _syncLockState removes the keybindings, the Quick Settings
    // toggle and the D-Bus API. disable() tears everything down.
    override disable(): void {
        this._signals?.disconnectAll();
        this._signals = undefined;

        this._removeUserInterfaces();

        if (this.tiler) {
            this.tiler.disable();
            this.tiler = undefined;
        }
    }

    _syncLockState(): void {
        const locked: boolean = Main.sessionMode.isLocked;
        this.tiler?.setShortcutsEnabled(!locked);
        if (locked) {
            this._removeUserInterfaces();
        } else {
            this._addUserInterfaces();
        }
    }

    _addUserInterfaces(): void {
        if (!this._indicator) {
            this._indicator = new SimpleTilingIndicator(this);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (Main.panel.statusArea as any).quickSettings.addExternalIndicator(this._indicator);
        }

        if (!this._dbus) {
            this._dbus = Gio.DBusExportedObject.wrapJSObject(SimpleTilingIface, this);
            this._dbus.export(Gio.DBus.session, '/org/gnome/Shell/Extensions/SimpleTiling');
        }
    }

    _removeUserInterfaces(): void {
        if (this._dbus) {
            this._dbus.flush();
            this._dbus.unexport();
            this._dbus = undefined;
        }

        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = undefined;
        }
    }

    // D-Bus method implementations. GJS dispatches to these Async forms, which
    // receive the invocation and with it the caller's bus name.
    GetWindowListAsync(_params: [], invocation: Gio.DBusMethodInvocation): void {
        this._serveDBusCall(invocation, () =>
            invocation.return_value(new GLib.Variant('(s)', [this._windowListJson()])));
    }

    ForceRetileAsync(_params: [], invocation: Gio.DBusMethodInvocation): void {
        this._serveDBusCall(invocation, () => {
            this.tiler?.tileNow();
            invocation.return_value(null);
        });
    }

    _serveDBusCall(invocation: Gio.DBusMethodInvocation, reply: () => void): void {
        const settings = this.tiler?.settings;
        if (!settings) {
            invocation.return_dbus_error('org.freedesktop.DBus.Error.Failed',
                'Simple Tiling is disabled');
            return;
        }
        const access = parseDBusAccess(settings.get_string('dbus-access'));
        whenCallerAllowed(invocation, access, () => {
            // The caller check is asynchronous; the screen may have locked,
            // and the API been unexported, since the call arrived.
            if (!this._dbus) {
                throw new Error('Simple Tiling D-Bus API is unavailable while the screen is locked');
            }
            reply();
        });
    }

    _windowListJson(): string {
        try {
            const workspace = global.workspace_manager.get_active_workspace();
            const windows = workspace.list_windows()
                .filter((w: Meta.Window) => w && w.get_window_type() === Meta.WindowType.NORMAL)
                .map((w: Meta.Window) => ({
                    title: w.get_title() || 'Unknown',
                    wmClass: w.get_wm_class() || '',
                    appId: w.get_gtk_application_id() || ''
                }));
            return JSON.stringify(windows);
        } catch (e) {
            console.error('SimpleTiling: Error getting window list:', e);
            return '[]';
        }
    }
}
