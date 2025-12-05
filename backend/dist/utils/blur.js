"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.blurFacesPlaceholder = blurFacesPlaceholder;
const sharp_1 = __importDefault(require("sharp"));
async function blurFacesPlaceholder(buffer) {
    // Placeholder: applies a global blur to reduce identifiability instead of detecting faces.
    return (0, sharp_1.default)(buffer).blur(18).toBuffer();
}
