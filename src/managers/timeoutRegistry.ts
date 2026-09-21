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
        this._logger = logger ?? null;
    }

    // Shared bookkeeping for all timer flavors. `schedule` creates the GLib
    // source from the wrapped handler and returns its source id.
    private _register(name: string, schedule: (handler: () => boolean) => number, callback: () => boolean): number {
        const registryId = this._nextId++;
        const sourceId = schedule(() => {
            let keep = false;
            try {
                keep = callback();
            } finally {
                // Stop tracking only once the source is actually done. A callback
                // returning SOURCE_CONTINUE stays tracked so remove()/clearAll()
                // can still cancel it; deleting unconditionally (as before) would
                // leak an unkillable recurring source.
                if (!keep) {
                    this._timeouts.delete(registryId);
                }
            }
            return keep;
        });
        this._timeouts.set(registryId, { sourceId, name });
        this._logger?.debug(`Timeout added: ${name} (id=${registryId})`);
        return registryId;
    }

    add(delay: number, callback: () => boolean, name = 'unnamed'): number {
        return this._register(name,
            (handler) => GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, handler), callback);
    }

    addIdle(callback: () => boolean, name = 'unnamed'): number {
        return this._register(name,
            (handler) => GLib.idle_add(GLib.PRIORITY_DEFAULT, handler), callback);
    }

    addSeconds(seconds: number, callback: () => boolean, name = 'unnamed'): number {
        return this._register(name,
            (handler) => GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, seconds, handler), callback);
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
        for (const [_registryId, entry] of this._timeouts) {
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
}
