/////////////////////////////////////////////////////////////
//      Simple‑Tiling – Workspace Tracker                 //
//     Per-workspace window tracking and signal mgmt      //
/////////////////////////////////////////////////////////////

import Meta from 'gi://Meta';
import GObject from 'gi://GObject';
import { Logger } from '../utils/logger.js';

export interface WorkspaceData {
    tiled: Meta.Window[];
    exceptions: Meta.Window[];
}

interface SignalConnection {
    object: GObject.Object;
    id: number;
}

export interface WorkspaceCallbacks {
    onWindowAdded: (workspace: Meta.Workspace, win: Meta.Window) => void;
    onWindowRemoved: (workspace: Meta.Workspace, win: Meta.Window) => void;
}

export class WorkspaceTracker {
    private _workspaceWindows: WeakMap<Meta.Workspace, WorkspaceData>;
    private _workspaceSignals: Map<string, SignalConnection>;
    private _workspaceIds: WeakMap<Meta.Workspace, number>;
    private _nextWorkspaceId: number;
    private _logger: Logger;
    private _workspaceManager: Meta.WorkspaceManager | null;

    constructor(logger: Logger) {
        this._logger = logger;
        this._workspaceWindows = new WeakMap();
        this._workspaceSignals = new Map();
        this._workspaceIds = new WeakMap();
        this._nextWorkspaceId = 1;
        this._workspaceManager = null;
    }

    // Stable identifier for a workspace object, independent of its mutable
    // index(). GNOME reuses indices when workspaces are removed/reordered, so
    // keying signal bookkeeping by index causes a new workspace to be mistaken
    // for an already-tracked one. The workspace object itself is stable, so we
    // assign each a monotonic id on first use.
    private _idFor(workspace: Meta.Workspace): number {
        let id = this._workspaceIds.get(workspace);
        if (id === undefined) {
            id = this._nextWorkspaceId++;
            this._workspaceIds.set(workspace, id);
        }
        return id;
    }

    enable(workspaceManager: Meta.WorkspaceManager): void {
        this._workspaceManager = workspaceManager;
    }

    disable(): void {
        // Disconnect all workspace signals
        for (const [key, sig] of this._workspaceSignals) {
            try {
                sig.object.disconnect(sig.id);
                this._logger.debug(`Disconnected workspace signal: ${key}`);
            } catch (e) {
                this._logger.error(`Failed to disconnect workspace signal ${key}: ${e}`);
            }
        }
        this._workspaceSignals.clear();

        // Clear workspace data (WeakMap will be garbage collected)
        this._workspaceWindows = new WeakMap();
        this._workspaceManager = null;
    }

    getWorkspaceData(workspace: Meta.Workspace): WorkspaceData {
        let data = this._workspaceWindows.get(workspace);
        if (!data) {
            data = { tiled: [], exceptions: [] };
            this._workspaceWindows.set(workspace, data);
        }
        return data;
    }

    getActiveWorkspaceData(): WorkspaceData | null {
        if (!this._workspaceManager) {
            return null;
        }
        const workspace = this._workspaceManager.get_active_workspace();
        if (!workspace) {
            return null;
        }
        return this.getWorkspaceData(workspace);
    }

    addWindow(workspace: Meta.Workspace, win: Meta.Window, isException: boolean): void {
        const data = this.getWorkspaceData(workspace);
        if (isException) {
            if (!data.exceptions.includes(win)) {
                data.exceptions.push(win);
            }
        } else {
            if (!data.tiled.includes(win)) {
                data.tiled.push(win);
            }
        }
    }

    removeWindow(workspace: Meta.Workspace, win: Meta.Window): void {
        const data = this.getWorkspaceData(workspace);

        const tiledIndex = data.tiled.indexOf(win);
        if (tiledIndex > -1) {
            data.tiled.splice(tiledIndex, 1);
        }

        const exceptionsIndex = data.exceptions.indexOf(win);
        if (exceptionsIndex > -1) {
            data.exceptions.splice(exceptionsIndex, 1);
        }
    }

    connectToWorkspace(workspace: Meta.Workspace, callbacks: WorkspaceCallbacks): void {
        const key = `workspace-${this._idFor(workspace)}`;

        // Skip if already connected
        if (this._workspaceSignals.has(`${key}-added`)) {
            this._logger.debug(`Workspace ${workspace.index()} already connected, skipping`);
            return;
        }

        this._logger.debug(`Connecting to workspace ${workspace.index()}`);

        // Connect window-added signal
        const addedId = workspace.connect('window-added', (ws: Meta.Workspace, win: Meta.Window) => {
            callbacks.onWindowAdded(ws, win);
        });
        this._workspaceSignals.set(`${key}-added`, { object: workspace, id: addedId });

        // Connect window-removed signal
        const removedId = workspace.connect('window-removed', (ws: Meta.Workspace, win: Meta.Window) => {
            callbacks.onWindowRemoved(ws, win);
        });
        this._workspaceSignals.set(`${key}-removed`, { object: workspace, id: removedId });
    }

    connectToAllWorkspaces(callbacks: WorkspaceCallbacks): void {
        if (!this._workspaceManager) {
            this._logger.error('Cannot connect to workspaces: WorkspaceManager not initialized');
            return;
        }

        const numWorkspaces = this._workspaceManager.get_n_workspaces();
        this._logger.debug(`Connecting to ${numWorkspaces} workspace(s)`);

        for (let i = 0; i < numWorkspaces; i++) {
            const workspace = this._workspaceManager.get_workspace_by_index(i);
            if (workspace) {
                this.connectToWorkspace(workspace, callbacks);
            }
        }
    }

    // Disconnect signals for workspaces that are no longer present in the
    // manager. Call this on 'workspace-removed' so removed workspaces don't
    // leave stale tracked signals behind.
    pruneRemovedWorkspaces(): void {
        if (!this._workspaceManager) {
            return;
        }

        const live = new Set<Meta.Workspace>();
        for (let i = 0; i < this._workspaceManager.get_n_workspaces(); i++) {
            const workspace = this._workspaceManager.get_workspace_by_index(i);
            if (workspace) {
                live.add(workspace);
            }
        }

        for (const [key, sig] of [...this._workspaceSignals]) {
            if (!live.has(sig.object as Meta.Workspace)) {
                try {
                    sig.object.disconnect(sig.id);
                    this._logger.debug(`Pruned stale workspace signal: ${key}`);
                } catch (e) {
                    this._logger.error(`Failed to disconnect stale workspace signal ${key}: ${e}`);
                }
                this._workspaceSignals.delete(key);
            }
        }
    }

}
