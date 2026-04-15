import { resolve, normalize, isAbsolute } from 'path';

/**
 * Validate that a resolved path stays within one of the allowed roots.
 * Returns the sanitised absolute path, or throws on violation.
 */
export function validateExportPath(
  fullPath: string,
  allowedRoots: string[],
): { valid: true; sanitised: string } | { valid: false; error: string } {
  if (!fullPath) return { valid: false, error: 'Chemin vide' };

  // Reject explicit path traversal tokens in the raw input
  if (fullPath.includes('..')) {
    return { valid: false, error: 'Séquence ".." interdite dans le chemin d\'export' };
  }

  const abs = normalize(resolve(fullPath));

  // Double-check after resolve (belt-and-suspenders)
  for (const root of allowedRoots) {
    const normRoot = normalize(resolve(root));
    if (abs.startsWith(normRoot + '/') || abs === normRoot) {
      return { valid: true, sanitised: abs };
    }
  }

  return {
    valid: false,
    error: `Chemin "${abs}" hors des racines autorisées [${allowedRoots.join(', ')}]`,
  };
}

/**
 * Sanitise a single path segment (directory name or filename).
 * Removes characters that are dangerous on most filesystems.
 */
export function sanitiseSegment(segment: string): string {
  return segment
    .replace(/\.\./g, '_')
    .replace(/[<>:"|?*\x00-\x1f]/g, '_')
    .replace(/\\/g, '_')
    .replace(/^\.+/, '_')
    .trim() || '_';
}

/**
 * Quick validation of the allowed roots list itself.
 */
export function validateAllowedRoots(roots: string[]): string[] {
  const errors: string[] = [];
  for (const r of roots) {
    if (!isAbsolute(r)) {
      errors.push(`Racine "${r}" n'est pas un chemin absolu`);
    }
    if (r.includes('..')) {
      errors.push(`Racine "${r}" contient ".."`);
    }
  }
  return errors;
}
