"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const multer_1 = __importDefault(require("multer"));
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const zod_1 = require("zod");
const uuid_1 = require("uuid");
const encryption_1 = require("./utils/encryption");
const watermark_1 = require("./utils/watermark");
const prisma_1 = require("./prisma");
const auth_1 = require("./middleware/auth");
const config_1 = require("./config");
const sharp_1 = __importDefault(require("sharp"));
const app = (0, express_1.default)();
const upload = (0, multer_1.default)({ storage: multer_1.default.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });
app.use((0, helmet_1.default)());
app.use((0, cors_1.default)());
app.use(express_1.default.json({ limit: "5mb" }));
async function ensureStorageDir() {
    await promises_1.default.mkdir(config_1.STORAGE_DIR, { recursive: true });
}
function calcAge(dob) {
    const diff = Date.now() - dob.getTime();
    const ageDt = new Date(diff);
    return Math.abs(ageDt.getUTCFullYear() - 1970);
}
async function isBlocked(userId, otherUserId) {
    const count = await prisma_1.prisma.block.count({
        where: {
            OR: [
                { blockerId: userId, blockedUserId: otherUserId },
                { blockerId: otherUserId, blockedUserId: userId },
            ],
        },
    });
    return count > 0;
}
app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
});
app.post("/api/auth/signup", async (req, res) => {
    const bodySchema = zod_1.z.object({
        email: zod_1.z.string().email(),
        password: zod_1.z.string().min(8),
        displayName: zod_1.z.string().min(1),
    });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
    }
    const { email, password, displayName } = parsed.data;
    const emailNormalized = email.trim().toLowerCase();
    try {
        const passwordHash = await bcryptjs_1.default.hash(password, 10);
        const user = await prisma_1.prisma.user.create({
            data: { email: emailNormalized, passwordHash, displayName, ageVerified: false },
        });
        const token = jsonwebtoken_1.default.sign({ userId: user.id }, config_1.JWT_SECRET, { expiresIn: "7d" });
        return res.json({
            token,
            user: {
                id: user.id,
                email: user.email,
                displayName: user.displayName,
                ageVerified: user.ageVerified,
            },
        });
    }
    catch (err) {
        console.error("signup error", err);
        return res.status(400).json({ error: "Unable to create user (email may already exist)" });
    }
});
app.post("/api/auth/login", async (req, res) => {
    const bodySchema = zod_1.z.object({
        email: zod_1.z.string().email(),
        password: zod_1.z.string().min(1),
    });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
    }
    const { email, password } = parsed.data;
    const emailNormalized = email.trim().toLowerCase();
    const user = await prisma_1.prisma.user.findUnique({ where: { email: emailNormalized } });
    if (!user) {
        return res.status(401).json({ error: "Invalid credentials" });
    }
    const valid = await bcryptjs_1.default.compare(password, user.passwordHash);
    if (!valid) {
        return res.status(401).json({ error: "Invalid credentials" });
    }
    const token = jsonwebtoken_1.default.sign({ userId: user.id }, config_1.JWT_SECRET, { expiresIn: "7d" });
    return res.json({
        token,
        user: {
            id: user.id,
            email: user.email,
            displayName: user.displayName,
            ageVerified: user.ageVerified,
        },
    });
});
app.post("/api/age/verify", auth_1.requireAuth, async (req, res) => {
    const bodySchema = zod_1.z.object({
        fullName: zod_1.z.string().min(3),
        dateOfBirth: zod_1.z.string(),
        verificationCode: zod_1.z.string().min(4),
    });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
    }
    const { dateOfBirth } = parsed.data;
    const dob = new Date(dateOfBirth);
    if (Number.isNaN(dob.getTime())) {
        return res.status(400).json({ error: "Invalid date" });
    }
    const age = calcAge(dob);
    if (age < 18) {
        return res.status(403).json({ error: "User must be 18+ to verify" });
    }
    const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    const payload = {
        userId: req.user.id,
        age_over_18: true,
        issued_at: new Date().toISOString(),
    };
    const signedToken = jsonwebtoken_1.default.sign(payload, config_1.AGE_TOKEN_SECRET, { expiresIn: "365d" });
    const ageToken = await prisma_1.prisma.ageToken.upsert({
        where: { userId: req.user.id },
        create: { userId: req.user.id, expiresAt, payload },
        update: { expiresAt, payload },
    });
    await prisma_1.prisma.user.update({
        where: { id: req.user.id },
        data: { ageVerified: true },
    });
    return res.json({ ageToken: signedToken, expiresAt, payload });
});
app.post("/api/images/upload", auth_1.requireAuth, auth_1.requireAdult, upload.single("file"), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: "File required" });
    }
    let workingBuffer = req.file.buffer;
    const key = (0, encryption_1.generateRandomKey)();
    const encrypted = (0, encryption_1.encryptBuffer)(key, workingBuffer);
    const serialized = (0, encryption_1.serializeEncryptedPayload)(encrypted);
    await ensureStorageDir();
    const fileId = (0, uuid_1.v4)();
    const storagePath = path_1.default.join(config_1.STORAGE_DIR, `${fileId}.bin`);
    await promises_1.default.writeFile(storagePath, serialized);
    const masterKey = (0, config_1.getMasterKey)();
    const encryptedKey = (0, encryption_1.encryptKeyWithMaster)(masterKey, key);
    const asset = await prisma_1.prisma.imageAsset.create({
        data: {
            storagePath,
            ownerId: req.user.id,
        },
    });
    await prisma_1.prisma.imageKey.create({
        data: { imageId: asset.id, keyEncrypted: encryptedKey },
    });
    return res.json({ imageId: asset.id });
});
app.get("/api/images/mine", auth_1.requireAuth, auth_1.requireAdult, async (req, res) => {
    const images = await prisma_1.prisma.imageAsset.findMany({
        where: { ownerId: req.user.id },
        select: { id: true, createdAt: true },
        orderBy: { createdAt: "desc" },
    });
    return res.json(images);
});
app.get("/api/images/:imageId/preview", auth_1.requireAuth, auth_1.requireAdult, async (req, res) => {
    const { imageId } = req.params;
    const asset = await prisma_1.prisma.imageAsset.findFirst({
        where: { id: imageId, ownerId: req.user.id },
        include: { imageKey: true },
    });
    if (!asset || !asset.imageKey) {
        return res.status(404).json({ error: "Image not found" });
    }
    try {
        const masterKey = (0, config_1.getMasterKey)();
        const decryptedKey = (0, encryption_1.decryptKeyWithMaster)(masterKey, asset.imageKey.keyEncrypted);
        const encryptedBuffer = await promises_1.default.readFile(asset.storagePath);
        const payload = (0, encryption_1.deserializeEncryptedPayload)(encryptedBuffer);
        const decryptedImage = (0, encryption_1.decryptBuffer)(decryptedKey, payload);
        const png = await (0, sharp_1.default)(decryptedImage).png().toBuffer();
        res.setHeader("Content-Type", "image/png");
        return res.send(png);
    }
    catch (err) {
        console.error("preview error", err);
        return res.status(500).json({ error: "Failed to load image preview" });
    }
});
app.post("/api/shares", auth_1.requireAuth, auth_1.requireAdult, async (req, res) => {
    const bodySchema = zod_1.z.object({
        imageId: zod_1.z.string().uuid(),
        recipientEmail: zod_1.z.string().email(),
        consentTerms: zod_1.z.record(zod_1.z.any()).optional().default({}),
    });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
    }
    const { imageId, recipientEmail, consentTerms } = parsed.data;
    const image = await prisma_1.prisma.imageAsset.findUnique({ where: { id: imageId } });
    if (!image || image.ownerId !== req.user.id) {
        return res.status(403).json({ error: "Image not found or not owned by user" });
    }
    const recipient = await prisma_1.prisma.user.findUnique({
        where: { email: recipientEmail },
    });
    if (!recipient) {
        return res.status(404).json({ error: "Recipient not found" });
    }
    if (recipient.id === req.user.id) {
        return res.status(400).json({ error: "Cannot share with yourself" });
    }
    if (await isBlocked(req.user.id, recipient.id)) {
        return res.status(403).json({ error: "Cannot share due to block between users" });
    }
    const watermarkId = (0, uuid_1.v4)();
    const share = await prisma_1.prisma.imageShare.create({
        data: {
            imageId,
            recipientId: recipient.id,
            senderId: req.user.id,
            consentTerms,
            watermarkId,
        },
    });
    return res.json({ shareId: share.id, watermarkId });
});
app.get("/api/shares/sent", auth_1.requireAuth, auth_1.requireAdult, async (req, res) => {
    const shares = await prisma_1.prisma.imageShare.findMany({
        where: { senderId: req.user.id },
        include: {
            recipient: { select: { id: true, email: true, displayName: true } },
            _count: { select: { viewEvents: true } },
            viewEvents: { orderBy: { viewedAt: "desc" }, take: 1 },
        },
        orderBy: { createdAt: "desc" },
    });
    const result = shares.map((share) => ({
        id: share.id,
        recipient: share.recipient,
        consentTerms: share.consentTerms,
        revoked: share.revoked,
        watermarkId: share.watermarkId,
        createdAt: share.createdAt,
        viewCount: share._count.viewEvents,
        lastViewAt: share.viewEvents[0]?.viewedAt || null,
    }));
    return res.json(result);
});
app.get("/api/shares/received", auth_1.requireAuth, auth_1.requireAdult, async (req, res) => {
    const shares = await prisma_1.prisma.imageShare.findMany({
        where: { recipientId: req.user.id },
        include: {
            sender: { select: { id: true, email: true, displayName: true } },
        },
        orderBy: { createdAt: "desc" },
    });
    return res.json(shares.map((share) => ({
        id: share.id,
        sender: share.sender,
        consentTerms: share.consentTerms,
        revoked: share.revoked,
        watermarkId: share.watermarkId,
        createdAt: share.createdAt,
    })));
});
app.post("/api/shares/:shareId/revoke", auth_1.requireAuth, async (req, res) => {
    const { shareId } = req.params;
    const share = await prisma_1.prisma.imageShare.findUnique({ where: { id: shareId } });
    if (!share || share.senderId !== req.user.id) {
        return res.status(404).json({ error: "Share not found" });
    }
    if (share.revoked) {
        return res.json({ revoked: true });
    }
    await prisma_1.prisma.imageShare.update({ where: { id: shareId }, data: { revoked: true } });
    return res.json({ revoked: true });
});
app.get("/api/shares/:shareId/view", auth_1.requireAuth, auth_1.requireAdult, async (req, res) => {
    const { shareId } = req.params;
    const share = await prisma_1.prisma.imageShare.findUnique({
        where: { id: shareId },
        include: {
            image: { include: { imageKey: true } },
            sender: true,
            recipient: { select: { email: true } },
        },
    });
    if (!share) {
        return res.status(404).json({ error: "Share not found" });
    }
    if (share.recipientId !== req.user.id) {
        return res.status(403).json({ error: "Not authorized to view" });
    }
    if (share.revoked) {
        return res.status(403).json({ error: "Access revoked" });
    }
    if (await isBlocked(share.senderId, share.recipientId)) {
        return res.status(403).json({ error: "Access blocked" });
    }
    const consent = share.consentTerms || {};
    if (consent.expiry) {
        const expiryDate = new Date(consent.expiry);
        if (!Number.isNaN(expiryDate.getTime()) && expiryDate.getTime() < Date.now()) {
            return res.status(403).json({ error: "Share expired" });
        }
    }
    if (!share.image.imageKey) {
        return res.status(500).json({ error: "Missing encryption key" });
    }
    try {
        const masterKey = (0, config_1.getMasterKey)();
        const decryptedKey = (0, encryption_1.decryptKeyWithMaster)(masterKey, share.image.imageKey.keyEncrypted);
        const encryptedBuffer = await promises_1.default.readFile(share.image.storagePath);
        const payload = (0, encryption_1.deserializeEncryptedPayload)(encryptedBuffer);
        const decryptedImage = (0, encryption_1.decryptBuffer)(decryptedKey, payload);
        const invisible = await (0, watermark_1.embedWatermark)(decryptedImage, share.recipient.email);
        const marked = await (0, watermark_1.applyVisibleWatermark)(invisible, share.recipient.email);
        await prisma_1.prisma.viewEvent.create({
            data: {
                imageShareId: share.id,
                viewerId: req.user.id,
                clientInfo: { userAgent: req.headers["user-agent"] },
                eventType: "view",
            },
        });
        res.setHeader("Content-Type", "image/png");
        return res.send(marked);
    }
    catch (err) {
        console.error("view error", err);
        return res.status(500).json({ error: "Failed to load image" });
    }
});
app.get("/api/shares/:shareId/events", auth_1.requireAuth, async (req, res) => {
    const { shareId } = req.params;
    const share = await prisma_1.prisma.imageShare.findUnique({ where: { id: shareId } });
    if (!share || share.senderId !== req.user.id) {
        return res.status(404).json({ error: "Share not found" });
    }
    const events = await prisma_1.prisma.viewEvent.findMany({
        where: { imageShareId: shareId },
        orderBy: { viewedAt: "desc" },
    });
    return res.json(events);
});
app.post("/api/shares/:shareId/events/screenshot", auth_1.requireAuth, async (req, res) => {
    const { shareId } = req.params;
    const share = await prisma_1.prisma.imageShare.findUnique({ where: { id: shareId } });
    if (!share || share.recipientId !== req.user.id) {
        return res.status(404).json({ error: "Share not found" });
    }
    if (share.revoked) {
        return res.status(403).json({ error: "Access revoked" });
    }
    await prisma_1.prisma.viewEvent.create({
        data: {
            imageShareId: shareId,
            viewerId: req.user.id,
            eventType: "screenshot_detected",
            clientInfo: { userAgent: req.headers["user-agent"] },
        },
    });
    return res.json({ ok: true });
});
app.post("/api/report", auth_1.requireAuth, async (req, res) => {
    const bodySchema = zod_1.z.object({
        shareId: zod_1.z.string().uuid(),
        reason: zod_1.z.string().min(3),
    });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
    }
    const share = await prisma_1.prisma.imageShare.findUnique({ where: { id: parsed.data.shareId } });
    if (!share) {
        return res.status(404).json({ error: "Share not found" });
    }
    if (share.senderId !== req.user.id && share.recipientId !== req.user.id) {
        return res.status(403).json({ error: "Cannot report unrelated share" });
    }
    const report = await prisma_1.prisma.report.create({
        data: {
            shareId: share.id,
            reporterId: req.user.id,
            reason: parsed.data.reason,
        },
    });
    return res.json(report);
});
app.post("/api/block", auth_1.requireAuth, async (req, res) => {
    const bodySchema = zod_1.z.object({ userIdToBlock: zod_1.z.string().uuid() });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
    }
    if (parsed.data.userIdToBlock === req.user.id) {
        return res.status(400).json({ error: "Cannot block yourself" });
    }
    const block = await prisma_1.prisma.block.upsert({
        where: { blockerId_blockedUserId: { blockerId: req.user.id, blockedUserId: parsed.data.userIdToBlock } },
        update: {},
        create: { blockerId: req.user.id, blockedUserId: parsed.data.userIdToBlock },
    });
    return res.json(block);
});
app.get("/api/blocks", auth_1.requireAuth, async (req, res) => {
    const blocks = await prisma_1.prisma.block.findMany({
        where: { blockerId: req.user.id },
        include: { blockedUser: { select: { id: true, email: true, displayName: true } } },
        orderBy: { createdAt: "desc" },
    });
    return res.json(blocks);
});
app.delete("/api/block/:userIdToUnblock", auth_1.requireAuth, async (req, res) => {
    const { userIdToUnblock } = req.params;
    if (!userIdToUnblock) {
        return res.status(400).json({ error: "User ID required" });
    }
    await prisma_1.prisma.block.deleteMany({
        where: { blockerId: req.user.id, blockedUserId: userIdToUnblock },
    });
    return res.json({ unblocked: true, userId: userIdToUnblock });
});
app.get("/api/debug/stats", auth_1.requireAuth, auth_1.requireAdult, async (_req, res) => {
    const [users, images, shares, events] = await Promise.all([
        prisma_1.prisma.user.count(),
        prisma_1.prisma.imageAsset.count(),
        prisma_1.prisma.imageShare.count(),
        prisma_1.prisma.viewEvent.count(),
    ]);
    return res.json({ users, images, shares, viewEvents: events });
});
app.post("/api/debug/detect-watermark", auth_1.requireAuth, auth_1.requireAdult, upload.single("file"), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: "File required" });
    }
    try {
        const watermark = await (0, watermark_1.detectWatermark)(req.file.buffer);
        if (!watermark) {
            return res.json({ watermarkId: null });
        }
        const user = await prisma_1.prisma.user.findUnique({ where: { email: watermark } });
        const share = user
            ? await prisma_1.prisma.imageShare.findFirst({
                where: { recipientId: user.id },
                orderBy: { createdAt: "desc" },
            })
            : null;
        return res.json({
            watermarkId: watermark,
            recipient: user
                ? { id: user.id, email: user.email, displayName: user.displayName }
                : null,
            shareId: share?.id || null,
        });
    }
    catch (err) {
        console.error("detect watermark error", err);
        return res.status(500).json({ error: "Failed to detect watermark" });
    }
});
ensureStorageDir()
    .then(() => {
    app.listen(config_1.PORT, () => {
        console.log(`API listening on :${config_1.PORT}`);
    });
})
    .catch((err) => {
    console.error("Failed to start server", err);
    process.exit(1);
});
