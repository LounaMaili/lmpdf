import { BadRequestException } from '@nestjs/common';
import { promises as fs, constants, type BigIntStats } from 'fs';
import type { FileHandle } from 'fs/promises';
import { dirname, join, basename, extname, relative, sep } from 'path';
import { randomUUID } from 'crypto';
import type { ConflictStrategy } from './export-types';
import { exportRootForPath, validateExportPath } from './export-security';

export interface WriteResult {
  written: boolean;
  finalPath: string;
  skipped?: boolean;
  renamed?: boolean;
}

const directoryFlags = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
const fdPath = (directory: FileHandle, leaf = '') => `/proc/self/fd/${directory.fd}${leaf ? `/${leaf}` : ''}`;
const unsafe = () => new BadRequestException('Chemin d’export non sûr');
const sameFile = (a: BigIntStats, b: BigIntStats) => a.ino === b.ino && a.dev === b.dev;

/** Linux descriptor-relative traversal: no user-controlled symlink is followed. */
export async function writeExportFile(fullPath: string, data: Buffer, conflictStrategy: ConflictStrategy,
  allowedRoots: string[]): Promise<WriteResult> {
  if (process.platform !== 'linux' || !Array.isArray(allowedRoots)) throw unsafe();
  const validation = validateExportPath(fullPath, allowedRoots);
  if (!validation.valid) throw unsafe();
  fullPath = validation.sanitised;
  const root = exportRootForPath(fullPath, allowedRoots)!;
  if (!['overwrite', 'rename', 'skip'].includes(conflictStrategy)) throw unsafe();
  const handles: FileHandle[] = [];
  async function openDirectory(parent: FileHandle, leaf: string): Promise<FileHandle> {
    const name = fdPath(parent, leaf);
    let handle: FileHandle;
    try { handle = await fs.open(name, directoryFlags); }
    catch (error: any) {
      if (error.code !== 'ENOENT') throw error;
      try { await fs.mkdir(name); } catch (mkdirError: any) { if (mkdirError.code !== 'EEXIST') throw mkdirError; }
      handle = await fs.open(name, directoryFlags);
    }
    handles.push(handle); return handle;
  }
  try {
    let parent = await fs.open('/', directoryFlags); handles.push(parent);
    for (const leaf of relative('/', root).split(sep).filter(Boolean)) parent = await openDirectory(parent, leaf);
    const rootHandle = parent;
    const directory = dirname(fullPath);
    for (const leaf of relative(root, directory).split(sep).filter(Boolean)) parent = await openDirectory(parent, leaf);
    async function checkDirectory() {
      if (await fs.realpath(fdPath(rootHandle)) !== root || await fs.realpath(fdPath(parent)) !== directory) throw unsafe();
    }
    const extension = extname(fullPath), stem = basename(fullPath, extension);
    for (let index = 0; index <= 10000; index++) {
      await checkDirectory();
      const leaf = index === 0 ? basename(fullPath) : `${stem}_${index === 10000 ? randomUUID() : index}${extension}`;
      const logical = join(directory, leaf), name = fdPath(parent, leaf);
      if (!validateExportPath(logical, allowedRoots).valid) throw unsafe();
      let file: FileHandle, created = false;
      try {
        file = await fs.open(name, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o666);
        created = true;
      } catch (error: any) {
        if (error.code !== 'EEXIST') throw error;
        const existing = await fs.lstat(name, { bigint: true });
        if (!existing.isFile() || existing.nlink !== 1n) throw unsafe();
        if (conflictStrategy === 'skip') { await checkDirectory(); return { written: false, finalPath: logical, skipped: true }; }
        if (conflictStrategy === 'rename') continue;
        // Never truncate before checking the pinned inode (including hardlinks).
        file = await fs.open(name, constants.O_WRONLY | constants.O_NOFOLLOW);
      }
      let own: BigIntStats | undefined;
      try {
        own = await file.stat({ bigint: true });
        async function checkTarget() {
          await checkDirectory();
          if (!validateExportPath(logical, allowedRoots).valid) throw unsafe();
          const named = await fs.lstat(name, { bigint: true });
          if (!named.isFile() || named.nlink !== 1n || !sameFile(named, own!)) throw unsafe();
        }
        if (!own.isFile() || own.nlink !== 1n) throw unsafe();
        await checkTarget();
        if (!created) await file.truncate(0);
        await file.writeFile(data);
        await checkTarget();
        return { written: true, finalPath: logical, renamed: index > 0 };
      } catch (error) {
        // Remove only our newly created inode, through the pinned parent directory.
        if (created) {
          const ours = own ?? await file.stat({ bigint: true }).catch(() => null);
          const named = await fs.lstat(name, { bigint: true }).catch(() => null);
          if (ours && named && sameFile(ours, named)) await fs.unlink(name);
        }
        throw error;
      } finally { await file.close(); }
    }
    throw new Error('Aucun nom libre pour cet export');
  } catch (error: any) {
    if (error instanceof BadRequestException) throw error;
    if (['ELOOP', 'ENOTDIR', 'ENOENT'].includes(error.code)) throw unsafe();
    throw new Error('Échec de l’écriture sécurisée de l’export');
  } finally { for (const handle of handles.reverse()) await handle.close().catch(() => {}); }
}
