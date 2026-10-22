import { promises as fs } from 'fs';
import { dirname, join } from 'path';
import { randomUUID } from 'crypto';

export function adminSettingsPath(): string {
  return join(process.cwd(), 'config', 'admin-settings.json');
}

/** Only a missing file means a new installation; unreadable/corrupt files stay intact. */
export async function readAdminSettingsFile(filePath = adminSettingsPath()): Promise<Record<string, unknown> | null> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error('Impossible de lire la configuration administrateur');
  }
  try {
    const json: unknown = JSON.parse(raw);
    if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error();
    return json as Record<string, unknown>;
  } catch {
    // JSON.parse errors can contain the input, including credentials. Do not forward them.
    throw new Error('Configuration administrateur JSON invalide ; fichier conservé');
  }
}

/** Atomic replacement on the same filesystem, with private file permissions. */
export async function writeAdminSettingsFile(settings: object, filePath = adminSettingsPath()): Promise<void> {
  const directory = dirname(filePath);
  const temporary = join(directory, `.admin-settings-${randomUUID()}.tmp`);
  try {
    const serialized = JSON.stringify(settings, null, 2);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const file = await fs.open(temporary, 'wx', 0o600);
    try {
      await file.writeFile(serialized, 'utf8');
      await file.sync();
    } finally {
      await file.close();
    }
    await fs.rename(temporary, filePath);
    const dir = await fs.open(directory, 'r');
    try { await dir.sync(); } finally { await dir.close(); }
  } catch {
    throw new Error('Impossible d’enregistrer la configuration administrateur');
  } finally {
    await fs.unlink(temporary).catch(() => {});
  }
}
