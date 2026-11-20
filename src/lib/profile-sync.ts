import { createHash, createHmac } from "node:crypto";
import { parse } from "yaml";
import { decrypt, encrypt } from "./vault.js";
import { ProfileSchema, loadProfile, type Profile } from "./config.js";
import type { Store } from "../db/store.js";

/**
 * Keeps one current copy of the profile in the database, ENCRYPTED with a key derived from the bot
 * token (which both Vercel and GitHub Actions already have). Vercel holds the newest profile; it
 * publishes it here, and the GitHub jobs read it — so the profile is edited in one place only.
 */
const keyFrom = (token: string) => createHmac("sha256", token).update("opportunity-agent-profile-key").digest("base64url");

export async function publishProfile(store: Store, token = process.env.TELEGRAM_BOT_TOKEN ?? "") {
  const b64 = process.env.PROFILE_YAML_B64;
  if (!b64 || !token) return;
  const hash = createHash("sha256").update(b64).digest("hex").slice(0, 16);
  const cur = await store.getSetting<{ hash: string }>("profile_enc");
  if (cur?.hash === hash) return;
  const data = encrypt(Buffer.from(b64, "base64"), keyFrom(token)).toString("base64");
  await store.setSetting("profile_enc", { hash, data, updated: new Date().toISOString() });
}

/** Newest profile: the encrypted database copy if present, else the local secret/file. */
export async function loadLatestProfile(store: Store, token = process.env.TELEGRAM_BOT_TOKEN ?? ""): Promise<Profile> {
  const cur = token ? await store.getSetting<{ data: string }>("profile_enc") : null;
  if (cur?.data) {
    try {
      return ProfileSchema.parse(parse(decrypt(Buffer.from(cur.data, "base64"), keyFrom(token)).toString("utf8")));
    } catch {
      // Token changed or data corrupt: fall back to the local copy.
    }
  }
  return loadProfile();
}
