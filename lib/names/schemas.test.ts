import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  hlBulkPrimaryNamesSchema,
  hlErrorSchema,
  hlPrimaryNameSchema,
  hlResolveSchema,
  MAX_NAME_LOOKUP,
  namesRequestSchema,
  namesResponseSchema,
  resolveErrorSchema,
  resolveResponseSchema,
  ZERO_ADDRESS,
} from "./schemas";

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(join(process.cwd(), "fixtures", name), "utf8"));
}

const TESTOOOR = "0xf26f5551e96ae5162509b25925fffa7f07b2d652";
const VITALIK = "0xd8da6bf26964af9d7eed9e03e53415d37aa96045";

describe("HL Names fixtures", () => {
  it("parses a forward hit and lower-cases the address", () => {
    expect(hlResolveSchema.parse(fixture("hlnames-resolve.json"))).toEqual({ address: TESTOOOR });
  });

  it("parses the zero address, which means no address is set", () => {
    expect(hlResolveSchema.parse({ address: ZERO_ADDRESS }).address).toBe(ZERO_ADDRESS);
  });

  it("parses the 404 and 422 error bodies", () => {
    const notFound = hlErrorSchema.parse(fixture("hlnames-resolve-404.json"));
    expect(notFound.error.status).toBe(404);
    expect(notFound.error.message).toBe("Name is not registered");
    const rejected = hlErrorSchema.parse(fixture("hlnames-resolve-422.json"));
    expect(rejected.error.status).toBe(422);
    expect(rejected.error.details).toContain(".hl");
    expect(hlResolveSchema.safeParse(fixture("hlnames-resolve-404.json")).success).toBe(false);
  });

  it("parses a primary name hit and an empty primary name", () => {
    const raw = fixture("hlnames-primary.json");
    if (typeof raw !== "object" || raw === null || !("hit" in raw) || !("empty" in raw)) {
      throw new Error("Unexpected fixture shape");
    }
    expect(hlPrimaryNameSchema.parse(raw.hit).primaryName).toBe("testooor.hl");
    expect(hlPrimaryNameSchema.parse(raw.empty).primaryName).toBe("");
  });

  it("parses the bulk primary names and drops the extra fields", () => {
    const entries = hlBulkPrimaryNamesSchema.parse(fixture("hlnames-primary-bulk.json"));
    expect(entries).toEqual([{ address: TESTOOOR, primaryName: "testooor.hl" }]);
    expect(hlBulkPrimaryNamesSchema.parse([])).toEqual([]);
  });
});

describe("/api/resolve bodies", () => {
  it("parses a found name", () => {
    expect(
      resolveResponseSchema.parse({ address: TESTOOOR, name: "testooor.hl", kind: "hl" }),
    ).toEqual({ address: TESTOOOR, name: "testooor.hl", kind: "hl" });
  });

  it("rejects an unknown kind and a bad address", () => {
    expect(
      resolveResponseSchema.safeParse({ address: TESTOOOR, name: "a.sol", kind: "sol" }).success,
    ).toBe(false);
    expect(
      resolveResponseSchema.safeParse({ address: "0x12", name: "a.eth", kind: "ens" }).success,
    ).toBe(false);
  });

  it("parses each error body", () => {
    expect(resolveErrorSchema.parse({ error: "invalid_name" })).toEqual({ error: "invalid_name" });
    expect(
      resolveErrorSchema.parse({ error: "name_not_found", name: "nope.hl", kind: "hl" }).kind,
    ).toBe("hl");
    expect(resolveErrorSchema.parse({ error: "resolver_unavailable", kind: "ens" }).error).toBe(
      "resolver_unavailable",
    );
    expect(resolveErrorSchema.safeParse({ error: "other" }).success).toBe(false);
  });
});

describe("/api/names bodies", () => {
  it("lower-cases the request addresses and caps the list", () => {
    const parsed = namesRequestSchema.parse({
      addresses: ["0xF26F5551E96aE5162509B25925fFfa7F07B2D652"],
    });
    expect(parsed.addresses).toEqual([TESTOOOR]);
    expect(namesRequestSchema.safeParse({ addresses: ["vitalik.eth"] }).success).toBe(false);
    const tooMany = Array.from({ length: MAX_NAME_LOOKUP + 1 }, () => TESTOOOR);
    expect(namesRequestSchema.safeParse({ addresses: tooMany }).success).toBe(false);
  });

  it("parses names from both providers and a partial flag", () => {
    const body = {
      names: { [TESTOOOR]: { hl: "testooor.hl" }, [VITALIK]: { ens: "vitalik.eth" } },
      partial: false,
    };
    expect(namesResponseSchema.parse(body)).toEqual(body);
    expect(namesResponseSchema.parse({ names: {}, partial: true })).toEqual({
      names: {},
      partial: true,
    });
  });

  it("rejects keys that are not lower-case addresses", () => {
    expect(
      namesResponseSchema.safeParse({
        names: { "0xF26F5551E96aE5162509B25925fFfa7F07B2D652": { hl: "testooor.hl" } },
        partial: false,
      }).success,
    ).toBe(false);
  });
});
