const crypto = require("crypto");

const SCRYPT_KEYLEN = 64;
const SALT_BYTES = 16;

const generateSalt = () => crypto.randomBytes(SALT_BYTES).toString("hex");

const hashPin = (pin, salt = generateSalt()) => {
  const key = crypto.scryptSync(String(pin), salt, SCRYPT_KEYLEN);
  return { salt, hash: key.toString("hex") };
};

const verifyPin = (pin, salt, expectedHash) => {
  if (!expectedHash || !salt) return false;
  const key = crypto.scryptSync(String(pin), salt, SCRYPT_KEYLEN);
  const expected = Buffer.from(String(expectedHash), "hex");
  if (key.length !== expected.length) return false;
  return crypto.timingSafeEqual(key, expected);
};

module.exports = { hashPin, verifyPin, generateSalt };