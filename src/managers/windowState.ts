/////////////////////////////////////////////////////////////
//      Simple‑Tiling – Window State Management           //
//     Centralized per-window state using WeakMap         //
//     Pattern based on MosaicWM's windowState.js         //
/////////////////////////////////////////////////////////////

// WeakMap to store state associated with Meta.Window objects
// This avoids polluting native objects with custom properties
import Meta from 'gi://Meta';

/**
 * Type-safe window state properties.
 * Add new properties here with proper types.
 */
export interface WindowStateData {
    /** Signal ID for workspace-changed signal */
    workspaceSignalId?: number;
    /** Previous workspace index for change detection */
    prevWorkspaceIndex?: number;
    /** Registry ID for window ready timer */
    readyTimerId?: number;
}

/**
 * Property keys that can be stored in window state.
 * This provides compile-time checking for property names.
 */
export type WindowStateProperty = keyof WindowStateData;

const windowStates = new WeakMap<Meta.Window, WindowStateData>();

export function get<K extends WindowStateProperty>(
    window: Meta.Window,
    property: K
): WindowStateData[K] | undefined {
    const state = windowStates.get(window);
    return state ? state[property] : undefined;
}

export function set<K extends WindowStateProperty>(
    window: Meta.Window,
    property: K,
    value: NonNullable<WindowStateData[K]>
): void {
    let state = windowStates.get(window);
    if (!state) {
        state = {};
        windowStates.set(window, state);
    }
    state[property] = value;
}

export function has<K extends WindowStateProperty>(
    window: Meta.Window,
    property: K
): boolean {
    const state = windowStates.get(window);
    return state ? property in state : false;
}

export function remove<K extends WindowStateProperty>(
    window: Meta.Window,
    property: K
): void {
    const state = windowStates.get(window);
    if (state) {
        delete state[property];
    }
}

export function getState(window: Meta.Window): WindowStateData | undefined {
    return windowStates.get(window);
}

export function clear(window: Meta.Window): void {
    windowStates.delete(window);
}
