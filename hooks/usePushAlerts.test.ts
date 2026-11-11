import { describe, expect, it } from "vitest";

import { DEFAULT_PUSH_STATE } from "@/lib/push";

import { pushStatus } from "./usePushAlerts";

const idle = { busy: false, error: null, test: { pending: false, message: null } };

describe("pushStatus", () => {
  it("shows the availability first", () => {
    expect(pushStatus("not-configured", { ...DEFAULT_PUSH_STATE, enabled: true }, idle)).toEqual({
      status: "not-configured",
      message: null,
    });
    expect(pushStatus("needs-install", DEFAULT_PUSH_STATE, idle).status).toBe("needs-install");
    expect(pushStatus("unsupported", DEFAULT_PUSH_STATE, idle).status).toBe("unsupported");
  });

  it("shows busy, then an error with its message, then on or off", () => {
    expect(pushStatus("available", DEFAULT_PUSH_STATE, { ...idle, busy: true }).status).toBe(
      "enabling",
    );
    expect(pushStatus("available", DEFAULT_PUSH_STATE, { ...idle, error: "Nope." })).toEqual({
      status: "error",
      message: "Nope.",
    });
    expect(pushStatus("available", { ...DEFAULT_PUSH_STATE, enabled: true }, idle).status).toBe(
      "on",
    );
    expect(pushStatus("available", DEFAULT_PUSH_STATE, idle).status).toBe("off");
  });
});
