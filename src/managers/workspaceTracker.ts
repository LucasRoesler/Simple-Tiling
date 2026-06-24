/////////////////////////////////////////////////////////////
//      Simple‑Tiling – Workspace Tracker                 //
//     Per-workspace window tracking and signal mgmt      //
/////////////////////////////////////////////////////////////

import Meta from 'gi://Meta';
import { Logger } from '../utils/logger.js';
import { SignalTracker } from './signalTracker.js';

export interface WorkspaceData {
    tiled: Meta.Window[];
    exceptions: Meta.Window[];
}

export interface WorkspaceCallbacks {
    onWindowAdded: (workspace: Meta.Workspace, win: Meta.Window) => void;
    onWindowRemoved: (workspace: Meta.Workspace, win: Meta.Window) => void;
}

export class WorkspaceTracker {
    private _workspaceWindows: WeakMap<Meta.Workspace, WorkspaceData>;
    private _signals: SignalTracker;
    private _logger: Logger;
    private _workspaceManager: Meta.WorkspaceManager | null;

    constructor(logger: Logger) {
        this._logger = logger;
        this._workspaceWindows = new WeakMap();
        this._signals = new SignalTracker(logger);
        this._workspaceManager = null;
    }

    enable(workspaceManager: Meta.WorkspaceManager): void {
        this._workspaceManager = workspaceManager;
    }

    disable(): void {
        this._signals.disconnectAll();

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
        const key = `workspace-${workspace.index()}`;

        // Skip if already connected
        if (this._signals.has(`${key}-added`)) {
            this._logger.debug(`Workspace ${workspace.index()} already connected, skipping`);
            return;
        }

        this._logger.debug(`Connecting to workspace ${workspace.index()}`);

        this._signals.connect(`${key}-added`, workspace, 'window-added',
            (ws: Meta.Workspace, win: Meta.Window) => callbacks.onWindowAdded(ws, win));

        this._signals.connect(`${key}-removed`, workspace, 'window-removed',
            (ws: Meta.Workspace, win: Meta.Window) => callbacks.onWindowRemoved(ws, win));
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

}
