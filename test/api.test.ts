import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";

describe("API", () => {
  it("responde à checagem de saúde", async () => {
    const res = await createApp().request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
