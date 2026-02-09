/////////////////////////////////////////////////////////////
//      Simple‑Tiling – Window State Management           //
//     Centralized per-window state using WeakMap         //
//     Pattern based on MosaicWM's windowState.js         //
/////////////////////////////////////////////////////////////

// WeakMap to store state associated with Meta.Window objects
// This avoids polluting native objects with custom properties
import Meta from 'gi://Meta';

const windowStates = new WeakMap<Meta.Window, Record<string, any>>();

export function get(window: Meta.Window, property: string): any {
    const state = windowStates.get(window);
    return state ? state[property] : undefined;
}

export function set(window: Meta.Window, property: string, value: any): void {
    let state = windowStates.get(window);
    if (!state) {
        state = {};
        windowStates.set(window, state);
    }
    state[property] = value;
}

export function has(window: Meta.Window, property: string): boolean {
    const state = windowStates.get(window);
    return state ? property in state : false;
}

export function remove(window: Meta.Window, property: string): void {
    const state = windowStates.get(window);
    if (state) {
        delete state[property];
    }
}

export function getState(window: Meta.Window): Record<string, any> | undefined {
    return windowStates.get(window);
}

export function clear(window: Meta.Window): void {
    windowStates.delete(window);
}
