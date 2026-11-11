// Writes the outlined brand SVGs: public/brand/wordmark.svg (dark theme),
// public/brand/wordmark-light.svg (light theme), public/brand/monogram.svg and
// app/icon.svg. The glyphs are converted to paths, so no font is needed.
// Run it from a scratch folder with opentype.js and @fontsource/geist-sans
// installed there (see glyphs.mjs). Do not add these packages to the app.
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  COLORS,
  ROOT,
  WORDMARK,
  glyphPath,
  layout,
  loadGeist600,
  monogramSvg,
  num,
} from "./glyphs.mjs";

const font = loadGeist600();
const FONT_SIZE = 64;

function wordmarkSvg(slipColor) {
  const { placed, end } = layout(font, WORDMARK.text, FONT_SIZE, WORDMARK.tracking);
  const scale = FONT_SIZE / font.unitsPerEm;
  // Ink bounds in pen coordinates (baseline at y = 0, y grows downwards).
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const { glyph, x } of placed) {
    const box = glyph.getBoundingBox();
    minX = Math.min(minX, x + box.x1 * scale);
    maxX = Math.max(maxX, x + box.x2 * scale);
    minY = Math.min(minY, -box.y2 * scale);
    maxY = Math.max(maxY, -box.y1 * scale);
  }
  const bar = {
    x: placed[WORDMARK.split].x,
    y: WORDMARK.barGap * FONT_SIZE,
    width: end - placed[WORDMARK.split].x,
    height: WORDMARK.barThickness * FONT_SIZE,
  };
  maxX = Math.max(maxX, bar.x + bar.width);
  maxY = Math.max(maxY, bar.y + bar.height);
  // Shift so the viewBox starts at 0 0.
  const dx = -minX;
  const baseline = -minY;
  const path = (from, to) =>
    placed
      .slice(from, to)
      .map(({ glyph, x }) => glyphPath(glyph, x + dx, baseline, FONT_SIZE))
      .join("");
  const width = num(maxX - minX);
  const height = num(maxY - minY);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Slipstream">`,
    `<title>Slipstream</title>`,
    `<path fill="${slipColor}" d="${path(0, WORDMARK.split)}"/>`,
    `<path fill="${COLORS.accent}" d="${path(WORDMARK.split)}"/>`,
    `<rect x="${num(bar.x + dx)}" y="${num(bar.y + baseline)}" width="${num(bar.width)}" height="${num(bar.height)}" fill="${COLORS.accent}"/>`,
    `</svg>`,
    "",
  ].join("\n");
}

const out = (path, content) => {
  writeFileSync(join(ROOT, path), content);
  console.log(`wrote ${path} (${Buffer.byteLength(content)} B)`);
};

out("public/brand/wordmark.svg", wordmarkSvg(COLORS.text));
out("public/brand/wordmark-light.svg", wordmarkSvg(COLORS.bg));
out("public/brand/monogram.svg", monogramSvg(font, { size: 512 }));
out("app/icon.svg", monogramSvg(font, { size: 512, radius: 0.18 }));
