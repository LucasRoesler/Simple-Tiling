/////////////////////////////////////////////////////////////
//      Simple‑Tiling – Shortcut Dialog                    //
//     Read-only list of the extension's shortcuts         //
/////////////////////////////////////////////////////////////

import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import Gio from 'gi://Gio';
import St from 'gi://St';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { formatAccelerator, SHORTCUT_GROUPS } from '../shortcuts.js';

// Titles are translated, so they can outgrow the dialog.
function ellipsizing(label: St.Label): St.Label {
    label.clutterText.ellipsize = Pango.EllipsizeMode.END;
    return label;
}

/**
 * Build the shortcut dialog, listing each shortcut with the accelerator
 * currently stored in `settings`. Returns the dialog unopened; the caller
 * owns its lifetime.
 */
export function createShortcutsDialog(settings: Gio.Settings): ModalDialog.ModalDialog {
    const dialog = new ModalDialog.ModalDialog({ destroyOnClose: true });

    const content = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        styleClass: 'message-dialog-content',
    });
    dialog.contentLayout.add_child(content);

    content.add_child(new St.Label({
        text: _('Simple Tiling Shortcuts'),
        styleClass: 'message-dialog-title',
    }));

    // The list scrolls: it grows with every shortcut added, and the dialog
    // would otherwise be clipped on a short screen.
    const scroll = new St.ScrollView({
        style: 'max-height: 30em;',
        hscrollbarPolicy: St.PolicyType.NEVER,
        xExpand: true,
        yExpand: true,
    });
    content.add_child(scroll);

    const list = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        style: 'spacing: 6px;',
        xExpand: true,
    });
    scroll.set_child(list);

    for (const group of SHORTCUT_GROUPS) {
        list.add_child(ellipsizing(new St.Label({
            text: _(group.title),
            styleClass: 'message-dialog-description',
            style: 'font-weight: bold; padding-top: 6px;',
        })));

        for (const entry of group.entries) {
            const row = new St.BoxLayout({
                orientation: Clutter.Orientation.HORIZONTAL,
                style: 'spacing: 24px;',
                xExpand: true,
            });
            row.add_child(ellipsizing(new St.Label({ text: _(entry.title), xExpand: true })));
            row.add_child(new St.Label({
                text: formatAccelerator(settings.get_strv(entry.key)[0]),
            }));
            list.add_child(row);
        }
    }

    dialog.addButton({
        label: _('Close'),
        action: () => dialog.close(),
        key: Clutter.KEY_Escape,
        default: true,
    });

    return dialog;
}
