/**
 * Blockies identicons: the canonical ethereum/blockies algorithm
 * (https://github.com/ethereum/blockies), which MetaMask, Etherscan and most
 * wallets use. No dependency: the PRNG, the colours and the mirrored grid are
 * ported here, so an address gets the same picture as in a wallet.
 *
 * The seed is used as given. Wallets seed with the lower-case address, so the
 * caller lower-cases it (the `Blockie` component does).
 *
 * All PRNG math uses the JavaScript int32 operators (`<<`, `>>`, `^`) and
 * `>>> 0`, exactly as the reference does. The seeding step stores a value that
 * can leave the int32 range, but every later read goes through an int32
 * operator, so the result wraps the same way. fixtures/blockies-reference.json
 * holds the reference output for 3 addresses.
 */

/** 0 = background, 1 = colour, 2 = spot colour. */
export type BlockieCell = 0 | 1 | 2;

export type BlockieData = {
  bgColor: string;
  color: string;
  spotColor: string;
  /** `size * size` cells, row by row. */
  cells: BlockieCell[];
};

/** A horizontal run of equal non-background cells. */
export type BlockieRun = { x: number; y: number; width: number; value: 1 | 2 };

export const BLOCKIE_GRID = 8;

function createRandom(seed: string): () => number {
  const randseed = [0, 0, 0, 0];
  for (let i = 0; i < seed.length; i++) {
    const k = i % 4;
    randseed[k] = (randseed[k] << 5) - randseed[k] + seed.charCodeAt(i);
  }

  return () => {
    const t = randseed[0] ^ (randseed[0] << 11);
    randseed[0] = randseed[1];
    randseed[1] = randseed[2];
    randseed[2] = randseed[3];
    randseed[3] = randseed[3] ^ (randseed[3] >> 19) ^ t ^ (t >> 8);
    return (randseed[3] >>> 0) / ((1 << 31) >>> 0);
  };
}

function createColor(rand: () => number): string {
  const h = Math.floor(rand() * 360);
  const s = rand() * 60 + 40;
  const l = (rand() + rand() + rand() + rand()) * 25;
  return `hsl(${h},${s}%,${l}%)`;
}

function toCell(value: number): BlockieCell {
  return value === 1 ? 1 : value === 2 ? 2 : 0;
}

/** The colours and the cells of a blockie, in the reference call order. */
export function blockieData(seed: string, size = BLOCKIE_GRID): BlockieData {
  const rand = createRandom(seed);
  const color = createColor(rand);
  const bgColor = createColor(rand);
  const spotColor = createColor(rand);

  const dataWidth = Math.ceil(size / 2);
  const mirrorWidth = size - dataWidth;
  const cells: BlockieCell[] = [];
  for (let y = 0; y < size; y++) {
    const row: BlockieCell[] = [];
    for (let x = 0; x < dataWidth; x++) row.push(toCell(Math.floor(rand() * 2.3)));
    const mirror = row.slice(0, mirrorWidth).reverse();
    cells.push(...row, ...mirror);
  }

  return { bgColor, color, spotColor, cells };
}

/** Non-background cells, with equal neighbours in a row merged into one run. */
export function blockieRuns(cells: readonly BlockieCell[], size = BLOCKIE_GRID): BlockieRun[] {
  const runs: BlockieRun[] = [];
  for (let y = 0; y < size; y++) {
    let x = 0;
    while (x < size) {
      const value = cells[y * size + x];
      let end = x + 1;
      while (end < size && cells[y * size + end] === value) end++;
      if (value !== 0) runs.push({ x, y, width: end - x, value });
      x = end;
    }
  }
  return runs;
}

/** The blockie as an SVG string: a background rect and one rect per run. */
export function blockieSvg(
  seed: string,
  { size = BLOCKIE_GRID, scale = 4 }: { size?: number; scale?: number } = {},
): string {
  const data = blockieData(seed, size);
  const px = size * scale;
  const rects = blockieRuns(data.cells, size)
    .map(
      (run) =>
        `<rect x="${run.x}" y="${run.y}" width="${run.width}" height="1" fill="${
          run.value === 1 ? data.color : data.spotColor
        }"/>`,
    )
    .join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" ` +
    `viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges">` +
    `<rect width="${size}" height="${size}" fill="${data.bgColor}"/>${rects}</svg>`
  );
}

/** The SVG as a data URI, for places that need a URL. */
export function blockieDataUri(seed: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(blockieSvg(seed))}`;
}
