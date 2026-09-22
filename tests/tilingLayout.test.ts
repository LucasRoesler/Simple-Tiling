import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
    computeLayout,
    stepPrimaryPercent,
    MAX_PRIMARY_PERCENT,
    MIN_PRIMARY_PERCENT,
    PRIMARY_PERCENT_STEP,
    type Rect,
} from '../src/layout/tilingLayout.ts';

// Widths and gaps where rounding matters: odd widths, and an odd gap that
// cannot split evenly around the divider.
const WIDTHS = [2550, 2551, 1300];
const GAPS = [0, 10, 11];

function area(width: number): Rect {
    return { x: 5, y: 5, width, height: 1398 };
}

// The layout before primaryPercent existed, kept to prove 50% is unchanged.
function legacyLayout(count: number, a: Rect, innerGap: number): Rect[] {
    const split = (n: number, r: Rect): Rect[] => {
        if (n <= 0) return [];
        if (n === 1) return [r];
        const g = Math.floor(innerGap / 2);
        if (r.width > r.height) {
            const w = Math.floor(r.width / 2) - g;
            return [{ ...r, width: w },
                ...split(n - 1, { x: r.x + w + innerGap, y: r.y, width: r.width - w - innerGap, height: r.height })];
        }
        const h = Math.floor(r.height / 2) - g;
        return [{ ...r, height: h },
            ...split(n - 1, { x: r.x, y: r.y + h + innerGap, width: r.width, height: r.height - h - innerGap })];
    };
    if (count <= 0) return [];
    if (count === 1) return [a];
    const w = Math.floor(a.width / 2) - Math.floor(innerGap / 2);
    return [{ ...a, width: w },
        ...split(count - 1, { x: a.x + w + innerGap, y: a.y, width: a.width - w - innerGap, height: a.height })];
}

function overlaps(a: Rect, b: Rect): boolean {
    return a.x < b.x + b.width && b.x < a.x + a.width &&
        a.y < b.y + b.height && b.y < a.y + a.height;
}

describe('computeLayout', () => {
    for (const width of WIDTHS) {
        for (const gap of GAPS) {
            it(`matches the previous layout at 50% (width ${width}, gap ${gap}, 0-4 windows)`, () => {
                for (const count of [0, 1, 2, 3, 4]) {
                    assert.deepEqual(computeLayout(count, area(width), gap, 50),
                        legacyLayout(count, area(width), gap), `${count} windows`);
                }
            });
        }
    }

    // Expected primary widths worked out by hand: floor(width * percent / 100)
    // minus floor(gap / 2). The 1300/35 and 1290/70 cases differ by one pixel
    // from floor(width * (percent / 100)).
    const PRIMARY_WIDTHS: [width: number, percent: number, gap: number, expected: number][] = [
        [2550, 30, 10, 760],
        [2550, 70, 10, 1780],
        [2551, 30, 0, 765],
        [1300, 35, 10, 450],
        [1290, 70, 11, 898],
    ];
    for (const [width, percent, gap, expected] of PRIMARY_WIDTHS) {
        it(`makes the primary ${expected} px wide at ${percent}% of ${width} px with gap ${gap}`, () => {
            const [primary] = computeLayout(2, area(width), gap, percent);
            assert.equal(primary?.width, expected);
        });
    }

    for (const percent of [30, 70]) {
        for (const width of WIDTHS) {
            for (const gap of GAPS) {
                it(`fills the width without overlap at ${percent}% (width ${width}, gap ${gap})`, () => {
                    const rects = computeLayout(4, area(width), gap, percent);
                    for (let i = 0; i < rects.length; i++) {
                        for (let j = i + 1; j < rects.length; j++) {
                            assert.equal(overlaps(rects[i]!, rects[j]!), false, `rects ${i} and ${j} overlap`);
                        }
                    }
                    const right = Math.max(...rects.map(r => r.x + r.width));
                    assert.equal(right, area(width).x + width);
                });
            }
        }
    }

    it('splits a wide stack into columns at 30%', () => {
        const [, first, second] = computeLayout(3, area(2550), 10, 30);
        assert.equal(first?.y, second?.y);
    });

    it('keeps a narrow stack in rows at 70%', () => {
        const [, first, second] = computeLayout(3, area(2550), 10, 70);
        assert.equal(first?.x, second?.x);
    });

    it('gives a single window the whole area whatever the percent', () => {
        assert.deepEqual(computeLayout(1, area(2550), 10, 70), [area(2550)]);
    });
});

describe('stepPrimaryPercent', () => {
    it('steps within the bounds', () => {
        assert.equal(stepPrimaryPercent(50, 5), 55);
    });

    it('clamps at 70', () => {
        assert.equal(stepPrimaryPercent(70, 5), 70);
    });

    it('clamps at 30', () => {
        assert.equal(stepPrimaryPercent(30, -5), 30);
    });
});

describe('primary width bounds', () => {
    it('match the primary-width range in the schema', () => {
        const schema = readFileSync(new URL(
            '../schemas/org.gnome.shell.extensions.simple-tiling.lucasroesler.gschema.xml',
            import.meta.url), 'utf8');
        const key = /<key name="primary-width"[\s\S]*?<\/key>/.exec(schema)?.[0] ?? '';
        const range = /<range min="(\d+)" max="(\d+)"\/>/.exec(key);
        assert.deepEqual([Number(range?.[1]), Number(range?.[2])], [MIN_PRIMARY_PERCENT, MAX_PRIMARY_PERCENT]);
    });

    it('are a whole number of steps apart', () => {
        assert.equal((MAX_PRIMARY_PERCENT - MIN_PRIMARY_PERCENT) % PRIMARY_PERCENT_STEP, 0);
    });
});
