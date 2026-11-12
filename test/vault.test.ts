import { describe, expect, it } from "vitest";
import { decrypt, encrypt } from "../src/lib/vault.js";

describe("vault encryption", () => {
  const pass = "correct horse battery staple";
  it("round-trips", () => {
    const data = Buffer.from("KCSE certificate bytes");
    expect(decrypt(encrypt(data, pass), pass).toString()).toBe("KCSE certificate bytes");
  });
  it("ciphertext does not contain the plaintext", () => {
    expect(encrypt(Buffer.from("SECRET-ID-12345"), pass).includes(Buffer.from("SECRET-ID-12345"))).toBe(false);
  });
  it("wrong passphrase fails", () => {
    expect(() => decrypt(encrypt(Buffer.from("x"), pass), "wrong passphrase!!")).toThrow();
  });
  it("tampering is detected", () => {
    const blob = encrypt(Buffer.from("hello world"), pass);
    blob[blob.length - 1] ^= 1;
    expect(() => decrypt(blob, pass)).toThrow();
  });
  it("rejects short passphrases", () => {
    expect(() => encrypt(Buffer.from("x"), "short")).toThrow();
  });
});
