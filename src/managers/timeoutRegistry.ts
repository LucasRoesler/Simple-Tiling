/////////////////////////////////////////////////////////////
//      Simple‑Tiling – Timeout Registry                  //
//     Centralized timeout management for safe cleanup    //
//     Pattern based on MosaicWM's timing.js              //
/////////////////////////////////////////////////////////////

import GLib from 'gi://GLib';
import { Logger } from '../utils/logger.js';

interface TimeoutEntry {
    sourceId: number;
    name: string;
}

export class TimeoutRegistry {
    private _timeouts: Map<number, TimeoutEntry>;
    private _nextId: number;
    private _logger: Logger | null;

    constructor(logger?: Logger) {
        this._timeouts = new Map();
        this._nextId = 1;
        this._logger = logger || null;
    }

    add(delay: number, callback: () => boolean, name: string = 'unnamed'): number {
        const registryId = this._nextId++;
        const sourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
            this._timeouts.delete(registryId);
            return callback();
        });
        this._timeouts.set(registryId, { sourceId, name });
        this._logger?.debug(`Timeout added: ${name} (id=${registryId})`);
        return registryId;
    }

    addSeconds(seconds: number, callback: () => boolean, name: string = 'unnamed'): number {
        const registryId = this._nextId++;
        const sourceId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, seconds, () => {
            this._timeouts.delete(registryId);
            return callback();
        });
        this._timeouts.set(registryId, { sourceId, name });
        this._logger?.debug(`Timeout (seconds) added: ${name} (id=${registryId})`);
        return registryId;
    }

    remove(registryId: number): void {
        const entry = this._timeouts.get(registryId);
        if (entry) {
            try {
                GLib.source_remove(entry.sourceId);
                this._logger?.debug(`Timeout removed: ${entry.name} (id=${registryId})`);
            } catch (e) {
                this._logger?.error(`Failed to remove timeout ${entry.name}: ${e}`);
            }
            this._timeouts.delete(registryId);
        }
    }

    clearAll(): void {
        const count = this._timeouts.size;
        for (const [registryId, entry] of this._timeouts) {
            try {
                GLib.source_remove(entry.sourceId);
            } catch (e) {
                this._logger?.error(`Failed to remove timeout ${entry.name} during clearAll: ${e}`);
            }
        }
        this._timeouts.clear();
        this._logger?.debug(`Cleared ${count} timeout(s)`);
    }

    get count(): number {
        return this._timeouts.size;
    }

    destroy(): void {
        this.clearAll();
    }
}
