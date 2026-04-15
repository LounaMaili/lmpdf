// ── Export Writer V1 ─────────────────────────────────────────────
// Writes a PDF buffer to the filesystem following the resolved path
// and conflict strategy. Pure filesystem operations, no PDF generation.

import { promises as fs } from 'fs';
import { dirname, join, basename, extname } from 'path';
import type { ConflictStrategy } from './export-types';

export interface WriteResult {
  /** Whether bytes were actually written to disk */
  written: boolean;
  /** Final absolute path (may differ from requested if renamed) */
  finalPath: string;
  /** True when conflict strategy was 'skip' and file already existed */
  skipped?: boolean;
  /** True when conflict strategy was 'rename' and a suffix was added */
  renamed?: boolean;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Find the next available path by appending _1, _2, … before the extension.
 * e.g. report.pdf → report_1.pdf → report_2.pdf
 */
async function findRenamedPath(fullPath: string): Promise<string> {
  const dir = dirname(fullPath);
  const ext = extname(fullPath);
  const base = basename(fullPath, ext);

  for (let i = 1; i < 10000; i++) {
    const candidate = join(dir, `${base}_${i}${ext}`);
    if (!(await fileExists(candidate))) return candidate;
  }

  // Fallback: timestamp suffix
  const ts = Date.now();
  return join(dir, `${base}_${ts}${ext}`);
}

/**
 * Write a PDF buffer to the resolved filesystem path with conflict handling.
 *
 * @param fullPath - Absolute resolved & validated path
 * @param data - PDF bytes
 * @param conflictStrategy - How to handle existing files
 */
export async function writeExportFile(
  fullPath: string,
  data: Buffer,
  conflictStrategy: ConflictStrategy,
): Promise<WriteResult> {
  // Ensure parent directories exist
  await fs.mkdir(dirname(fullPath), { recursive: true });

  const exists = await fileExists(fullPath);

  if (exists) {
    switch (conflictStrategy) {
      case 'skip':
        return { written: false, finalPath: fullPath, skipped: true };

      case 'overwrite':
        await fs.writeFile(fullPath, data);
        return { written: true, finalPath: fullPath };

      case 'rename': {
        const renamed = await findRenamedPath(fullPath);
        await fs.writeFile(renamed, data);
        return { written: true, finalPath: renamed, renamed: true };
      }

      default:
        // Fallback to overwrite for unknown strategies
        await fs.writeFile(fullPath, data);
        return { written: true, finalPath: fullPath };
    }
  }

  // No conflict: write directly
  await fs.writeFile(fullPath, data);
  return { written: true, finalPath: fullPath };
}
