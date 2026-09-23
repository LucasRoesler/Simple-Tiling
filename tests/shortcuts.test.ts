import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { formatAccelerator, SHORTCUT_GROUPS } from '../src/shortcuts.ts';

function schemaXml(): string {
    return readFileSync(new URL(
        '../schemas/org.gnome.shell.extensions.simple-tiling.lucasroesler.gschema.xml',
        import.meta.url), 'utf8');
}

describe('formatAccelerator', () => {
    it('spells out modifiers', () => {
        assert.equal(formatAccelerator('<Super><Control><Shift>Right'), 'Super + Ctrl + Shift + Right');
    });

    it('reads Primary as Ctrl', () => {
        assert.equal(formatAccelerator('<Primary><Super>Left'), 'Ctrl + Super + Left');
    });

    it('names keys that have no printable form', () => {
        assert.equal(formatAccelerator('<Super>Return'), 'Super + Enter');
        assert.equal(formatAccelerator('<Alt>Page_Up'), 'Alt + Page Up');
    });

    it('keeps an unmapped key and modifier as they are', () => {
        assert.equal(formatAccelerator('<Super>F5'), 'Super + F5');
        assert.equal(formatAccelerator('<Hyper>F5'), 'Hyper + F5');
    });

    // The prefs capture dialog stores Gtk.accelerator_name() output, which
    // uses lower-case letters and keysym names for punctuation.
    it('renders what the prefs capture dialog writes', () => {
        assert.equal(formatAccelerator('<Control><Shift>a'), 'Ctrl + Shift + A');
        assert.equal(formatAccelerator('<Super>comma'), 'Super + ,');
        assert.equal(formatAccelerator('<super>Right'), 'super + Right');
    });

    it('does not resolve a key name to an inherited property', () => {
        assert.equal(formatAccelerator('<Super>toString'), 'Super + toString');
    });

    it('reports an unset accelerator as disabled', () => {
        assert.equal(formatAccelerator(undefined), 'Disabled');
        assert.equal(formatAccelerator(''), 'Disabled');
    });
});

describe('SHORTCUT_GROUPS', () => {
    // Every "as" key is a shortcut apart from the two exception lists. The
    // catalogue must list every one, or the dialog silently omits a shortcut.
    const NON_SHORTCUT_KEYS = ['default-exceptions', 'custom-exceptions'];
    const schemaKeys = [...schemaXml().matchAll(/<key\b[^>]*\bname="([^"]+)"[^>]*\btype="as"/g)]
        .map(m => m[1] as string)
        .filter(key => !NON_SHORTCUT_KEYS.includes(key));
    const listed = SHORTCUT_GROUPS.flatMap(g => g.entries.map(e => e.key));

    it('lists every shortcut key in the schema', () => {
        assert.deepEqual([...listed].sort(), [...schemaKeys].sort());
    });

    it('lists each key once', () => {
        assert.equal(new Set(listed).size, listed.length);
    });

    it('gives every entry a title', () => {
        for (const group of SHORTCUT_GROUPS) {
            assert.ok(group.title.length > 0);
            for (const entry of group.entries) {
                assert.ok(entry.title.length > 0, entry.key);
            }
        }
    });
});
