/////////////////////////////////////////////////////////////
//      Simple‑Tiling – D-Bus Caller Policy                //
//     Decides which callers may use the D-Bus API          //
/////////////////////////////////////////////////////////////

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export type DBusAccess = 'prefs-only' | 'any';

// gnome-shell runs every extension's prefs.js inside this bus-activated
// service, including when the sandboxed Extensions app opens the prefs window.
const PREFS_SERVICE = 'org.gnome.Shell.Extensions';

const ACCESS_DENIED = 'org.freedesktop.DBus.Error.AccessDenied';
const FAILED = 'org.freedesktop.DBus.Error.Failed';

export function parseDBusAccess(value: string): DBusAccess {
    if (value === 'prefs-only' || value === 'any') {
        return value;
    }
    throw new Error(`Unknown dbus-access value: '${value}'`);
}

/**
 * Run `onAllowed` if the caller of `invocation` may use the API under
 * `access`, otherwise reply AccessDenied. With 'prefs-only', only the current
 * owner of org.gnome.Shell.Extensions passes; without an owner, every call is
 * denied. `onAllowed` must reply to the invocation; if it throws first, the
 * caller gets a Failed error.
 *
 * Sandboxed apps cannot own that name, so the check keeps them out. It does
 * not stop an unsandboxed process from replacing the name owner.
 */
export function whenCallerAllowed(
    invocation: Gio.DBusMethodInvocation,
    access: DBusAccess,
    onAllowed: () => void,
): void {
    if (access === 'any') {
        runReplying(invocation, onAllowed);
        return;
    }

    Gio.DBus.session.call(
        'org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus',
        'GetNameOwner', new GLib.Variant('(s)', [PREFS_SERVICE]),
        new GLib.VariantType('(s)'), Gio.DBusCallFlags.NONE, -1, null,
        (_connection, result) => {
            let owner: string;
            try {
                [owner] = Gio.DBus.session.call_finish(result).deep_unpack() as [string];
            } catch (e) {
                invocation.return_dbus_error(ACCESS_DENIED,
                    `Cannot resolve the owner of ${PREFS_SERVICE}: ${errorMessage(e)}`);
                return;
            }

            if (owner !== invocation.get_sender()) {
                invocation.return_dbus_error(ACCESS_DENIED,
                    `${invocation.get_method_name()} is only available to extension preferences`);
                return;
            }

            runReplying(invocation, onAllowed);
        });
}

// GJS replies to a throwing method handler only while the handler runs
// synchronously, and only since GJS 1.87.1, so reply here on a throw.
function runReplying(invocation: Gio.DBusMethodInvocation, onAllowed: () => void): void {
    try {
        onAllowed();
    } catch (e) {
        invocation.return_dbus_error(FAILED, errorMessage(e));
    }
}

function errorMessage(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}
