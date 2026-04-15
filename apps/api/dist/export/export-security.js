"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateExportPath = validateExportPath;
exports.sanitiseSegment = sanitiseSegment;
exports.validateAllowedRoots = validateAllowedRoots;
const path_1 = require("path");
function validateExportPath(fullPath, allowedRoots) {
    if (!fullPath)
        return { valid: false, error: 'Chemin vide' };
    if (fullPath.includes('..')) {
        return { valid: false, error: 'Séquence ".." interdite dans le chemin d\'export' };
    }
    const abs = (0, path_1.normalize)((0, path_1.resolve)(fullPath));
    for (const root of allowedRoots) {
        const normRoot = (0, path_1.normalize)((0, path_1.resolve)(root));
        if (abs.startsWith(normRoot + '/') || abs === normRoot) {
            return { valid: true, sanitised: abs };
        }
    }
    return {
        valid: false,
        error: `Chemin "${abs}" hors des racines autorisées [${allowedRoots.join(', ')}]`,
    };
}
function sanitiseSegment(segment) {
    return segment
        .replace(/\.\./g, '_')
        .replace(/[<>:"|?*\x00-\x1f]/g, '_')
        .replace(/\\/g, '_')
        .replace(/^\.+/, '_')
        .trim() || '_';
}
function validateAllowedRoots(roots) {
    const errors = [];
    for (const r of roots) {
        if (!(0, path_1.isAbsolute)(r)) {
            errors.push(`Racine "${r}" n'est pas un chemin absolu`);
        }
        if (r.includes('..')) {
            errors.push(`Racine "${r}" contient ".."`);
        }
    }
    return errors;
}
//# sourceMappingURL=export-security.js.map