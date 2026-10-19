// ─── Sidebar Plot Axis Labels ───
// Italic Newsreader variable names with a smaller italic subscript run, laid
// out by measured width. Newsreader has no Unicode subscript letters, so the
// subscript is drawn as its own run rather than as a U+1D63-style glyph.

const MAIN_PX = 12;
const SUB_PX = 10;   // canvas text floor is 10px
const SUB_DROP = 3;  // subscript baseline offset below the main baseline

function _label(c, main, sub, x, y, alignRight) {
    const mainFont = `italic ${MAIN_PX}px ${_FONT.text}`;
    const subFont = `italic ${SUB_PX}px ${_FONT.text}`;
    c.font = mainFont;
    const mainW = c.measureText(main).width;
    let subW = 0;
    if (sub) { c.font = subFont; subW = c.measureText(sub).width + 0.5; }
    const x0 = alignRight ? x - mainW - subW : x;
    c.textAlign = 'left';
    c.textBaseline = 'alphabetic';
    c.font = mainFont;
    c.fillText(main, x0, y);
    if (sub) {
        c.font = subFont;
        c.fillText(sub, x0 + mainW + 0.5, y + SUB_DROP);
    }
}

/**
 * Draw the x-axis label "r" and a y-axis label (`yMain` with optional `ySub`)
 * for a square sidebar plot whose axes sit `margin` px from the left and bottom.
 */
export function drawPlotLabels(c, ps, margin, yMain, ySub, isLight) {
    c.fillStyle = isLight ? _PALETTE.light.textMuted : _PALETTE.dark.textMuted;
    _label(c, 'r', '', ps - 5, ps - margin + MAIN_PX + 2, true);
    _label(c, yMain, ySub, margin - 5, MAIN_PX + 1, true);
}
