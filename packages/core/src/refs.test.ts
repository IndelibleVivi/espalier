import { describe, expect, it } from "vitest";
import { canonicalRef, compactRef, parseRef, withoutRevision } from "./index.js";

describe("stable references", () => {
  it("round-trips canonical and compact refs without losing the anchor revision", () => {
    const canonical = canonicalRef("canopy", "relation", "air-to-audio", 118);
    expect(canonical).toBe("espalier://canopy/relation/air-to-audio?rev=118");
    expect(parseRef(canonical)).toEqual({ projectId: "canopy", type: "relation", id: "air-to-audio", revision: 118 });
    expect(parseRef(compactRef("canopy", "relation", "air-to-audio", 118))).toEqual({ projectId: "canopy", type: "relation", id: "air-to-audio", revision: 118 });
    expect(withoutRevision("esp:canopy/rel/air-to-audio@118")).toBe("espalier://canopy/relation/air-to-audio");
  });

  it("rejects unknown unnamespaced reference kinds", () => {
    expect(() => parseRef("esp:canopy/widget/thing@1")).toThrow("Unknown Espalier reference type");
  });
});
