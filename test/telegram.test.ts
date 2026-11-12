import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleUpdate } from "../src/telegram/handler.js";
import { webhookSecret } from "../src/telegram/api.js";
import type { Store } from "../src/db/store.js";

function fakeStore(initial: Record<string, unknown> = {}) {
  const settings = new Map(Object.entries(initial));
  const calls: string[] = [];
  const store = {
    getSetting: async (k: string) => settings.get(k) ?? null,
    setSetting: async (k: string, v: unknown) => void settings.set(k, v),
    setPaused: async (p: boolean) => {
      calls.push(`paused=${p}`);
    },
    isPaused: async () => false,
  } as unknown as Store;
  return { store, settings, calls };
}

const sent: { chat_id: unknown; text: string }[] = [];
beforeEach(() => {
  sent.length = 0;
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "123:test");
  vi.stubEnv("TELEGRAM_CHAT_ID", "");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: { body: string }) => {
      sent.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ ok: true, result: {} }));
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const msg = (chatId: number, text: string, type = "private") => ({ message: { chat: { id: chatId, type }, text } });

describe("bot ownership", () => {
  it("first private /start claims the bot", async () => {
    const { store, settings } = fakeStore();
    await handleUpdate(msg(111, "/start"), store);
    expect(settings.get("owner_chat_id")).toBe("111");
    expect(sent[0].chat_id).toBe("111");
    expect(sent[0].text).toContain("registered as the owner");
  });

  it("ignores other messages before an owner exists", async () => {
    const { store, settings } = fakeStore();
    await handleUpdate(msg(111, "/pause"), store);
    await handleUpdate(msg(222, "/start", "group"), store);
    expect(settings.get("owner_chat_id")).toBeUndefined();
    expect(sent).toHaveLength(0);
  });

  it("a stranger cannot take over or control the bot", async () => {
    const { store, settings, calls } = fakeStore({ owner_chat_id: "111" });
    await handleUpdate(msg(999, "/start"), store);
    await handleUpdate(msg(999, "/pause"), store);
    expect(settings.get("owner_chat_id")).toBe("111");
    expect(calls).toEqual([]);
    expect(sent).toHaveLength(0);
  });

  it("the owner can pause", async () => {
    const { store, calls } = fakeStore({ owner_chat_id: "111" });
    await handleUpdate(msg(111, "/pause"), store);
    expect(calls).toEqual(["paused=true"]);
    expect(sent[0].text).toContain("Paused");
  });
});

describe("webhook secret", () => {
  it("is derived from the token, stable, and token-specific", () => {
    expect(webhookSecret("a")).toBe(webhookSecret("a"));
    expect(webhookSecret("a")).not.toBe(webhookSecret("b"));
    expect(webhookSecret("a")).toMatch(/^[0-9a-f]{64}$/); // allowed charset for Telegram secret_token
    expect(webhookSecret("a")).not.toContain("a:");
  });
});
