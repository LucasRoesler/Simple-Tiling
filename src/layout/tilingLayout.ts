/////////////////////////////////////////////////////////////
//      Simple‑Tiling – Layout Engine                      //
//     Pure geometry: window count + area -> rectangles     //
/////////////////////////////////////////////////////////////

// This module is intentionally free of Meta/Clutter dependencies and side
// effects. It computes where windows should go; applying the result (calling
// move_resize_frame) is the caller's job. Keeping it pure makes the tiling
// math easy to read and reason about in isolation.

export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

// Recursively split an area among `count` windows. The first window takes a
// "primary" half and the rest recurse into the remaining "secondary" half.
// The split axis follows the aspect ratio of the area (wide areas split
// left/right, tall areas split top/bottom).
function splitArea(count: number, area: Rect, innerGap: number): Rect[] {
    if (count <= 0) {
        return [];
    }
    if (count === 1) {
        return [area];
    }

    const gap = Math.floor(innerGap / 2);
    let primaryArea: Rect;
    let secondaryArea: Rect;

    if (area.width > area.height) {
        const primaryWidth = Math.floor(area.width / 2) - gap;
        primaryArea = { x: area.x, y: area.y, width: primaryWidth, height: area.height };
        secondaryArea = {
            x: area.x + primaryWidth + innerGap,
            y: area.y,
            width: area.width - primaryWidth - innerGap,
            height: area.height,
        };
    } else {
        const primaryHeight = Math.floor(area.height / 2) - gap;
        primaryArea = { x: area.x, y: area.y, width: area.width, height: primaryHeight };
        secondaryArea = {
            x: area.x,
            y: area.y + primaryHeight + innerGap,
            width: area.width,
            height: area.height - primaryHeight - innerGap,
        };
    }

    return [primaryArea, ...splitArea(count - 1, secondaryArea, innerGap)];
}

/**
 * Compute the rectangle for each of `count` tiled windows within `area`.
 *
 * The top-level split always places the primary window on the LEFT (a wide
 * primary column), regardless of the area's aspect ratio. The remaining
 * windows form a stack on the right that is split aspect-aware via splitArea.
 * Returns one Rect per window, in window order.
 */
export function computeLayout(count: number, area: Rect, innerGap: number): Rect[] {
    if (count <= 0) {
        return [];
    }
    if (count === 1) {
        return [area];
    }

    const gap = Math.floor(innerGap / 2);
    const primaryWidth = Math.floor(area.width / 2) - gap;

    const primary: Rect = { x: area.x, y: area.y, width: primaryWidth, height: area.height };
    const stackArea: Rect = {
        x: area.x + primaryWidth + innerGap,
        y: area.y,
        width: area.width - primaryWidth - innerGap,
        height: area.height,
    };

    return [primary, ...splitArea(count - 1, stackArea, innerGap)];
}
