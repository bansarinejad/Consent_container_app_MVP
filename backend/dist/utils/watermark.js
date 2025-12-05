"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.embedWatermark = embedWatermark;
exports.detectWatermark = detectWatermark;
exports.applyVisibleWatermark = applyVisibleWatermark;
const sharp_1 = __importDefault(require("sharp"));
function toBits(payload) {
    const bits = [];
    for (const byte of payload) {
        for (let i = 0; i < 8; i += 1) {
            bits.push((byte >> i) & 1);
        }
    }
    return bits;
}
function bitsToBuffer(bits) {
    const bytes = [];
    for (let i = 0; i < bits.length; i += 8) {
        let value = 0;
        for (let b = 0; b < 8 && i + b < bits.length; b += 1) {
            value |= bits[i + b] << b;
        }
        bytes.push(value);
    }
    return Buffer.from(bytes);
}
async function embedWatermark(buffer, watermarkText) {
    const watermarkBytes = Buffer.from(watermarkText, "utf8");
    if (watermarkBytes.length > 255) {
        throw new Error("Watermark too long");
    }
    const payload = Buffer.concat([Buffer.from([watermarkBytes.length]), watermarkBytes]);
    const payloadBits = toBits(payload);
    const { data, info } = await (0, sharp_1.default)(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (payloadBits.length > data.length) {
        throw new Error("Image too small to embed watermark");
    }
    const channels = info.channels || 4;
    const width = info.width || 0;
    const height = info.height || 0;
    // Center region embed (survives moderate crop/resize)
    const size = Math.max(16, Math.floor(Math.min(width, height) / 3));
    const startX = Math.max(0, Math.floor((width - size) / 2));
    const startY = Math.max(0, Math.floor((height - size) / 2));
    let bitIdx = 0;
    const modulation = 1; // very subtle
    for (let y = startY; y < startY + size; y += 1) {
        for (let x = startX; x < startX + size; x += 1) {
            const idx = (y * width + x) * channels;
            const bit = payloadBits[bitIdx % payloadBits.length];
            data[idx + 2] = (data[idx + 2] & 0xfe) | bit;
            data[idx + 2] = Math.min(255, Math.max(0, data[idx + 2] + (bit ? modulation : -modulation)));
            bitIdx += 1;
        }
    }
    // Scatter across the full image for redundancy (pure LSB)
    const flatRepeats = Math.max(1, Math.floor(data.length / payloadBits.length));
    for (let r = 0; r < flatRepeats; r += 1) {
        for (let i = 0; i < payloadBits.length; i += 1) {
            const idx = r * payloadBits.length + i;
            if (idx >= data.length)
                break;
            data[idx] = (data[idx] & 0xfe) | payloadBits[i];
        }
    }
    const withMark = (0, sharp_1.default)(data, {
        raw: { width: info.width, height: info.height, channels: info.channels },
    });
    return withMark.png().toBuffer();
}
async function detectWatermark(buffer) {
    const { data, info } = await (0, sharp_1.default)(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (data.length < 8) {
        return null;
    }
    const maxPayloadBits = 8 + 255 * 8;
    const channels = info.channels || 4;
    const width = info.width || 0;
    const height = info.height || 0;
    // Try to read center pattern grid first.
    const tryPattern = async () => {
        if (!width || !height)
            return null;
        const gridSize = 21;
        const cropSize = Math.min(width, height) * 0.5;
        const left = Math.floor((width - cropSize) / 2);
        const top = Math.floor((height - cropSize) / 2);
        const cropped = await (0, sharp_1.default)(buffer)
            .extract({
            left: Math.max(0, left),
            top: Math.max(0, top),
            width: Math.min(width, Math.floor(cropSize)),
            height: Math.min(height, Math.floor(cropSize)),
        })
            .resize(gridSize, gridSize, { fit: "fill" })
            .removeAlpha()
            .ensureAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });
        const grayBits = [];
        let mean = 0;
        for (let i = 0; i < cropped.data.length; i += channels) {
            const r = cropped.data[i];
            const g = cropped.data[i + 1];
            const b = cropped.data[i + 2];
            mean += (r + g + b) / 3;
        }
        mean = mean / (cropped.data.length / channels);
        for (let i = 0; i < cropped.data.length; i += channels) {
            const r = cropped.data[i];
            const g = cropped.data[i + 1];
            const b = cropped.data[i + 2];
            const val = (r + g + b) / 3;
            grayBits.push(val > mean ? 1 : 0);
        }
        const lenBits = grayBits.slice(0, 8);
        const lenBuf = bitsToBuffer(lenBits);
        const watermarkLength = lenBuf.readUInt8(0);
        if (watermarkLength === 0 || watermarkLength > 255)
            return null;
        const needed = 8 + watermarkLength * 8;
        if (needed > grayBits.length)
            return null;
        const contentBits = grayBits.slice(8, 8 + watermarkLength * 8);
        const payloadBuf = bitsToBuffer(contentBits);
        const candidate = payloadBuf.toString("utf8");
        if (candidate && !/[\uFFFD]/.test(candidate))
            return candidate;
        return null;
    };
    const patternResult = await tryPattern();
    if (patternResult)
        return patternResult;
    // Helper to vote bits from a bitstream with repeats.
    const voteBits = (bits, maxBits) => {
        if (bits.length < 8)
            return null;
        const lenVotes = [];
        for (let pos = 0; pos < 8; pos += 1) {
            let ones = 0;
            let zeros = 0;
            for (let i = pos; i < bits.length && i < maxBits; i += 8) {
                bits[i] === 1 ? ones++ : zeros++;
            }
            lenVotes.push(ones >= zeros ? 1 : 0);
        }
        const lengthBuffer = bitsToBuffer(lenVotes);
        const watermarkLength = lengthBuffer.readUInt8(0);
        const neededBits = 8 + watermarkLength * 8;
        if (watermarkLength === 0 || neededBits > maxBits)
            return null;
        const payloadVotes = [];
        for (let pos = 0; pos < watermarkLength * 8; pos += 1) {
            let ones = 0;
            let zeros = 0;
            for (let i = 8 + pos; i < bits.length && i < maxBits; i += watermarkLength * 8) {
                bits[i] === 1 ? ones++ : zeros++;
            }
            payloadVotes.push(ones >= zeros ? 1 : 0);
        }
        const watermarkBuffer = bitsToBuffer(payloadVotes);
        const watermark = watermarkBuffer.toString("utf8");
        if (!watermark || /[\uFFFD]/.test(watermark))
            return null;
        return watermark;
    };
    // Center region detection (robust to cropping/rescale)
    if (width && height && channels >= 3) {
        const size = Math.max(16, Math.floor(Math.min(width, height) / 3));
        const startX = Math.max(0, Math.floor((width - size) / 2));
        const startY = Math.max(0, Math.floor((height - size) / 2));
        const bits = [];
        let sum = 0;
        let count = 0;
        for (let y = startY; y < startY + size; y += 1) {
            for (let x = startX; x < startX + size; x += 1) {
                const idx = (y * width + x) * channels;
                const blue = data[idx + 2];
                sum += blue;
                count += 1;
            }
        }
        const mean = count ? sum / count : 128;
        for (let y = startY; y < startY + size; y += 1) {
            for (let x = startX; x < startX + size; x += 1) {
                const idx = (y * width + x) * channels;
                const blue = data[idx + 2];
                bits.push(blue > mean ? 1 : 0);
                if (bits.length >= maxPayloadBits)
                    break;
            }
            if (bits.length >= maxPayloadBits)
                break;
        }
        const candidate = voteBits(bits, Math.min(maxPayloadBits, bits.length));
        if (candidate)
            return candidate;
    }
    // Fallback to full-image LSB majority.
    const repeats = Math.max(1, Math.floor(data.length / maxPayloadBits));
    const bitVotes = [];
    const totalBits = Math.min(maxPayloadBits, data.length);
    for (let i = 0; i < totalBits; i += 1) {
        let ones = 0;
        let zeros = 0;
        for (let r = 0; r < repeats; r += 1) {
            const idx = r * totalBits + i;
            if (idx >= data.length)
                break;
            (data[idx] & 1) === 1 ? ones++ : zeros++;
        }
        bitVotes.push(ones >= zeros ? 1 : 0);
    }
    const candidate = voteBits(bitVotes, bitVotes.length);
    return candidate;
}
async function applyVisibleWatermark(buffer, text) {
    const image = (0, sharp_1.default)(buffer);
    const { width = 800, height = 800 } = await image.metadata();
    const svg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <style>
        .wm { fill: rgba(0,0,0,0.45); font-size: ${Math.max(18, Math.floor(width / 40))}px; font-family: Arial, sans-serif; }
      </style>
      <text x="${width - 20}" y="${height - 20}" text-anchor="end" class="wm">${text}</text>
    </svg>
  `;
    const overlay = Buffer.from(svg);
    return image.composite([{ input: overlay, gravity: "southeast" }]).png().toBuffer();
}
