"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.STORAGE_DIR = exports.AGE_TOKEN_SECRET = exports.JWT_SECRET = exports.PORT = void 0;
exports.getMasterKey = getMasterKey;
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
dotenv_1.default.config();
exports.PORT = Number(process.env.PORT || 4000);
exports.JWT_SECRET = process.env.JWT_SECRET || "dev_jwt_secret_change_me";
exports.AGE_TOKEN_SECRET = process.env.AGE_TOKEN_SECRET || process.env.JWT_SECRET || "dev_age_token_secret_change_me";
exports.STORAGE_DIR = process.env.STORAGE_DIR || path_1.default.join(process.cwd(), "storage");
let cachedMasterKey = null;
function getMasterKey() {
    if (cachedMasterKey) {
        return cachedMasterKey;
    }
    const raw = process.env.MASTER_KEY;
    if (!raw) {
        cachedMasterKey = crypto_1.default.randomBytes(32);
        console.warn("MASTER_KEY missing; generated ephemeral key for this process only.");
        return cachedMasterKey;
    }
    const key = Buffer.from(raw, "base64");
    if (key.length !== 32) {
        throw new Error("MASTER_KEY must be a base64 encoded 32 byte value.");
    }
    cachedMasterKey = key;
    return cachedMasterKey;
}
