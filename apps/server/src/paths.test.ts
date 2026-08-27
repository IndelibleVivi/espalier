import { describe, expect, it } from "vitest";
import { isLoopbackHost } from "./paths.js";

describe("service host boundary", () => {
  it("accepts loopback names and refuses LAN or wildcard binding", () => {
    expect(["127.0.0.1", "::1", "localhost"].every(isLoopbackHost)).toBe(true);
    expect(["0.0.0.0", "192.168.1.5", "100.64.0.2"].some(isLoopbackHost)).toBe(false);
  });
});
