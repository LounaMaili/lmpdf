import { join } from 'path';
import type {
  ExportContext,
  ExportDestination,
  ExportResolveResult,
  ExportRule,
  ExportSettings,
} from './export-types';
import { sanitiseSegment, validateExportPath } from './export-security';

// ── Placeholder resolution ──────────────────────────────────────

function resolvePlaceholders(template: string, ctx: ExportContext): string {
  const now = new Date();
  const map: Record<string, string> = {
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
    return sanitiseSegment(raw);
  });
}

// ── Rule matching ───────────────────────────────────────────────

function ruleMatches(rule: ExportRule, ctx: ExportContext): boolean {
  if (!rule.enabled) return false;

  // A rule with zero conditions is a fallback and matches everything.
  let hasCondition = false;

  if (rule.templateId) {
    hasCondition = true;
    if (ctx.templateId !== rule.templateId) return false;
  }

  if (rule.templateNameContains) {
    hasCondition = true;
    const haystack = (ctx.templateName || '').toLowerCase();
    if (!haystack.includes(rule.templateNameContains.toLowerCase())) return false;
  }

  if (rule.authSource) {
    hasCondition = true;
    if (ctx.authSource !== rule.authSource) return false;
  }

  if (rule.role) {
    hasCondition = true;
    if (ctx.role !== rule.role) return false;
  }

  if (rule.groupName) {
    hasCondition = true;
    if (!ctx.groups || !ctx.groups.includes(rule.groupName)) return false;
  }

  // If we reach here, all specified conditions matched (or there were none → fallback).
  return true;
}

// ── Main resolver ───────────────────────────────────────────────

export function resolveExport(
  settings: ExportSettings,
  ctx: ExportContext,
): ExportResolveResult {
  const errors: string[] = [];

  if (!settings.enabled) {
    return { matched: false, errors: ['Export désactivé'] };
  }

  // Find the first matching rule
  const matchedRule = settings.rules.find((r) => ruleMatches(r, ctx));
  if (!matchedRule) {
    return { matched: false, errors: ['Aucune règle d\'export ne correspond au contexte'] };
  }

  // Find the destination referenced by the rule
  const dest: ExportDestination | undefined = settings.destinations.find(
    (d) => d.name === matchedRule.destinationName && d.enabled,
  );
  if (!dest) {
    return {
      matched: true,
      ruleLabelMatched: matchedRule.label,
      errors: [`Destination "${matchedRule.destinationName}" introuvable ou désactivée`],
    };
  }

  // Validate rootPath is in allowed roots
  if (!settings.allowedRoots.includes(dest.rootPath)) {
    errors.push(`Racine "${dest.rootPath}" non autorisée`);
    return {
      matched: true,
      ruleLabelMatched: matchedRule.label,
      destinationName: dest.name,
      errors,
    };
  }

  // Resolve placeholders
  const resolvedPath = resolvePlaceholders(dest.pathTemplate, ctx);
  const resolvedFileName = resolvePlaceholders(dest.fileNameTemplate, ctx) + '.pdf';

  const fullPath = join(dest.rootPath, resolvedPath, resolvedFileName);

  // Security validation
  const validation = validateExportPath(fullPath, settings.allowedRoots);
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
