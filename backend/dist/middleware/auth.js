"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAuth = requireAuth;
exports.requireAdult = requireAdult;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const prisma_1 = require("../prisma");
const config_1 = require("../config");
async function requireAuth(req, res, next) {
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) {
        return res.status(401).json({ error: "Authorization header missing" });
    }
    try {
        const payload = jsonwebtoken_1.default.verify(token, config_1.JWT_SECRET);
        const user = await prisma_1.prisma.user.findUnique({ where: { id: payload.userId } });
        if (!user) {
            return res.status(401).json({ error: "User not found" });
        }
        req.user = {
            id: user.id,
            email: user.email,
            displayName: user.displayName,
            ageVerified: user.ageVerified,
        };
        next();
    }
    catch (err) {
        return res.status(401).json({ error: "Invalid or expired token" });
    }
}
function requireAdult(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ error: "Auth required" });
    }
    if (!req.user.ageVerified) {
        return res.status(403).json({ error: "Age verification required" });
    }
    next();
}
