///////////////////////////////////////////////////////////////
//     Simple-Tiling – MODERN MENU (GNOME Shell 45+)         //
//     Original © 2025 Domoel – MIT                         //
//     Fork © 2025 Lucas Roesler – MIT                      //
///////////////////////////////////////////////////////////////

// ── GLOBAL IMPORTS ────────────────────────────────────────
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class SimpleTilingPrefs extends ExtensionPreferences {
    async fillPreferencesWindow(window: Adw.PreferencesWindow): Promise<void> {
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage();
        window.add(page);

        // ── WINDOW GAPS ────────────────────────────────────────────
        const groupGaps = new Adw.PreferencesGroup({
            title: 'Window Gaps',
            description: 'Adjust spacing between windows and screen edges.'
        });
        page.add(groupGaps);

        const rowInnerGap = new Adw.SpinRow({
            title: 'Inner Gap',
            subtitle: 'Space between tiled windows (pixels)',
            adjustment: new Gtk.Adjustment({ lower: 0, upper: 100, step_increment: 1 }),
        });
        groupGaps.add(rowInnerGap);
        settings.bind('inner-gap', rowInnerGap, 'value', Gio.SettingsBindFlags.DEFAULT);

        const rowOuterH = new Adw.SpinRow({
            title: 'Outer Gap (horizontal)',
            subtitle: 'Left / right screen edges (pixels)',
            adjustment: new Gtk.Adjustment({ lower: 0, upper: 100, step_increment: 1 }),
        });
        groupGaps.add(rowOuterH);
        settings.bind('outer-gap-horizontal', rowOuterH, 'value', Gio.SettingsBindFlags.DEFAULT);

        const rowOuterV = new Adw.SpinRow({
            title: 'Outer Gap (vertical)',
            subtitle: 'Top / bottom screen edges (pixels)',
            adjustment: new Gtk.Adjustment({ lower: 0, upper: 100, step_increment: 1 }),
        });
        groupGaps.add(rowOuterV);
        settings.bind('outer-gap-vertical', rowOuterV, 'value', Gio.SettingsBindFlags.DEFAULT);

        // ── WINDOW BEHAVIOR ────────────────────────────────────────────
        const groupBehavior = new Adw.PreferencesGroup({ title: 'Window Behavior' });
        page.add(groupBehavior);

        const rowTilingEnabled = new Adw.ActionRow({
            title: 'Enable Tiling',
            subtitle: 'Toggle automatic tiling of windows on/off'
        });
        
        const tilingSwitch = new Gtk.Switch({
            valign: Gtk.Align.CENTER
        });
        settings.bind('tiling-enabled', tilingSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
        
        rowTilingEnabled.add_suffix(tilingSwitch);
        rowTilingEnabled.set_activatable_widget(tilingSwitch);
        groupBehavior.add(rowTilingEnabled);

        const rowRespectMaximized = new Adw.ActionRow({
            title: 'Respect Maximized Windows',
            subtitle: 'Skip tiling when windows are maximized, otherwise force all windows to tile'
        });
        
        const respectMaximizedSwitch = new Gtk.Switch({
            valign: Gtk.Align.CENTER
        });
        settings.bind('respect-maximized-windows', respectMaximizedSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
        
        rowRespectMaximized.add_suffix(respectMaximizedSwitch);
        rowRespectMaximized.set_activatable_widget(respectMaximizedSwitch);
        groupBehavior.add(rowRespectMaximized);

        const rowNewWindow = new Adw.ComboRow({
            title: 'Open new windows as',
            subtitle: 'Whether a new window starts as Primary or Stack',
            model: new Gtk.StringList({
                strings: ['Stack Window (Default)', 'Primary Window'],
            }),
        });
        groupBehavior.add(rowNewWindow);

        const currentBehavior = settings.get_string('new-window-behavior');
        rowNewWindow.selected = currentBehavior === 'primary' ? 1 : 0;

        rowNewWindow.connect('notify::selected', () => {
            const newVal = rowNewWindow.selected === 1 ? 'primary' : 'stack';
            settings.set_string('new-window-behavior', newVal);
        });

        // ── WINDOW EXCEPTIONS ──────────────────────────────────────────
        const groupExceptions = new Adw.PreferencesGroup({
            title: 'Window Exceptions',
            description: 'Applications that should be ignored by the tiling manager and kept floating.'
        });
        page.add(groupExceptions);

        // Create the exceptions list
        this._createExceptionsList(groupExceptions, settings);

        // ── KEYBINDINGS ────────────────────────────────────────────
        const groupKeys = new Adw.PreferencesGroup({ title: 'Keybindings' });
        page.add(groupKeys);

        const rowKeys = new Adw.ActionRow({
            title: 'Configure Shortcuts',
            subtitle: 'Adjust all shortcuts in GNOME Keyboard settings.',
        });
        groupKeys.add(rowKeys);

        const btnOpenKeyboard = new Gtk.Button({ label: 'Open Keyboard Settings' });
        btnOpenKeyboard.connect('clicked', () => {
            const appInfo = Gio.AppInfo.create_from_commandline(
                'gnome-control-center keyboard', null, Gio.AppInfoCreateFlags.NONE
            );
            appInfo.launch([], null);
        });
        rowKeys.add_suffix(btnOpenKeyboard);
        rowKeys.set_activatable_widget(btnOpenKeyboard);
    }

    _createExceptionsList(parent: Adw.PreferencesGroup, settings: Gio.Settings): void {
        // Header row with add button
        const headerRow = new Adw.ActionRow({
            title: 'Application Exceptions',
            subtitle: 'Applications listed here will be centered and kept floating instead of being tiled.'
        });

        const addButton = new Gtk.Button({
            icon_name: 'list-add-symbolic',
            css_classes: ['flat'],
            tooltip_text: 'Add Exception'
        });

        addButton.connect('clicked', () => {
            this._showAddExceptionDialog(settings, parent);
        });

        headerRow.add_suffix(addButton);
        parent.add(headerRow);

        // Current exceptions list
        const exceptions = settings.get_strv('window-exceptions');
        for (const exception of exceptions) {
            this._addExceptionRow(parent, settings, exception);
        }

        // Also add info about file-based exceptions
        const fileInfoRow = new Adw.ActionRow({
            title: 'File-based Exceptions',
            subtitle: 'The extension also loads exceptions from exceptions.txt in the extension directory.',
            css_classes: ['dim-label']
        });
        parent.add(fileInfoRow);
    }

    _addExceptionRow(parent: Adw.PreferencesGroup, settings: Gio.Settings, exception: string): void {
        const row = new Adw.ActionRow({
            title: exception,
            subtitle: 'Application identifier (WM_CLASS or App ID)'
        });

        const removeButton = new Gtk.Button({
            icon_name: 'list-remove-symbolic',
            css_classes: ['flat', 'destructive-action'],
            tooltip_text: 'Remove Exception'
        });

        removeButton.connect('clicked', () => {
            const exceptions = settings.get_strv('window-exceptions');
            const index = exceptions.indexOf(exception);
            if (index > -1) {
                exceptions.splice(index, 1);
                settings.set_strv('window-exceptions', exceptions);
                const parent = row.get_parent();
                if (parent && 'remove' in parent) {
                    (parent as any).remove(row);
                }
            }
        });

        row.add_suffix(removeButton);
        parent.add(row);
    }

    _showAddExceptionDialog(settings: Gio.Settings, parentGroup: Adw.PreferencesGroup): void {
        const dialog = new Adw.MessageDialog({
            heading: 'Add Window Exception',
            body: 'Enter the application identifier (WM_CLASS or App ID) to exclude from tiling:'
        });

        const entry = new Adw.EntryRow({
            title: 'Application Identifier',
            text: ''
        });

        dialog.set_extra_child(entry);
        dialog.add_response('cancel', 'Cancel');
        dialog.add_response('add', 'Add');
        dialog.set_response_appearance('add', Adw.ResponseAppearance.SUGGESTED);

        dialog.connect('response', (dialog, response) => {
            if (response === 'add') {
                const newException = entry.get_text().trim().toLowerCase();
                if (newException) {
                    const exceptions = settings.get_strv('window-exceptions');
                    if (!exceptions.includes(newException)) {
                        exceptions.push(newException);
                        settings.set_strv('window-exceptions', exceptions);
                        // Add the new row to the parent group
                        this._addExceptionRow(parentGroup, settings, newException);
                    }
                }
            }
            dialog.close();
        });

        dialog.present();
    }
}
