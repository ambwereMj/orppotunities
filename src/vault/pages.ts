import { PDFDocument } from "pdf-lib";

/** Number of pages in a PDF, or null if the file isn't a readable PDF. */
export async function pageCount(data: Buffer): Promise<number | null> {
  if (data.subarray(0, 5).toString("latin1") !== "%PDF-") return null;
  try {
    return (await PDFDocument.load(data, { ignoreEncryption: true })).getPageCount();
  } catch {
    return null;
  }
}

/** A new PDF containing only page `n` (1-based). Throws if out of range. */
export async function extractPage(data: Buffer, n: number): Promise<{ page: Buffer; count: number }> {
  const src = await PDFDocument.load(data, { ignoreEncryption: true });
  const count = src.getPageCount();
  if (!Number.isInteger(n) || n < 1 || n > count) throw new RangeError(`page ${n} of ${count}`);
  const out = await PDFDocument.create();
  const [p] = await out.copyPages(src, [n - 1]);
  out.addPage(p);
  return { page: Buffer.from(await out.save()), count };
}
