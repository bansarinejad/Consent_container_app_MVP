"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateRandomKey = generateRandomKey;
exports.encryptBuffer = encryptBuffer;
exports.decryptBuffer = decryptBuffer;
exports.serializeEncryptedPayload = serializeEncryptedPayload;
exports.deserializeEncryptedPayload = deserializeEncryptedPayload;
exports.encryptKeyWithMaster = encryptKeyWithMaster;
exports.decryptKeyWithMaster = decryptKeyWithMaster;
const crypto_1 = __importDefault(require("crypto"));
function generateRandomKey() {
    return crypto_1.default.randomBytes(32);
}
function encryptBuffer(key, plaintext) {
    const iv = crypto_1.default.randomBytes(12);
    const cipher = crypto_1.default.createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return { iv, authTag, ciphertext };
}
function decryptBuffer(key, payload) {
    const decipher = crypto_1.default.createDecipheriv("aes-256-gcm", key, payload.iv);
    decipher.setAuthTag(payload.authTag);
    return Buffer.concat([decipher.update(payload.ciphertext), decipher.final()]);
}
function serializeEncryptedPayload(payload) {
    return Buffer.concat([payload.iv, payload.authTag, payload.ciphertext]);
}
function deserializeEncryptedPayload(serialized) {
    const iv = serialized.subarray(0, 12);
    const authTag = serialized.subarray(12, 28);
    const ciphertext = serialized.subarray(28);
    return { iv, authTag, ciphertext };
}
function encryptKeyWithMaster(masterKey, key) {
    const payload = encryptBuffer(masterKey, key);
    return `${payload.iv.toString("base64")}:${payload.authTag.toString("base64")}:${payload.ciphertext.toString("base64")}`;
}
function decryptKeyWithMaster(masterKey, encoded) {
    const [ivB64, tagB64, cipherB64] = encoded.split(":");
    if (!ivB64 || !tagB64 || !cipherB64) {
        throw new Error("Invalid encrypted key format");
    }
    const payload = {
        iv: Buffer.from(ivB64, "base64"),
        authTag: Buffer.from(tagB64, "base64"),
        ciphertext: Buffer.from(cipherB64, "base64"),
    };
    return decryptBuffer(masterKey, payload);
}
