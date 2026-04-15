"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_ROLE_PERMISSIONS = void 0;
exports.resolveRolePermissions = resolveRolePermissions;
exports.canUser = canUser;
const runtime_settings_1 = require("./runtime-settings");
exports.DEFAULT_ROLE_PERMISSIONS = {
    admin: {
        uploadDocument: true,
        createTemplate: true,
        manageTemplate: true,
        editStructure: true,
        createPage: true,
        exportPdf: true,
        printDocument: true,
    },
    editor: {
        uploadDocument: true,
        createTemplate: true,
        manageTemplate: true,
        editStructure: true,
        createPage: true,
        exportPdf: true,
        printDocument: true,
    },
    viewer: {
        uploadDocument: false,
        createTemplate: false,
        manageTemplate: false,
        editStructure: false,
        createPage: false,
        exportPdf: false,
        printDocument: false,
    },
};
async function resolveRolePermissions(role) {
    const key = (role || 'viewer').toLowerCase();
    const settings = await (0, runtime_settings_1.loadRuntimeSettings)();
    const base = exports.DEFAULT_ROLE_PERMISSIONS[key] ?? exports.DEFAULT_ROLE_PERMISSIONS.viewer;
    const override = settings.permissions?.[key] ?? {};
    return { ...base, ...override };
}
async function canUser(role, action) {
    const perms = await resolveRolePermissions(role);
    return Boolean(perms[action]);
}
//# sourceMappingURL=permission-matrix.js.map