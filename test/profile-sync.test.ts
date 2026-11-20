import { afterEach, describe, expect, it, vi } from "vitest";
import { loadLatestProfile, publishProfile } from "../src/lib/profile-sync.js";
import type { Store } from "../src/db/store.js";

const yaml = `name: Sync Test\nnationality: Kenyan\ncountry_of_residence: Kenya\ntimezone: Africa/Nairobi\nlanguages: [English]\neducation: []\nfields: []\nskills: []\npayout_methods: []\n`;

function fakeStore() {
  const m = new Map<string, unknown>();
  return { m, store: { getSetting: async (k: string) => m.get(k) ?? null, setSetting: async (k: string, v: unknown) => void m.set(k, v) } as unknown as Store };
}
afterEach(() => vi.unstubAllEnvs());

describe("profile sync", () => {
  it("Vercel publishes an encrypted copy; GitHub reads it with the same bot token", async () => {
    const { m, store } = fakeStore();
    vi.stubEnv("PROFILE_YAML_B64", Buffer.from(yaml).toString("base64"));
    await publishProfile(store, "123:token");
    const saved = m.get("profile_enc") as { data: string };
    expect(Buffer.from(saved.data, "base64").toString()).not.toContain("Sync Test"); // encrypted
    vi.stubEnv("PROFILE_YAML_B64", "");
    expect((await loadLatestProfile(store, "123:token")).name).toBe("Sync Test");
  });
  it("does nothing new when the profile hasn't changed", async () => {
    const { m, store } = fakeStore();
    vi.stubEnv("PROFILE_YAML_B64", Buffer.from(yaml).toString("base64"));
    await publishProfile(store, "t");
    const first = m.get("profile_enc");
    await publishProfile(store, "t");
    expect(m.get("profile_enc")).toBe(first);
  });
  it("a different token can't read it (falls back to the local copy)", async () => {
    const { store } = fakeStore();
    vi.stubEnv("PROFILE_YAML_B64", Buffer.from(yaml).toString("base64"));
    await publishProfile(store, "right");
    vi.stubEnv("PROFILE_YAML_B64", Buffer.from(yaml.replace("Sync Test", "Local Copy")).toString("base64"));
    expect((await loadLatestProfile(store, "wrong")).name).toBe("Local Copy");
  });
});
