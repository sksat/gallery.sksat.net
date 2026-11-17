// The photo id used in public URLs (/photo/<public_id>). Lowercase letters
// and digits without the look-alikes 0/o and 1/l/i, so it can be read out
// or typed from a screenshot. Must match the CHECK in
// migrations/0003_visibility.sql.

export const PUBLIC_ID_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
export const PUBLIC_ID_LENGTH = 10;
export const PUBLIC_ID_RE = new RegExp(
  `^[${PUBLIC_ID_ALPHABET}]{${PUBLIC_ID_LENGTH}}$`,
);

// Largest multiple of the alphabet size that fits in a byte; bytes at or
// above it are dropped so every symbol is equally likely.
const BYTE_LIMIT =
  Math.floor(256 / PUBLIC_ID_ALPHABET.length) * PUBLIC_ID_ALPHABET.length;

/** Fills `n` random bytes. Injectable for tests. */
export type RandomBytes = (n: number) => Uint8Array;

const cryptoBytes: RandomBytes = (n) =>
  crypto.getRandomValues(new Uint8Array(n));

/** A fresh public id from crypto randomness (rejection sampling). */
export const generatePublicId = (random: RandomBytes = cryptoBytes): string => {
  let id = "";
  while (id.length < PUBLIC_ID_LENGTH) {
    for (const b of random(PUBLIC_ID_LENGTH)) {
      if (b >= BYTE_LIMIT) continue;
      id += PUBLIC_ID_ALPHABET[b % PUBLIC_ID_ALPHABET.length];
      if (id.length === PUBLIC_ID_LENGTH) break;
    }
  }
  return id;
};
