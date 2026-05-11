import crypto from "crypto";

function getSecretKey() {
  const secretKey = "123456789abcdef123456789abcdef12";

  if (!secretKey) {
    throw new Error("SECRET_KEY missing in .env file");
  }

  return secretKey;
}

function getKey() {
  return crypto
    .createHash("sha256")
    .update(getSecretKey())
    .digest();
}

function encryptIt(string) {
  if (!string) return false;

  const encryptMethod = "aes-256-cbc";
  const key = getKey();

  const iv = crypto.randomBytes(16);

  const cipher = crypto.createCipheriv(encryptMethod, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(String(string), "utf8"),
    cipher.final(),
  ]);

  return Buffer.concat([iv, encrypted]).toString("base64");
}

function decryptIt(encryptedString) {
  if (!encryptedString) return false;

  const encryptMethod = "aes-256-cbc";
  const key = getKey();

  const data = Buffer.from(encryptedString, "base64");

  if (!data || data.length <= 16) {
    return false;
  }

  const iv = data.subarray(0, 16);
  const encrypted = data.subarray(16);

  try {
    const decipher = crypto.createDecipheriv(encryptMethod, key, iv);

    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);

    return decrypted.toString("utf8");
  } catch (error) {
    return false;
  }
}


// ---------------- TEST ----------------

// const value = "12345";

// const enc1 = encryptIt(value);
// const enc2 = encryptIt(value);

// console.log("Encrypted 1:");
// console.log(enc1);

// console.log("\nEncrypted 2:");
// console.log(enc2);

// console.log("\nDecrypted 1:");
// console.log(decryptIt(enc1));

// console.log("\nDecrypted 2:");
// console.log(decryptIt(enc2));


// Test your existing encrypted value
const oldEncrypted = "/i5p1vezhzZUrt5loROhN63TgbhcDAB2GMObTRGGIw0=";

console.log("\nOld Encrypted Decrypt:");
console.log(decryptIt(oldEncrypted));