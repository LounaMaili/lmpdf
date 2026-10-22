import { resolve, isAbsolute, relative, sep, parse, join } from 'path';
import { lstatSync } from 'fs';

export function exportRootForPath(fullPath: string, allowedRoots: string[]): string | null {
  if (!fullPath || !isAbsolute(fullPath) || fullPath.includes('..') || fullPath.includes('\0')) return null;
  const absolute = resolve(fullPath);
  for (const root of [...allowedRoots].sort((a, b) => b.length - a.length)) {
    if (!isAbsolute(root) || root.includes('..') || root.includes('\0')) continue;
    const normalized = resolve(root), child = relative(normalized, absolute);
    if (child && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child)) return normalized;
  }
  return null;
}

/**
 * Validate that a resolved path stays within one of the allowed roots.
 * Returns the sanitised absolute path, or throws on violation.
 */
export function validateExportPath(
  fullPath: string,
  allowedRoots: string[],
): { valid: true; sanitised: string } | { valid: false; error: string } {
  const invalid = { valid: false as const, error: 'Chemin d’export hors racine, symbolique ou non sûr' };
  if (!exportRootForPath(fullPath, allowedRoots)) return invalid;
  const absolute = resolve(fullPath), parts = relative(parse(absolute).root, absolute).split(sep);
  let current = parse(absolute).root;
  for (let index = 0; index < parts.length; index++) {
    current = join(current, parts[index]);
    try {
      const info = lstatSync(current);
      if (info.isSymbolicLink()) return invalid;
      if (index < parts.length - 1 ? !info.isDirectory() : !info.isFile() || info.nlink !== 1) return invalid;
    } catch (error: any) {
      if (error.code === 'ENOENT') break; // New directories/files are created safely by the writer.
      return invalid;
    }
  }
  return { valid: true, sanitised: absolute };
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
