// Renders the icon set from the "s" monogram with headless Chromium:
// app/favicon.ico (16, 32 and 48 px layers), app/apple-icon.png (180 px),
// public/icons/icon-192.png, icon-512.png, icon-maskable-512.png and
// badge-72.png. Run it from a scratch folder with opentype.js,
// @fontsource/geist-sans and playwright installed there (see glyphs.mjs).
// Do not add these packages to the app.
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { ROOT, badgeGlyph, loadGeist600, monogramSvg, toolsRequire } from "./glyphs.mjs";

const { chromium } = toolsRequire("playwright");
const font = loadGeist600();

/** Rounded corners where the platform shows the icon as it is. */
const RADIUS = 0.18;
/** The 16 px layer draws the glyph larger, so it stays legible at that size. */
const ICO_GLYPH_SCALE = { 16: 1.15, 32: 1, 48: 1 };
/** The maskable icon keeps the group inside the 80 % safe zone circle. */
const MASKABLE_SCALE = 0.85;

const browser = await chromium.launch();

async function render(svg, size) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(
    `<!doctype html><html><body style="margin:0;background:transparent">${svg}</body></html>`,
  );
  const png = await page.screenshot({
    omitBackground: true,
    clip: { x: 0, y: 0, width: size, height: size },
  });
  await page.close();
  return png;
}

function badgeSvg(size) {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">`,
    `<path fill="#ffffff" d="${badgeGlyph(font, size)}"/>`,
    `</svg>`,
  ].join("");
}

/** An ICO file with PNG layers (supported by every current browser and OS). */
function ico(layers) {
  const header = Buffer.alloc(6 + 16 * layers.length);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(layers.length, 4);
  let offset = header.length;
  layers.forEach(({ size, png }, index) => {
    const entry = 6 + 16 * index;
    header.writeUInt8(size >= 256 ? 0 : size, entry); // width
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1); // height
    header.writeUInt8(0, entry + 2); // palette size
    header.writeUInt8(0, entry + 3); // reserved
    header.writeUInt16LE(1, entry + 4); // colour planes
    header.writeUInt16LE(32, entry + 6); // bits per pixel
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...layers.map((layer) => layer.png)]);
}

function out(path, data) {
  writeFileSync(join(ROOT, path), data);
  console.log(`wrote ${path} (${data.length} B)`);
}

const layers = [];
for (const size of [16, 32, 48]) {
  const svg = monogramSvg(font, {
    size,
    radius: RADIUS,
    glyphScale: ICO_GLYPH_SCALE[size],
    snap: true,
  });
  layers.push({ size, png: await render(svg, size) });
}
out("app/favicon.ico", ico(layers));
out("app/apple-icon.png", await render(monogramSvg(font, { size: 180, snap: true }), 180));
out(
  "public/icons/icon-192.png",
  await render(monogramSvg(font, { size: 192, radius: RADIUS, snap: true }), 192),
);
out(
  "public/icons/icon-512.png",
  await render(monogramSvg(font, { size: 512, radius: RADIUS }), 512),
);
out(
  "public/icons/icon-maskable-512.png",
  await render(monogramSvg(font, { size: 512, glyphScale: MASKABLE_SCALE }), 512),
);
out("public/icons/badge-72.png", await render(badgeSvg(72), 72));

await browser.close();
