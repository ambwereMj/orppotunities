import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";

const widthOfOnlyPage = async (pdf: Buffer) => (await PDFDocument.load(pdf)).getPage(0).getWidth();
import { extractPage, pageCount } from "../src/vault/pages.js";
import { handleUpdate } from "../src/telegram/handler.js";
import { encrypt, decrypt } from "../src/lib/vault.js";
import type { Store } from "../src/db/store.js";

const PASS = "a-long-test-passphrase-123";

async function threePagePdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  // Each page gets its own width so we can tell which one was kept (text is stored compressed).
  for (const [label, width] of [["LEAVING CERT", 300], ["KCSE CERTIFICATE", 400], ["RESULT SLIP", 500]] as const) {
    const p = doc.addPage([width, 200]);
    p.drawText(label, { x: 20, y: 100, size: 14, font });
  }
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

describe("PDF pages", () => {
  it("counts pages and keeps only the middle one", async () => {
    const pdf = await threePagePdf();
    expect(await pageCount(pdf)).toBe(3);
    const { page, count } = await extractPage(pdf, 2);
    expect(count).toBe(3);
    expect(await pageCount(page)).toBe(1);
    expect(await widthOfOnlyPage(page)).toBe(400); // the middle page
  });
  it("rejects out-of-range pages and non-PDFs", async () => {
    await expect(extractPage(await threePagePdf(), 4)).rejects.toThrow();
    expect(await pageCount(Buffer.from("JPEG"))).toBeNull();
  });
});

describe("/page and /label in Telegram", () => {
  const stored = new Map<string, Buffer>();
  const settings = new Map<string, unknown>();
  const sent: { method: string; body: unknown }[] = [];
  const store = {
    getSetting: async (k: string) => settings.get(k) ?? null,
    setSetting: async (k: string, v: unknown) => void settings.set(k, v),
    db: {
      storage: {
        getBucket: async () => ({ data: { name: "vault" } }),
        createBucket: async () => ({ error: null }),
        from: () => ({
          upload: async (p: string, d: Buffer) => (stored.set(p, d), { error: null }),
          remove: async (ps: string[]) => (ps.forEach((p) => stored.delete(p)), { error: null }),
          download: async (p: string) => ({ data: new Blob([new Uint8Array(stored.get(p)!)]), error: null }),
        }),
      },
    },
  } as unknown as Store;

  beforeEach(async () => {
    stored.clear();
    settings.clear();
    sent.length = 0;
    settings.set("owner_chat_id", "111");
    stored.set("docs/kcse.enc", encrypt(await threePagePdf(), PASS));
    settings.set("documents", {
      kcse: { type: "kcse", path: "docs/kcse.enc", name: "CamScanner.pdf", bytes: 1, uploaded: "x" },
      transcript: { type: "transcript", path: "docs/t.enc", name: "Results slip.pdf", bytes: 1, uploaded: "x" },
    });
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "123:t");
    vi.stubEnv("TELEGRAM_CHAT_ID", "");
    vi.stubEnv("VAULT_PASSPHRASE", PASS);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: { body?: unknown }) => {
        sent.push({ method: String(url).split("/").pop()!, body: init?.body });
        return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }));
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  const msg = (text: string) => ({ message: { chat: { id: 111, type: "private" }, text } });

  it("/page kcse 2 keeps the certificate page, keeps the full scan, and sends it back", async () => {
    await handleUpdate(msg("/page kcse 2"), store);
    const docs = settings.get("documents") as Record<string, { path: string; name: string; type: string }>;
    expect(docs.kcse.name).toBe("CamScanner (page 2).pdf");
    expect(docs.kcse_full.name).toContain("full scan");
    const page = decrypt(stored.get(docs.kcse.path)!, PASS);
    expect(await pageCount(page)).toBe(1);
    expect(await widthOfOnlyPage(page)).toBe(400); // the middle page = the certificate
    expect(stored.has("docs/kcse.enc")).toBe(true); // full scan not deleted
    expect(sent.at(-1)!.method).toBe("sendDocument");
  });

  it("/page with a wrong page number says how many pages there are", async () => {
    await handleUpdate(msg("/page kcse 9"), store);
    expect(String((JSON.parse(String(sent.at(-1)!.body)) as { text: string }).text)).toContain("has 3 page(s)");
  });

  it("/label transcript kcse moves a document to another type", async () => {
    await handleUpdate(msg("/label transcript kcse"), store);
    const docs = settings.get("documents") as Record<string, { type: string; name: string }>;
    expect(docs.kcse.name).toBe("Results slip.pdf");
    expect(docs.kcse_previous.name).toContain("CamScanner");
    expect(docs.transcript).toBeUndefined();
  });
});
