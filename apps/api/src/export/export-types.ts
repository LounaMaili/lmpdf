// ── Export V1 types ──────────────────────────────────────────────
// Kept intentionally simple: filesystem destinations only,
// server-side mounted paths, no user credentials stored.

export type ConflictStrategy = 'overwrite' | 'rename' | 'skip';

/**
 * A filesystem destination where PDFs can be exported.
 * rootPath must be listed in the global allowedRoots whitelist.
 */
export interface ExportDestination {
  /** Human-readable identifier, unique per config */
  name: string;
  /** Whether this destination is active */
  enabled: boolean;
  /** Key into the allowedRoots array (must match exactly) */
  rootPath: string;
  /**
   * Sub-path template under rootPath.
   * Placeholders: {username}, {displayName}, {email}, {templateName},
   *               {date}, {year}, {month}, {day}
   */
  pathTemplate: string;
  /**
   * File name template (without extension).
   * Same placeholders as pathTemplate. Extension is always .pdf
   */
  fileNameTemplate: string;
  /** What to do when the target file already exists */
  conflictStrategy: ConflictStrategy;
}

/**
 * A simple rule that decides which destination to use based on context.
 * Rules are evaluated top→bottom, first match wins.
 * A rule with no conditions is a fallback (matches everything).
 */
export interface ExportRule {
  /** Human-readable label */
  label: string;
  /** Whether this rule is active */
  enabled: boolean;
  /** Name of the ExportDestination to use when matched */
  destinationName: string;

  // ── Conditions (all optional — empty = fallback) ──
  /** Match templates whose name contains this string (case-insensitive) */
  templateNameContains?: string;
  /** Match a specific template by ID */
  templateId?: string;
  /** Match users from a specific auth source */
  authSource?: 'local' | 'ldap';
  /** Match users with a specific global role */
  role?: 'admin' | 'editor' | 'viewer';
  /** Match users who belong to a specific internal group name */
  groupName?: string;
}

/**
 * Top-level export configuration block, stored in admin-settings.json
 */
export interface ExportSettings {
  /** Master switch */
  enabled: boolean;
  /**
   * Absolute server-side paths that are allowed as destination roots.
   * Every destination's rootPath must be in this list.
   */
  allowedRoots: string[];
  /** Configured destinations */
  destinations: ExportDestination[];
  /** Ordered rules (first match wins) */
  rules: ExportRule[];
}

/**
 * Context provided when resolving which export rule/destination applies.
 */
export interface ExportContext {
  username: string;
  displayName?: string;
  email?: string;
  templateName?: string;
  templateId?: string;
  authSource?: 'local' | 'ldap';
  role?: string;
  groups?: string[];
}

/**
 * Result of resolving an export destination for a given context.
 */
export interface ExportResolveResult {
  matched: boolean;
  ruleLabelMatched?: string;
  destinationName?: string;
  resolvedPath?: string;
  resolvedFileName?: string;
  fullPath?: string;
  conflictStrategy?: ConflictStrategy;
  errors: string[];
}

export function defaultExportSettings(): ExportSettings {
  return {
    enabled: false,
    allowedRoots: [],
    destinations: [],
    rules: [],
  };
}
