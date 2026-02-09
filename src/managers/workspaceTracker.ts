/////////////////////////////////////////////////////////////
//      Simple‑Tiling – Workspace Tracker                 //
//     Per-workspace window tracking and signal mgmt      //
/////////////////////////////////////////////////////////////

import Meta from 'gi://Meta';
import { Logger } from '../utils/logger.js';

export interface WorkspaceData {
    tiled: Meta.Window[];
    exceptions: Meta.Window[];
}

interface SignalConnection {
    object: any;
    id: number;
}

export interface WorkspaceCallbacks {
    onWindowAdded: (workspace: Meta.Workspace, win: Meta.Window) => void;
    onWindowRemoved: (workspace: Meta.Workspace, win: Meta.Window) => void;
}

export class WorkspaceTracker {
    private _workspaceWindows: WeakMap<Meta.Workspace, WorkspaceData>;
    private _workspaceFingerprints: WeakMap<Meta.Workspace, string>;
    private _workspaceSignals: Map<string, SignalConnection>;
    private _logger: Logger;
    private _workspaceManager: Meta.WorkspaceManager | null;

    constructor(logger: Logger) {
        this._logger = logger;
        this._workspaceWindows = new WeakMap();
        this._workspaceFingerprints = new WeakMap();
        this._workspaceSignals = new Map();
        this._workspaceManager = null;
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
        this._workspaceFingerprints = new WeakMap();
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
        if (!this._workspaceManager) return null;
        const workspace = this._workspaceManager.get_active_workspace();
        if (!workspace) return null;
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
        if (this._workspaceSignals.has(`${key}-added`)) {
            this._logger.debug(`Workspace ${workspace.index()} already connected, skipping`);
            return;
        }

        this._logger.debug(`Connecting to workspace ${workspace.index()}`);

        // Connect window-added signal
        const addedId = workspace.connect('window-added', (ws: any, win: Meta.Window) => {
            callbacks.onWindowAdded(ws, win);
        });
        this._workspaceSignals.set(`${key}-added`, { object: workspace, id: addedId });

        // Connect window-removed signal
        const removedId = workspace.connect('window-removed', (ws: any, win: Meta.Window) => {
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

    // Workspace fingerprinting for change detection (currently unused, reserved for future optimization)
    createFingerprint(windows: Meta.Window[]): string {
        return windows
            .map(win => win.get_id())
            .sort((a, b) => a - b)
            .join(',');
    }

    updateFingerprint(workspace: Meta.Workspace): void {
        const data = this.getWorkspaceData(workspace);
        const fingerprint = this.createFingerprint(data.tiled);
        this._workspaceFingerprints.set(workspace, fingerprint);
    }

    getFingerprint(workspace: Meta.Workspace): string | undefined {
        return this._workspaceFingerprints.get(workspace);
    }
}
