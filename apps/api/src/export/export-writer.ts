// ── Export Writer V1 ─────────────────────────────────────────────
// Writes a PDF buffer to the filesystem following the resolved path
// and conflict strategy. Pure filesystem operations, no PDF generation.

import { promises as fs } from 'fs';
import { dirname, join, basename, extname } from 'path';
import { randomUUID } from 'crypto';
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

  if (conflictStrategy === 'overwrite') {
    await fs.writeFile(fullPath, data);
    return { written: true, finalPath: fullPath };
  }

  const directory = dirname(fullPath), extension = extname(fullPath);
  const stem = basename(fullPath, extension);
  for (let index = 0; index <= 10000; index++) {
    const candidate = index === 0 ? fullPath : join(directory,
      `${stem}_${index === 10000 ? randomUUID() : index}${extension}`);
    try {
      // Exclusive creation prevents concurrent rename/skip requests overwriting each other.
      await fs.writeFile(candidate, data, { flag: 'wx' });
      return { written: true, finalPath: candidate, renamed: index > 0 };
    } catch (error: any) {
      if (error.code !== 'EEXIST') throw error;
      if (conflictStrategy === 'skip') return { written: false, finalPath: fullPath, skipped: true };
    }
  }
  throw new Error('Impossible de trouver un nom libre pour cet export');
}
