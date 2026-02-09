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
import * as WindowState from './managers/windowState.js';
import { WorkspaceTracker } from './managers/workspaceTracker.js';

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

const KEYBINDINGS: { [key: string]: (self: any) => void } = {
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
        if (Array.isArray(coords))
            return coords;
    }

    // TODO: Clutter 17 removed Seat.get_pointer(). The fallback to
    // overlap-based window finding in _findTargetUnderPointer() works fine.
    // If we need exact pointer position in future, check Clutter 17 docs
    // for alternative APIs like get_pointer_sprite() or event-based methods.
    return [0, 0];
}

// ── TYPE DEFINITIONS ────────────────────────────────────────
interface SignalConnection {
    object: any;
    id: number;
}

// ── INTERACTIONHANDLER ───────────────────────────────────
class InteractionHandler {
    private tiler: Tiler;
    private _settings: Gio.Settings;
    private _wmSettings: Gio.Settings;
    private _wmKeysToDisable: string[];
    private _savedWmShortcuts: { [key: string]: GLib.Variant };
    private _grabOpIds: number[];
    private _settingsChangedId: number | null;

    constructor(tiler: Tiler) {
        this.tiler = tiler;
        this._settings = this.tiler.settings;
        this._wmSettings = new Gio.Settings({ schema: WM_SCHEMA });

        this._wmKeysToDisable = [];
        this._savedWmShortcuts = {};
        this._grabOpIds = [];
        this._settingsChangedId = null;
    }

    enable(): void {
        this._prepareWmShortcuts();

        if (this._wmKeysToDisable.length)
            this._wmKeysToDisable.forEach(k =>
                this._wmSettings.set_value(k, new GLib.Variant('as', [])));

        this._bindAllShortcuts();
        this._settingsChangedId =
            this._settings.connect('changed', () => this._onSettingsChanged());

        this._grabOpIds.push(
            global.display.connect('grab-op-begin',
                (_: any, __: any, win: Meta.Window) => {
                    if (this.tiler.windows.includes(win))
                        this.tiler.grabbedWindow = win;
                })
        );
        this._grabOpIds.push(
            global.display.connect('grab-op-end', () => this._onGrabEnd())
        );
    }

    disable(): void {
        if (this._wmKeysToDisable.length)
            this._wmKeysToDisable.forEach(k => {
                const savedValue = this._savedWmShortcuts[k];
                if (savedValue) {
                    this._wmSettings.set_value(k, savedValue);
                }
            });

        this._unbindAllShortcuts();

        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = null;
        }
        this._grabOpIds.forEach(id => global.display.disconnect(id));
        this._grabOpIds = [];
    }

    _bindAllShortcuts(): void {
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
        for (const key in KEYBINDINGS) {
            Main.wm.removeKeybinding(key);
        }
    }

    _onSettingsChanged(): void {
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
        if (schema.has_key('toggle-tiled-left'))
            keys.push('toggle-tiled-left', 'toggle-tiled-right');
        else {
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

    _onGrabEnd(): void {
        const grabbed = this.tiler.grabbedWindow;
        if (!grabbed) return;
        const tgt = this._findTargetUnderPointer(grabbed);
        if (tgt) {
            const a = this.tiler.windows.indexOf(grabbed);
            const b = this.tiler.windows.indexOf(tgt);
            const winA = this.tiler.windows[a];
            const winB = this.tiler.windows[b];
            if (winA && winB) {
                [this.tiler.windows[a], this.tiler.windows[b]] =
                    [winB, winA];
            }
        }
        this.tiler.queueTile();
        this.tiler.grabbedWindow = null;
    }

    _findTargetUnderPointer(exclude: Meta.Window): Meta.Window | null {
        const [x, y] = getPointerXY();
        const wins = global.get_window_actors()
            .map(a => a.meta_window)
            .filter((w): w is Meta.Window => w !== null && w !== undefined && w !== exclude &&
                this.tiler.windows.includes(w) && (() => {
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
            if (w === exclude) continue;
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
    class TilingToggle extends (QuickSettings.QuickMenuToggle as any) {
        private _extensionObject!: Extension;
        private _settings!: Gio.Settings;

        _init(extensionObject: Extension) {
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
                this as any, 'checked',
                Gio.SettingsBindFlags.DEFAULT);

            // Add a header to the menu
            this.menu.setHeader('view-grid-symbolic', _('Simple Tiling'));

            // Add force retiling action
            this.menu.addAction(_('Force Retiling'),
                () => {
                    // Use async D-Bus call to prevent blocking the main thread
                    Gio.DBusProxy.new_for_bus(
                        Gio.BusType.SESSION,
                        Gio.DBusProxyFlags.NONE,
                        null,
                        'org.gnome.Shell',
                        '/org/gnome/Shell/Extensions/SimpleTiling',
                        'org.gnome.Shell.Extensions.SimpleTiling',
                        null,
                        (proxy, error) => {
                            if (error) {
                                console.error('Failed to create D-Bus proxy:', error);
                                return;
                            }
                            // Use async call to prevent freezing
                            if (proxy) {
                                proxy.call(
                                    'ForceRetile',
                                    null,
                                    Gio.DBusCallFlags.NONE,
                                    -1,
                                    null,
                                    (callProxy, result) => {
                                        if (callProxy) {
                                            try {
                                                callProxy.call_finish(result);
                                            } catch (e) {
                                                console.error('Failed to call ForceRetile:', e);
                                            }
                                        }
                                    }
                                );
                            }
                        }
                    );
                });

            // Add settings menu item
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            const settingsItem = this.menu.addAction(_('Settings'),
                () => this._extensionObject.openPreferences());

            // Ensure settings are unavailable when screen is locked
            settingsItem.visible = Main.sessionMode.allowSettings;
            this.menu._settingsActions[extensionObject.uuid] = settingsItem;
        }
    });

// ── SYSTEM INDICATOR ────────────────────────────────────────
const SimpleTilingIndicator = GObject.registerClass(
    class SimpleTilingIndicator extends (QuickSettings.SystemIndicator as any) {
        private _tilingToggle?: any;
        public declare quickSettingsItems: any[];

        _init(extensionObject: Extension) {
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
    public settings: Gio.Settings;

    private _extension: Extension;
    private _logger: Logger;
    private _timeoutRegistry: TimeoutRegistry;
    private _workspaceTracker: WorkspaceTracker;
    private _signalIds: Map<string, SignalConnection>;
    private _tileInProgress: boolean;
    private _innerGap: number;
    private _outerGapVertical: number;
    private _outerGapHorizontal: number;
    private _tilingDelay: number;
    private _centeringDelay: number;
    private _exceptions: string[];
    private _interactionHandler: InteractionHandler;
    private _tileTimeoutId: number | null;
    private _centerTimeoutIds: number[];
    private _windowOperationTimestamps: Map<number, number>;
    private _workspaceManager: Meta.WorkspaceManager | null;

    constructor(extension: Extension) {
        this._extension = extension;
        this.settings = this._extension.getSettings();
        this._logger = new Logger(this.settings);
        this._timeoutRegistry = new TimeoutRegistry(this._logger);
        this._workspaceTracker = new WorkspaceTracker(this._logger);

        this.grabbedWindow = null;
        this._signalIds = new Map();
        this._tileInProgress = false;

        this._innerGap = this.settings.get_int('inner-gap');
        this._outerGapVertical = this.settings.get_int('outer-gap-vertical');
        this._outerGapHorizontal = this.settings.get_int('outer-gap-horizontal');

        this._tilingDelay = TILING_DELAY_MS;
        this._centeringDelay = CENTERING_DELAY_MS;

        this._exceptions = [];
        this._interactionHandler = new InteractionHandler(this);

        this._tileTimeoutId = null;
        this._centerTimeoutIds = [];
        this._windowOperationTimestamps = new Map();
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
        this._signalIds.set('workspace-changed', {
            object: this._workspaceManager,
            id: this._workspaceManager.connect('active-workspace-changed',
                () => this._onActiveWorkspaceChanged())
        });

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
        this._signalIds.set('workspace-added', {
            object: this._workspaceManager,
            id: this._workspaceManager.connect('workspace-added',
                (_: any, index: number) => {
                    if (!this._workspaceManager) return;
                    const workspace = this._workspaceManager.get_workspace_by_index(index);
                    if (workspace) {
                        this._workspaceTracker.connectToWorkspace(workspace, {
                            onWindowAdded: (ws, win) => this._onWindowAdded(ws, win),
                            onWindowRemoved: (ws, win) => this._onWindowRemoved(ws, win)
                        });
                    }
                })
        });

        this._interactionHandler.enable();

        this._signalIds.set('settings-changed', {
            object: this.settings,
            id: this.settings.connect('changed', () => this._onSettingsChanged())
        });
    }

    disable(): void {
        // Clean up all timeouts managed by TimeoutRegistry
        this._timeoutRegistry.clearAll();

        // Reset state
        this._tileTimeoutId = null;
        this._centerTimeoutIds = [];

        // Clear operation timestamps
        this._windowOperationTimestamps.clear();

        this._interactionHandler.disable();

        // Disconnect all signals
        for (const [, sig] of this._signalIds) {
            try { sig.object.disconnect(sig.id); } catch { }
        }
        this._signalIds.clear();

        // Disable workspace tracker (cleans up workspace signals and data)
        this._workspaceTracker.disable();
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

    /**
     * Check if a window operation should be skipped due to recent processing.
     * Prevents infinite loops when windows trigger rapid successive events.
     * @param windowId The window ID to check
     * @param cooldownMs Cooldown period in milliseconds (default 1000ms)
     * @returns true if operation should be skipped
     */
    _shouldSkipOperation(windowId: number, cooldownMs = 1000): boolean {
        const lastTimestamp = this._windowOperationTimestamps.get(windowId);
        if (lastTimestamp && (Date.now() - lastTimestamp) < cooldownMs) {
            return true;
        }
        return false;
    }

    /**
     * Record that an operation was performed on a window.
     * @param windowId The window ID that was processed
     */
    _recordOperation(windowId: number): void {
        this._windowOperationTimestamps.set(windowId, Date.now());
    }

    /**
     * Clear operation timestamp for a window (e.g., when window is removed).
     * @param windowId The window ID to clear
     */
    _clearOperationTimestamp(windowId: number): void {
        this._windowOperationTimestamps.delete(windowId);
    }

    _connectWindowWorkspaceSignal(win: Meta.Window, initialWorkspace: Meta.Workspace): void {
        const windowId = win.get_id();

        // Don't connect if already connected
        if (WindowState.has(win, 'workspaceSignalId')) return;

        // Store initial workspace index in WindowState for change detection
        WindowState.set(win, 'prevWorkspaceIndex', initialWorkspace.index());

        const signalId = win.connect('workspace-changed', () => {
            this._onWindowWorkspaceChanged(win);
        });

        WindowState.set(win, 'workspaceSignalId', signalId);
        this._logger.debug(`Connected workspace-changed signal for window ${windowId}`);
    }

    _disconnectWindowWorkspaceSignal(win: Meta.Window): void {
        const windowId = win.get_id();
        const signalId = WindowState.get(win, 'workspaceSignalId');

        if (signalId !== undefined) {
            try {
                if (win && win.get_display()) {
                    win.disconnect(signalId);
                }
                this._logger.debug(`Disconnected workspace-changed signal for window ${windowId}`);
            } catch (e) {
                // Window already destroyed, signal auto-disconnected
                this._logger.debug(`Window ${windowId} signal already disconnected (window destroyed)`);
            }
            WindowState.remove(win, 'workspaceSignalId');
        }

        // WeakMap auto-cleans when window is garbage collected
        WindowState.remove(win, 'prevWorkspaceIndex');
    }

    _onWindowWorkspaceChanged(win: Meta.Window): void {
        if (!win || !win.get_display()) return;
        if (!this._workspaceManager) return; // Extension disabled

        const windowId = win.get_id();
        const newWorkspace = win.get_workspace();
        if (!newWorkspace) return;  // Window being destroyed

        const prevWorkspaceIndex = WindowState.get(win, 'prevWorkspaceIndex');
        const newWorkspaceIndex = newWorkspace.index();

        // Skip if workspace hasn't actually changed
        if (prevWorkspaceIndex === newWorkspaceIndex) return;

        // Skip if this window was recently processed (prevents rapid event loops)
        if (this._shouldSkipOperation(windowId, 500)) {
            this._logger.debug(`Skipping workspace change for window ${windowId} - recently processed`);
            return;
        }

        const winTitle = win.get_title() || '(untitled)';
        this._logger.debug(`Window "${winTitle}" moved from workspace ${prevWorkspaceIndex} to ${newWorkspaceIndex}`);

        // Remove from previous workspace tracking
        if (prevWorkspaceIndex !== undefined && prevWorkspaceIndex >= 0) {
            const prevWorkspace = this._workspaceManager.get_workspace_by_index(prevWorkspaceIndex);
            if (prevWorkspace) {
                this._workspaceTracker.removeWindow(prevWorkspace, win);
                this._logger.debug(`Removed from workspace ${prevWorkspaceIndex}`);
            }
        }

        // Add to new workspace tracking (if not already tracked)
        const newData = this._workspaceTracker.getWorkspaceData(newWorkspace);
        if (!newData.tiled.includes(win) && !newData.exceptions.includes(win)) {
            if (this._isException(win)) {
                this._workspaceTracker.addWindow(newWorkspace, win, true);
            } else if (this._isTileable(win)) {
                this._workspaceTracker.addWindow(newWorkspace, win, false);
                this._logger.debug(`Added to workspace ${newWorkspaceIndex} tiled list`);
            }
        }

        // Update stored workspace index
        WindowState.set(win, 'prevWorkspaceIndex', newWorkspaceIndex);

        // Record this operation to prevent rapid re-processing
        this._recordOperation(windowId);

        // Queue retiling for the active workspace
        this.queueTile();
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
        const existingRegistryId = WindowState.get(win, 'readyTimerId');
        if (existingRegistryId !== undefined) {
            this._timeoutRegistry.remove(existingRegistryId);
            WindowState.remove(win, 'readyTimerId');
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
                WindowState.remove(win, 'readyTimerId');
                return GLib.SOURCE_REMOVE;
            }

            if (this._isWindowReady(win)) {
                this._logger.debug(`Window ready after ${attempts} attempts: "${win.get_title()}"`);
                WindowState.remove(win, 'readyTimerId');
                callback();
                return GLib.SOURCE_REMOVE;
            }

            if (attempts >= maxAttempts) {
                this._logger.debug(`Window geometry timeout after ${attempts} attempts: "${win.get_title()}" - skipping`);
                WindowState.remove(win, 'readyTimerId');
                // Don't proceed on timeout - window may not be ready for tiling
                return GLib.SOURCE_REMOVE;
            }

            // Need to reschedule for next check
            const newRegistryId = this._timeoutRegistry.add(pollInterval, check, `window-ready-${windowId}`);
            WindowState.set(win, 'readyTimerId', newRegistryId);
            return GLib.SOURCE_REMOVE;
        };

        const registryId = this._timeoutRegistry.add(pollInterval, check, `window-ready-${windowId}`);
        WindowState.set(win, 'readyTimerId', registryId);
    }

    _centerWindow(win: Meta.Window): void {
        const registryId = this._timeoutRegistry.add(
            this._centeringDelay,
            () => {
                const index = this._centerTimeoutIds.indexOf(registryId);
                if (index > -1) this._centerTimeoutIds.splice(index, 1);

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
                    GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                        if (win.get_display()) {
                            if (typeof (win as any).set_keep_above === "function")
                                (win as any).set_keep_above(true);
                            else if (typeof (win as any).make_above === "function")
                                (win as any).make_above();
                        }
                        return GLib.SOURCE_REMOVE;
                    });
                }
                return GLib.SOURCE_REMOVE;
            },
            'center-window'
        );
        this._centerTimeoutIds.push(registryId);
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

        if (this._isTileable(win)) {
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
            if (!this._signalIds.has(`unmanaged-${id}`)) {
                this._signalIds.set(`unmanaged-${id}`, {
                    object: win,
                    id: win.connect("unmanaged", () =>
                        this._onWindowRemoved(null, win)  // Pass null to indicate destruction
                    ),
                });
                this._signalIds.set(`size-changed-${id}`, {
                    object: win,
                    id: win.connect("size-changed", () => {
                        if (!this.grabbedWindow) this.queueTile();
                    }),
                });
                this._signalIds.set(`minimized-${id}`, {
                    object: win,
                    id: win.connect("notify::minimized", () =>
                        this._onWindowMinimizedStateChanged()
                    ),
                });

                // Connect per-window workspace-changed signal
                this._connectWindowWorkspaceSignal(win, workspace);
            }

            // Only queue tiling if tiling is enabled
            if (this.settings.get_boolean('tiling-enabled')) {
                this.queueTile();
            }
            // Update workspace fingerprint after adding window
            this._workspaceTracker.updateFingerprint(workspace);
        }
    }

    _onWindowRemoved(workspace: Meta.Workspace | null, win: Meta.Window): void {
        const windowId = win.get_id();
        const winTitle = win.get_title() || '(untitled)';
        const wmClass = win.get_wm_class() || '(unknown)';
        const wsIndex = workspace?.index() ?? -1;

        // Cancel any pending geometry wait timer for this window
        const readyTimerId = WindowState.get(win, 'readyTimerId');
        if (readyTimerId !== undefined) {
            this._timeoutRegistry.remove(readyTimerId);
            WindowState.remove(win, 'readyTimerId');
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
            // Window is being destroyed, remove from all workspaces
            // Since we're using WeakMap, we can't iterate over all workspaces
            // But the window signals will be disconnected below
            this._logger.debug(`Window destroyed: "${winTitle}" [${wmClass}]`);
        }

        // Clean up signals only if window is being destroyed (workspace is null)
        if (!workspace) {
            ["unmanaged", "size-changed", "minimized"].forEach((prefix) => {
                const key = `${prefix}-${win.get_id()}`;
                if (this._signalIds.has(key)) {
                    const sig = this._signalIds.get(key);
                    if (sig) {
                        try {
                            sig.object.disconnect(sig.id);
                        } catch (e) { }
                        this._signalIds.delete(key);
                    }
                }
            });

            // Disconnect per-window workspace-changed signal
            this._disconnectWindowWorkspaceSignal(win);

            // Clear operation timestamp
            this._clearOperationTimestamp(windowId);
        }

        this.queueTile();
        // Update workspace fingerprint after removing window
        if (workspace) {
            this._workspaceTracker.updateFingerprint(workspace);
        }
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
                this._tileWindows();
                this._tileInProgress = false;
                this._tileTimeoutId = null;
                return GLib.SOURCE_REMOVE;
            },
            'tiling-queue'
        );
    }

    tileNow(): void {
        if (!this.settings.get_boolean('tiling-enabled')) return;
        if (!this._tileInProgress) {
            this._tileWindows();
        }
    }

    _splitLayout(windows: Meta.Window[], area: { x: number; y: number; width: number; height: number }): void {
        if (windows.length === 0) return;
        if (windows.length === 1) {
            const firstWin = windows[0];
            if (!firstWin) return;
            firstWin.move_resize_frame(
                true,
                area.x,
                area.y,
                area.width,
                area.height
            );
            return;
        }
        const gap = Math.floor(this._innerGap / 2);
        const firstWin = windows[0];
        if (!firstWin) return;
        const primaryWindows = [firstWin];
        const secondaryWindows = windows.slice(1);
        let primaryArea, secondaryArea;
        if (area.width > area.height) {
            const primaryWidth = Math.floor(area.width / 2) - gap;
            primaryArea = {
                x: area.x,
                y: area.y,
                width: primaryWidth,
                height: area.height,
            };
            secondaryArea = {
                x: area.x + primaryWidth + this._innerGap,
                y: area.y,
                width: area.width - primaryWidth - this._innerGap,
                height: area.height,
            };
        } else {
            const primaryHeight = Math.floor(area.height / 2) - gap;
            primaryArea = {
                x: area.x,
                y: area.y,
                width: area.width,
                height: primaryHeight,
            };
            secondaryArea = {
                x: area.x,
                y: area.y + primaryHeight + this._innerGap,
                width: area.width,
                height: area.height - primaryHeight - this._innerGap,
            };
        }
        this._splitLayout(primaryWindows, primaryArea);
        this._splitLayout(secondaryWindows, secondaryArea);
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

        const windowsToTile = data.tiled.filter((win) => {
            // Skip destroyed windows (can happen due to race between destroy event and tiling)
            if (!win || !win.get_display()) {
                this._logger.debug(`  Skipping window (no display): id=${win?.get_id()}`);
                return false;
            }
            // Skip windows with invalid monitor (indicates window is being destroyed)
            if (win.get_monitor() < 0) {
                this._logger.debug(`  Skipping window (invalid monitor): "${win.get_title()}"`);
                return false;
            }
            if (win.minimized) {
                this._logger.debug(`  Skipping window (minimized): "${win.get_title()}"`);
                return false;
            }
            return true;
        });
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
        if (windowsToTile.length === 1) {
            const firstWin = windowsToTile[0];
            if (!firstWin) return;
            firstWin.move_resize_frame(
                true,
                innerArea.x,
                innerArea.y,
                innerArea.width,
                innerArea.height
            );
            return;
        }
        const gap = Math.floor(this._innerGap / 2);
        const primaryWidth = Math.floor(innerArea.width / 2) - gap;
        const primary = windowsToTile[0];
        if (!primary) return;
        primary.move_resize_frame(
            true,
            innerArea.x,
            innerArea.y,
            primaryWidth,
            innerArea.height
        );
        const stackArea = {
            x: innerArea.x + primaryWidth + this._innerGap,
            y: innerArea.y,
            width: innerArea.width - primaryWidth - this._innerGap,
            height: innerArea.height,
        };
        this._splitLayout(windowsToTile.slice(1), stackArea);
    }
}

// ── EXTENSION‑WRAPPER ───────────────────────────────────
export default class SimpleTilingExtension extends Extension {
    public tiler?: Tiler;
    private _indicator?: any;
    private _dbus?: any;

    override enable(): void {
        this.tiler = new Tiler(this);
        this.tiler.enable();

        // Create and add Quick Settings indicator
        this._indicator = new SimpleTilingIndicator(this);
        (Main.panel.statusArea as any).quickSettings.addExternalIndicator(this._indicator);

        // Export D-Bus interface exactly like focused-window-dbus
        this._dbus = Gio.DBusExportedObject.wrapJSObject(SimpleTilingIface, this);
        this._dbus.export(
            Gio.DBus.session,
            '/org/gnome/Shell/Extensions/SimpleTiling'
        );
    }

    override disable(): void {
        // Unexport D-Bus interface
        if (this._dbus) {
            this._dbus.flush();
            this._dbus.unexport();
            delete this._dbus;
        }

        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = undefined;
        }

        if (this.tiler) {
            this.tiler.disable();
            this.tiler = undefined;
        }
    }

    // D-Bus method implementations
    GetWindowList(): string {
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

    ForceRetile(): void {
        if (this.tiler) {
            this.tiler.tileNow();
        }
    }
}
