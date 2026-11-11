import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Blockie } from "@/components/shared/Blockie";

import { blockieData, blockieDataUri, blockieRuns, blockieSvg, type BlockieData } from "./blockies";

type Reference = { _source: string; addresses: Record<string, BlockieData> };

// Made with ethereum-blockies-base64@1.0.2; `_source` in the file says how.
const reference = JSON.parse(
  readFileSync(join(process.cwd(), "fixtures/blockies-reference.json"), "utf8"),
) as Reference;
const REFERENCE_ADDRESSES = Object.keys(reference.addresses);

const A = "0xf5d81a135f756ca16544e53c20fc20643ec3ad53";
const B = "0x5b5d51203a0f9079f8aeb098a6523a13f298c060";

/** The rects of an SVG string, without the background rect. */
function svgRects(svg: string): { x: number; y: number; width: number; fill: string }[] {
  return [
    ...svg.matchAll(/<rect x="(\d+)" y="(\d+)" width="(\d+)" height="1" fill="([^"]+)"\/>/g),
  ].map((m) => ({ x: Number(m[1]), y: Number(m[2]), width: Number(m[3]), fill: m[4] }));
}

describe("blockieData", () => {
  it("matches the ethereum-blockies-base64 reference for 3 addresses", () => {
    expect(REFERENCE_ADDRESSES).toHaveLength(3);
    for (const address of REFERENCE_ADDRESSES) {
      expect(blockieData(address)).toEqual(reference.addresses[address]);
    }
  });

  it("is deterministic and differs between seeds", () => {
    expect(blockieData(A)).toEqual(blockieData(A));
    expect(blockieData(A)).not.toEqual(blockieData(B));
    expect(blockieData(A).cells).not.toEqual(blockieData(B).cells);
  });

  it("gives size * size cells with values 0, 1 and 2", () => {
    const { cells } = blockieData(A);
    expect(cells).toHaveLength(64);
    expect(new Set(cells)).toEqual(new Set([0, 1, 2]));
    expect(blockieData(A, 5).cells).toHaveLength(25);
  });

  it("mirrors every row", () => {
    for (const size of [8, 5]) {
      for (const address of REFERENCE_ADDRESSES) {
        const { cells } = blockieData(address, size);
        for (let y = 0; y < size; y++) {
          for (let x = 0; x < size; x++) {
            expect(cells[y * size + x]).toBe(cells[y * size + size - 1 - x]);
          }
        }
      }
    }
  });

  it("uses the seed as given (the caller lower-cases it)", () => {
    expect(blockieData(A.toUpperCase().replace("0X", "0x"))).not.toEqual(blockieData(A));
  });
});

describe("blockieRuns", () => {
  it("merges equal neighbours and skips the background", () => {
    const cells = [1, 1, 0, 2, 2, 0, 1, 1, ...new Array<0>(56).fill(0)] as const;
    expect(blockieRuns(cells)).toEqual([
      { x: 0, y: 0, width: 2, value: 1 },
      { x: 3, y: 0, width: 2, value: 2 },
      { x: 6, y: 0, width: 2, value: 1 },
    ]);
  });

  it("covers every non-background cell exactly once", () => {
    for (const address of REFERENCE_ADDRESSES) {
      const { cells } = reference.addresses[address];
      const painted = new Array<number>(64).fill(0);
      for (const run of blockieRuns(cells)) {
        for (let x = run.x; x < run.x + run.width; x++) painted[run.y * 8 + x] = run.value;
      }
      expect(painted).toEqual(cells);
    }
  });
});

describe("blockieSvg", () => {
  it("draws the background and the reference cells", () => {
    const expected = reference.addresses[A];
    const svg = blockieSvg(A);
    expect(svg).toContain('viewBox="0 0 8 8"');
    expect(svg).toContain('width="32" height="32"');
    expect(svg).toContain('shape-rendering="crispEdges"');
    expect(svg).toContain(`<rect width="8" height="8" fill="${expected.bgColor}"/>`);

    const painted = new Array<number>(64).fill(0);
    for (const rect of svgRects(svg)) {
      const value = rect.fill === expected.color ? 1 : rect.fill === expected.spotColor ? 2 : -1;
      for (let x = rect.x; x < rect.x + rect.width; x++) painted[rect.y * 8 + x] = value;
    }
    expect(painted).toEqual(expected.cells);
  });

  it("scales the pixel size", () => {
    expect(blockieSvg(A, { scale: 2 })).toContain('width="16" height="16"');
  });

  it("encodes a data URI", () => {
    const uri = blockieDataUri(A);
    expect(uri.startsWith("data:image/svg+xml;utf8,%3Csvg")).toBe(true);
    expect(decodeURIComponent(uri.slice("data:image/svg+xml;utf8,".length))).toBe(blockieSvg(A));
  });
});

describe("Blockie", () => {
  const render = (address: string, size?: 16 | 32) =>
    renderToStaticMarkup(createElement(Blockie, { address, size }));

  it("lower-cases the address before it seeds", () => {
    const mixed = "0xF5D81A135F756CA16544E53C20FC20643EC3AD53";
    expect(render(mixed)).toBe(render(A));
    expect(render(mixed)).toContain(`data-seed="${A}"`);
    expect(render(mixed)).toContain(`fill="${reference.addresses[A].bgColor}"`);
  });

  it("is decorative, sized and bordered", () => {
    const small = render(A);
    expect(small).toContain('aria-hidden="true"');
    expect(small).toContain("size-4");
    expect(small).toContain("rounded-sm");
    expect(small).toContain("after:border");
    expect(small).toContain("shrink-0");
    const large = render(A, 32);
    expect(large).toContain("size-8");
    expect(large).toContain("rounded-md");
  });
});
