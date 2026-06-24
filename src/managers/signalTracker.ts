/////////////////////////////////////////////////////////////
//      Simple‑Tiling – Signal Tracker                     //
//     Keyed GObject signal connections with leak-free      //
//     bulk disconnect on teardown.                         //
/////////////////////////////////////////////////////////////

import GObject from 'gi://GObject';
import { Logger } from '../utils/logger.js';

interface TrackedSignal {
    object: GObject.Object;
    id: number;
}

// GObject signal callbacks have per-signal argument shapes that a generic
// tracker cannot model; `any` here mirrors the GObject.Object.connect signature.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SignalCallback = (...args: any[]) => any;

/**
 * Tracks GObject signal connections by string key so they can be disconnected
 * individually or all at once. Replaces the ad-hoc maps/arrays that previously
 * tracked signals in several places, giving one consistent teardown path.
 */
export class SignalTracker {
    private _signals: Map<string, TrackedSignal>;
    private _logger?: Logger;

    constructor(logger?: Logger) {
        this._signals = new Map();
        this._logger = logger;
    }

    /**
     * Connect `signalName` on `object` and track it under `key`.
     * Callers that may connect twice should guard with has() first.
     */
    connect(key: string, object: GObject.Object, signalName: string, callback: SignalCallback): number {
        const id = object.connect(signalName, callback);
        this._signals.set(key, { object, id });
        return id;
    }

    has(key: string): boolean {
        return this._signals.has(key);
    }

    /** Disconnect and forget a single tracked signal. No-op if the key is absent. */
    disconnect(key: string): void {
        const sig = this._signals.get(key);
        if (!sig) {
            return;
        }
        try {
            sig.object.disconnect(sig.id);
        } catch {
            // Object already destroyed; the signal was auto-disconnected.
            this._logger?.debug(`Signal already disconnected: ${key}`);
        }
        this._signals.delete(key);
    }

    /** Disconnect and forget every tracked signal. */
    disconnectAll(): void {
        for (const [key, sig] of this._signals) {
            try {
                sig.object.disconnect(sig.id);
            } catch (e) {
                this._logger?.error(`Failed to disconnect signal ${key}: ${e}`);
            }
        }
        this._signals.clear();
    }
}
