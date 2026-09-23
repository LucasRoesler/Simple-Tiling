/////////////////////////////////////////////////////////////
//      Simple‑Tiling – Shortcut Catalogue                 //
//     Names and grouping for the shortcut list            //
/////////////////////////////////////////////////////////////

// Free of Meta/Clutter imports so the tests can check it against the schema.

export interface ShortcutEntry {
    /** gsettings key holding the accelerator. */
    key: string;
    title: string;
}

export interface ShortcutGroup {
    title: string;
    entries: ShortcutEntry[];
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
    {
        title: 'Window Swapping',
        entries: [
            { key: 'swap-primary-window', title: 'Swap with primary' },
            { key: 'swap-left-window', title: 'Swap left' },
            { key: 'swap-right-window', title: 'Swap right' },
            { key: 'swap-up-window', title: 'Swap up' },
            { key: 'swap-down-window', title: 'Swap down' },
        ],
    },
    {
        title: 'Window Focus',
        entries: [
            { key: 'focus-left', title: 'Focus left' },
            { key: 'focus-right', title: 'Focus right' },
            { key: 'focus-up', title: 'Focus up' },
            { key: 'focus-down', title: 'Focus down' },
        ],
    },
    {
        title: 'Primary Width',
        entries: [
            { key: 'grow-primary', title: 'Widen primary' },
            { key: 'shrink-primary', title: 'Narrow primary' },
            { key: 'reset-primary', title: 'Reset primary width' },
        ],
    },
];

// Keyed by lowercased name. Maps, not object literals, so a key such as
// 'toString' cannot resolve to an inherited function.
const MODIFIER_NAMES = new Map<string, string>([
    ['control', 'Ctrl'],
    ['primary', 'Ctrl'],
]);

// Names Gtk.accelerator_name() writes for keys with no printable form, or
// whose keysym name differs from the symbol on the key. The prefs capture
// dialog stores accelerators in exactly that form (src/prefs.ts:636).
const KEY_NAMES = new Map<string, string>([
    ['return', 'Enter'],
    ['page_up', 'Page Up'],
    ['page_down', 'Page Down'],
    ['prior', 'Page Up'],
    ['next', 'Page Down'],
    ['bracketleft', '['],
    ['bracketright', ']'],
    ['backslash', '\\'],
    ['semicolon', ';'],
    ['apostrophe', "'"],
    ['grave', '`'],
    ['comma', ','],
    ['period', '.'],
    ['slash', '/'],
    ['minus', '-'],
    ['equal', '='],
    ['plus', '+'],
    ['space', 'Space'],
]);

function formatKey(name: string): string {
    const mapped = KEY_NAMES.get(name.toLowerCase());
    if (mapped) {
        return mapped;
    }
    // Gtk.accelerator_name() writes plain letters in lower case.
    return name.length === 1 ? name.toUpperCase() : name;
}

/**
 * Turn a gsettings accelerator such as '<Super><Control>Right' into
 * 'Super + Ctrl + Right'. An empty or unset accelerator reads as 'Disabled'.
 * Unknown modifiers and keys pass through under their own name.
 */
export function formatAccelerator(accelerator: string | undefined): string {
    if (!accelerator) {
        return 'Disabled';
    }

    const parts: string[] = [];
    const key = accelerator.replace(/<([^>]+)>/g, (_match, modifier: string) => {
        parts.push(MODIFIER_NAMES.get(modifier.toLowerCase()) ?? modifier);
        return '';
    });

    if (key) {
        parts.push(formatKey(key));
    }
    return parts.join(' + ');
}
