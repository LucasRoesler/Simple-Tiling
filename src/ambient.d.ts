/// <reference types="@girs/gjs" />
/// <reference types="@girs/gjs/dom" />
/// <reference types="@girs/gnome-shell/ambient" />
/// <reference types="@girs/gnome-shell/extensions/global" />

// Additional ambient module declarations for GNOME Shell resources
declare module 'resource:///org/gnome/shell/extensions/extension.js' {
    import type Gio from '@girs/gio-2.0';
    
    export class Extension {
        constructor(metadata: ExtensionMetadata);
        enable(): void;
        disable(): void;
        getSettings(schema?: string): Gio.Settings;
        path: string;
        uuid: string;
        metadata: ExtensionMetadata;
        openPreferences(): void;
    }
    
    export interface ExtensionMetadata {
        uuid: string;
        name: string;
        description: string;
        'shell-version': string[];
        url?: string;
        version?: number | string;
        path?: string;
        dir?: Gio.File;
    }
    
    export function gettext(str: string): string;
    export function ngettext(str: string, strPlural: string, n: number): string;
}

declare module 'resource:///org/gnome/shell/ui/main.js' {
    export const overview: any;
    export const panel: any;
    export const sessionMode: any;
    export const layoutManager: any;
    export const uiGroup: any;
    export const messageTray: any;
    export const screenShield: any;
    export const wm: any;
}

declare module 'resource:///org/gnome/shell/ui/popupMenu.js' {
    export class PopupBaseMenuItem {
        constructor(params?: any);
        activate(event: any): void;
        destroy(): void;
    }
    
    export class PopupMenuItem extends PopupBaseMenuItem {
        constructor(text: string, params?: any);
        label: any;
    }
    
    export class PopupSeparatorMenuItem extends PopupBaseMenuItem {
        constructor();
    }
    
    export class PopupMenuSection {
        constructor();
        addMenuItem(item: PopupBaseMenuItem): void;
    }
}

declare module 'resource:///org/gnome/shell/ui/quickSettings.js' {
    import type GObject from '@girs/gobject-2.0';
    import type St from '@girs/st-14';
    
    export class QuickToggle extends St.Button {
        static metaInfo: {
            GTypeName: string;
            Properties: Record<string, any>;
        };
        
        constructor(params?: any);
        
        title: string;
        subtitle: string;
        iconName: string;
        checked: boolean;
        menu: any;
    }
    
    export class QuickMenuToggle extends QuickToggle {
        constructor(params?: any);
        menu: any;
    }
    
    export class SystemIndicator extends St.BoxLayout {
        constructor();
        quickSettingsItems: any[];
        destroy(): void;
        _addIndicator(): any;
    }
    
    export function addQuickSettingsItem(item: any): void;
}

// Global objects
declare const global: {
    display: any;
    workspace_manager: any;
    get_current_time(): number;
    get_pointer?(): [number, number];
    get_window_actors(): any[];
    stage: any;
};

// Import required types into global scope
import '@girs/gjs';
import '@girs/gjs/dom';
import '@girs/gnome-shell/ambient';
import '@girs/gnome-shell/extensions/global';