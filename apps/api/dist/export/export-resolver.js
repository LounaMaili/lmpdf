"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveExport = resolveExport;
const path_1 = require("path");
const export_security_1 = require("./export-security");
function resolvePlaceholders(template, ctx) {
    const now = new Date();
    const map = {
        username: ctx.username || 'unknown',
        displayName: ctx.displayName || ctx.username || 'unknown',
        email: ctx.email || '',
        templateName: ctx.templateName || 'document',
        templateId: ctx.templateId || '',
        date: now.toISOString().slice(0, 10),
        year: String(now.getFullYear()),
        month: String(now.getMonth() + 1).padStart(2, '0'),
        day: String(now.getDate()).padStart(2, '0'),
    };
    return template.replace(/\{(\w+)\}/g, (_match, key) => {
        const raw = map[key] ?? '';
        return (0, export_security_1.sanitiseSegment)(raw);
    });
}
function ruleMatches(rule, ctx) {
    if (!rule.enabled)
        return false;
    let hasCondition = false;
    if (rule.templateId) {
        hasCondition = true;
        if (ctx.templateId !== rule.templateId)
            return false;
    }
    if (rule.templateNameContains) {
        hasCondition = true;
        const haystack = (ctx.templateName || '').toLowerCase();
        if (!haystack.includes(rule.templateNameContains.toLowerCase()))
            return false;
    }
    if (rule.authSource) {
        hasCondition = true;
        if (ctx.authSource !== rule.authSource)
            return false;
    }
    if (rule.role) {
        hasCondition = true;
        if (ctx.role !== rule.role)
            return false;
    }
    if (rule.groupName) {
        hasCondition = true;
        if (!ctx.groups || !ctx.groups.includes(rule.groupName))
            return false;
    }
    return true;
}
function resolveExport(settings, ctx) {
    const errors = [];
    if (!settings.enabled) {
        return { matched: false, errors: ['Export désactivé'] };
    }
    const matchedRule = settings.rules.find((r) => ruleMatches(r, ctx));
    if (!matchedRule) {
        return { matched: false, errors: ['Aucune règle d\'export ne correspond au contexte'] };
    }
    const dest = settings.destinations.find((d) => d.name === matchedRule.destinationName && d.enabled);
    if (!dest) {
        return {
            matched: true,
            ruleLabelMatched: matchedRule.label,
            errors: [`Destination "${matchedRule.destinationName}" introuvable ou désactivée`],
        };
    }
    if (!settings.allowedRoots.includes(dest.rootPath)) {
        errors.push(`Racine "${dest.rootPath}" non autorisée`);
        return {
            matched: true,
            ruleLabelMatched: matchedRule.label,
            destinationName: dest.name,
            errors,
        };
    }
    const resolvedPath = resolvePlaceholders(dest.pathTemplate, ctx);
    const resolvedFileName = resolvePlaceholders(dest.fileNameTemplate, ctx) + '.pdf';
    const fullPath = (0, path_1.join)(dest.rootPath, resolvedPath, resolvedFileName);
    const validation = (0, export_security_1.validateExportPath)(fullPath, settings.allowedRoots);
    if (!validation.valid) {
        errors.push(validation.error);
        return {
            matched: true,
            ruleLabelMatched: matchedRule.label,
            destinationName: dest.name,
            resolvedPath,
            resolvedFileName,
            fullPath,
            errors,
        };
    }
    return {
        matched: true,
        ruleLabelMatched: matchedRule.label,
        destinationName: dest.name,
        resolvedPath,
        resolvedFileName,
        fullPath: validation.sanitised,
        conflictStrategy: dest.conflictStrategy,
        errors: [],
    };
}
//# sourceMappingURL=export-resolver.js.map