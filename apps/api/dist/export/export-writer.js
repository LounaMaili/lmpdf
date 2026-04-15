"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeExportFile = writeExportFile;
const fs_1 = require("fs");
const path_1 = require("path");
async function fileExists(p) {
    try {
        await fs_1.promises.access(p);
        return true;
    }
    catch {
        return false;
    }
}
async function findRenamedPath(fullPath) {
    const dir = (0, path_1.dirname)(fullPath);
    const ext = (0, path_1.extname)(fullPath);
    const base = (0, path_1.basename)(fullPath, ext);
    for (let i = 1; i < 10000; i++) {
        const candidate = (0, path_1.join)(dir, `${base}_${i}${ext}`);
        if (!(await fileExists(candidate)))
            return candidate;
    }
    const ts = Date.now();
    return (0, path_1.join)(dir, `${base}_${ts}${ext}`);
}
async function writeExportFile(fullPath, data, conflictStrategy) {
    await fs_1.promises.mkdir((0, path_1.dirname)(fullPath), { recursive: true });
    const exists = await fileExists(fullPath);
    if (exists) {
        switch (conflictStrategy) {
            case 'skip':
                return { written: false, finalPath: fullPath, skipped: true };
            case 'overwrite':
                await fs_1.promises.writeFile(fullPath, data);
                return { written: true, finalPath: fullPath };
            case 'rename': {
                const renamed = await findRenamedPath(fullPath);
                await fs_1.promises.writeFile(renamed, data);
                return { written: true, finalPath: renamed, renamed: true };
            }
            default:
                await fs_1.promises.writeFile(fullPath, data);
                return { written: true, finalPath: fullPath };
        }
    }
    await fs_1.promises.writeFile(fullPath, data);
    return { written: true, finalPath: fullPath };
}
//# sourceMappingURL=export-writer.js.map