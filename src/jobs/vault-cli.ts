/**
 * Encrypted document vault (CV, certificates, transcripts).
 *   npm run vault -- put  <file> [name]   encrypt locally, upload to private bucket "vault"
 *   npm run vault -- get  <name> <out>    download and decrypt
 *   npm run vault -- list
 * Needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VAULT_PASSPHRASE (keep the passphrase in a
 * password manager — without it the files cannot be recovered).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { env } from "../lib/config.js";
import { decrypt, encrypt } from "../lib/vault.js";

const BUCKET = "vault";

async function main() {
  const [cmd, a, b] = process.argv.slice(2);
  const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const { data: buckets } = await db.storage.listBuckets();
  if (!buckets?.some((x) => x.name === BUCKET)) await db.storage.createBucket(BUCKET, { public: false });

  if (cmd === "put" && a) {
    const name = (b ?? basename(a)) + ".enc";
    const blob = encrypt(readFileSync(a), env("VAULT_PASSPHRASE"));
    const { error } = await db.storage.from(BUCKET).upload(name, blob, { upsert: true, contentType: "application/octet-stream" });
    if (error) throw error;
    console.log(`stored ${name} (encrypted, ${blob.length} bytes)`);
  } else if (cmd === "get" && a && b) {
    const { data, error } = await db.storage.from(BUCKET).download(a.endsWith(".enc") ? a : `${a}.enc`);
    if (error) throw error;
    writeFileSync(b, decrypt(Buffer.from(await data.arrayBuffer()), env("VAULT_PASSPHRASE")));
    console.log(`decrypted to ${b}`);
  } else if (cmd === "list") {
    const { data, error } = await db.storage.from(BUCKET).list();
    if (error) throw error;
    data.forEach((f) => console.log(f.name));
  } else {
    console.log("usage: vault put <file> [name] | get <name> <out> | list");
  }
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
