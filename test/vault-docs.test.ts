import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checklistDocs, guessType } from "../src/vault/docs.js";
import { handleUpdate } from "../src/telegram/handler.js";
import { decrypt } from "../src/lib/vault.js";
import type { Store } from "../src/db/store.js";

describe("document types", () => {
  it.each([
    ["KCSE result slip.jpg", "kcse_results"],
    ["KCSE certificate.pdf", "kcse"],
    ["JKUAT_transcript_2026.pdf", "transcript"],
    ["admission letter", "enrolment"],
    ["Moringa certificate.pdf", "moringa"],
    ["ICDL.pdf", "icdl"],
    ["passport bio page", "passport"],
    ["my resume.docx", "cv"],
    ["scan001.jpg", null],
  ])("%s -> %s", (name, t) => expect(guessType(name)).toBe(t));

  it("certificates count as ready only when KCSE, Moringa and ICDL are all stored", () => {
    expect(checklistDocs(["kcse", "moringa"])).not.toContain("certificates");
    expect(checklistDocs(["kcse", "moringa", "icdl", "transcript"]).sort()).toEqual(["certificates", "transcript"]);
  });
});

describe("uploading a document from Telegram", () => {
  const sent: { method: string; body: Record<string, unknown> }[] = [];
  const stored = new Map<string, Buffer>();
  const settings = new Map<string, unknown>([["owner_chat_id", "111"]]);
  const store = {
    getSetting: async (k: string) => settings.get(k) ?? null,
    setSetting: async (k: string, v: unknown) => void settings.set(k, v),
    db: {
      storage: {
        getBucket: async () => ({ data: { name: "vault" } }),
        createBucket: async () => ({ error: null }),
        from: () => ({
          upload: async (path: string, data: Buffer) => (stored.set(path, data), { error: null }),
          remove: async (paths: string[]) => (paths.forEach((p) => stored.delete(p)), { error: null }),
          download: async (path: string) => ({ data: new Blob([new Uint8Array(stored.get(path)!)]), error: null }),
        }),
      },
    },
  } as unknown as Store;

  beforeEach(() => {
    sent.length = 0;
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "123:t");
    vi.stubEnv("TELEGRAM_CHAT_ID", "");
    vi.stubEnv("VAULT_PASSPHRASE", "a-long-test-passphrase-123");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: { body?: unknown }) => {
        const u = String(url);
        if (u.includes("/file/bot")) return new Response("PDF-BYTES-OF-TRANSCRIPT");
        const method = u.split("/").pop()!;
        const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
        sent.push({ method, body });
        if (method === "getFile") return new Response(JSON.stringify({ ok: true, result: { file_path: "documents/f.pdf" } }));
        return new Response(JSON.stringify({ ok: true, result: { message_id: 5 } }));
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("stores the file encrypted and auto-labels it from the file name", async () => {
    await handleUpdate({ message: { chat: { id: 111, type: "private" }, document: { file_id: "F1", file_name: "JKUAT_transcript.pdf", file_size: 100 } } }, store);
    const [[path, blob]] = [...stored.entries()];
    expect(path).toMatch(/\.enc$/);
    expect(blob.includes(Buffer.from("PDF-BYTES"))).toBe(false); // ciphertext only
    expect(decrypt(blob, "a-long-test-passphrase-123").toString()).toBe("PDF-BYTES-OF-TRANSCRIPT");
    expect((settings.get("documents") as Record<string, { type: string }>).transcript.type).toBe("transcript");
    expect(String(sent.at(-1)!.body.text)).toContain("Saved as");
  });

  it("asks what it is when the name doesn't say, then saves the choice", async () => {
    await handleUpdate({ message: { chat: { id: 111, type: "private" }, document: { file_id: "F2", file_name: "scan001.jpg", file_size: 100 } } }, store);
    const ask = sent.at(-1)!;
    expect(String(ask.body.text)).toContain("What is it?");
    const kb = (ask.body.reply_markup as { inline_keyboard: { callback_data: string; text: string }[][] }).inline_keyboard.flat();
    const kcse = kb.find((b) => b.text.startsWith("KCSE"))!;
    await handleUpdate({ callback_query: { id: "c1", data: kcse.callback_data, message: { chat: { id: 111 }, message_id: 9 } } }, store);
    expect((settings.get("documents") as Record<string, { type: string }>).kcse.type).toBe("kcse");
  });

  it("ignores files from anyone else", async () => {
    const before = stored.size;
    await handleUpdate({ message: { chat: { id: 999, type: "private" }, document: { file_id: "F3", file_name: "passport.pdf", file_size: 100 } } }, store);
    expect(stored.size).toBe(before);
  });
});
