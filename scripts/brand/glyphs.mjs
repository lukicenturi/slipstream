// Shared helpers for the brand generators (make-wordmark.mjs, make-icons.mjs).
//
// These scripts do not run from the app. The app does not depend on opentype.js,
// @fontsource/geist-sans or playwright. Install them in a scratch folder and run
// the scripts with BRAND_TOOLS pointing at that folder:
//
//   mkdir -p /tmp/brand && cd /tmp/brand && npm init -y
//   npm i opentype.js @fontsource/geist-sans playwright
//   npx playwright install chromium
//   BRAND_TOOLS=/tmp/brand node <repo>/scripts/brand/make-wordmark.mjs
//   BRAND_TOOLS=/tmp/brand node <repo>/scripts/brand/make-icons.mjs
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** The repository root (two levels above this file). */
export const ROOT = fileURLToPath(new URL("../../", import.meta.url));

const TOOLS = process.env.BRAND_TOOLS ?? process.cwd();

/** require() that resolves packages from the scratch folder, not from the app. */
export const toolsRequire = createRequire(join(TOOLS, "noop.js"));

/** Design tokens (app/globals.css). */
export const COLORS = {
  bg: "#0a0b0d",
  text: "#e6e8eb",
  accent: "#f2b544",
};

/** Geist Sans 600, the face of the header wordmark. */
export function loadGeist600() {
  const opentype = toolsRequire("opentype.js");
  const file = toolsRequire.resolve(
    "@fontsource/geist-sans/files/geist-sans-latin-600-normal.woff",
  );
  return opentype.parse(readFileSync(file));
}

/** A number for SVG output: at most 2 decimals, no trailing zeros. */
export function num(value) {
  return String(Math.round(value * 100) / 100);
}

/**
 * Lays out `text` like the browser does with `letter-spacing: <tracking>em`:
 * kerning from the font, then the tracking after every glyph.
 * Returns each glyph with its pen position and the pen position at the end.
 */
export function layout(font, text, fontSize, tracking) {
  const glyphs = font.stringToGlyphs(text);
  const scale = fontSize / font.unitsPerEm;
  const placed = [];
  let x = 0;
  glyphs.forEach((glyph, index) => {
    placed.push({ glyph, x });
    x += glyph.advanceWidth * scale + tracking * fontSize;
    const next = glyphs[index + 1];
    if (next) x += font.getKerningValue(glyph, next) * scale;
  });
  return { placed, end: x };
}

/** SVG path data of one glyph with its origin at (x, baseline). */
export function glyphPath(glyph, x, baseline, fontSize) {
  return glyph.getPath(x, baseline, fontSize).toPathData(2);
}

/** Wordmark proportions: a 1.5 px bar 2 px under the baseline at 15 px type. */
export const WORDMARK = {
  text: "slipstream",
  split: 4, // "slip" | "stream"
  tracking: -0.02,
  barGap: 2 / 15,
  barThickness: 1.5 / 15,
};

/**
 * The "s" monogram in pixels on a `size` canvas: the glyph path and the amber
 * bar (width = the advance width of "s", thickness 7 % of the canvas, 6 % of
 * the canvas below the baseline). The glyph and the bar are centred as one
 * group. `glyphScale` shrinks the group (maskable icon). `snap` rounds the
 * baseline and the bar edges to whole pixels, for the small favicon layers.
 */
export function monogram(font, { size, glyphScale = 1, snap = false }) {
  const glyph = font.charToGlyph("s");
  const fontSize = 0.9375 * size * glyphScale; // 480 on a 512 canvas
  const scale = fontSize / font.unitsPerEm;
  const advance = glyph.advanceWidth * scale;
  const inkTop = glyph.getBoundingBox().y2 * scale;
  const round = snap ? Math.round : (value) => value;
  const gap = snap ? Math.max(1, Math.round(0.06 * size * glyphScale)) : 0.06 * size * glyphScale;
  const thickness = snap
    ? Math.max(1, Math.round(0.07 * size * glyphScale))
    : 0.07 * size * glyphScale;
  const groupHeight = inkTop + gap + thickness;
  const baseline = round((size - groupHeight) / 2 + inkTop);
  const left = round((size - advance) / 2);
  const right = round((size + advance) / 2);
  return {
    path: glyphPath(glyph, left, baseline, fontSize),
    bar: { x: left, y: baseline + gap, width: right - left, height: thickness },
  };
}

/** The "s" alone, its ink box centred and 74 % of the canvas high (push badge). */
export function badgeGlyph(font, size) {
  const glyph = font.charToGlyph("s");
  const box = glyph.getBoundingBox();
  const fontSize = ((0.74 * size) / (box.y2 - box.y1)) * font.unitsPerEm;
  const scale = fontSize / font.unitsPerEm;
  const x = (size - (box.x2 - box.x1) * scale) / 2 - box.x1 * scale;
  const baseline = (size - (box.y2 - box.y1) * scale) / 2 + box.y2 * scale;
  return glyphPath(glyph, x, baseline, fontSize);
}

/** The monogram as an SVG document. `radius` is a fraction of the canvas. */
export function monogramSvg(font, { size, radius = 0, glyphScale = 1, snap = false }) {
  const { path, bar } = monogram(font, { size, glyphScale, snap });
  const r = radius ? ` rx="${num(radius * size)}"` : "";
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">`,
    `<rect width="${size}" height="${size}"${r} fill="${COLORS.bg}"/>`,
    `<path fill="${COLORS.text}" d="${path}"/>`,
    `<rect x="${num(bar.x)}" y="${num(bar.y)}" width="${num(bar.width)}" height="${num(bar.height)}" fill="${COLORS.accent}"/>`,
    `</svg>`,
    "",
  ].join("\n");
}
