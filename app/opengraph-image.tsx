import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { cacheLife } from "next/cache";
import { ImageResponse } from "next/og";

export const alt = "Slipstream: follow the smart money on Hyperliquid";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** The wordmark is drawn at about 120 px type (the SVG is outlined at 64 px). */
const WORDMARK_SCALE = 120 / 64;

/** Width and height from the viewBox of the outlined wordmark. */
function svgSize(svg: string): { width: number; height: number } {
  const match = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
  const width = match ? Number(match[1]) : 316.48;
  const height = match ? Number(match[2]) : 60.37;
  return { width: Math.round(width * WORDMARK_SCALE), height: Math.round(height * WORDMARK_SCALE) };
}

/**
 * The wordmark and the font file. "use cache" lets the build prerender the
 * image: with cacheComponents, an uncached file read makes the route dynamic.
 */
async function loadAssets(): Promise<{ wordmark: string; geistMono: ArrayBuffer }> {
  "use cache";
  // The files change only with a deploy.
  cacheLife("max");
  const [wordmark, geistMono] = await Promise.all([
    readFile(join(process.cwd(), "public/brand/wordmark.svg"), "utf8"),
    readFile(join(process.cwd(), "app/fonts/GeistMono-Regular.woff")),
  ]);
  return { wordmark, geistMono: new Uint8Array(geistMono).buffer };
}

/**
 * The Open Graph image: the outlined wordmark (public/brand/wordmark.svg) and
 * one tagline in Geist Mono. ImageResponse cannot read CSS variables, so the
 * colours are the token values from app/globals.css.
 */
export default async function OpenGraphImage() {
  const { wordmark, geistMono } = await loadAssets();
  const mark = svgSize(wordmark);
  const src = `data:image/svg+xml;base64,${Buffer.from(wordmark).toString("base64")}`;

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "#0a0b0d",
      }}
    >
      {/* ImageResponse renders a plain img; next/image does not work here. */}
      <img src={src} width={mark.width} height={mark.height} alt="" />
      <div
        style={{
          marginTop: 44,
          fontFamily: "Geist Mono",
          fontSize: 28,
          color: "#8b919a",
        }}
      >
        Follow the smart money on Hyperliquid
      </div>
    </div>,
    {
      ...size,
      fonts: [{ name: "Geist Mono", data: geistMono, style: "normal", weight: 400 }],
    },
  );
}
