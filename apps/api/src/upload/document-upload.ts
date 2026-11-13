import { BadRequestException, InternalServerErrorException, Logger, PayloadTooLargeException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { createWriteStream, promises as fs, type WriteStream } from 'fs';
import type { IncomingMessage, ServerResponse } from 'http';
import { join } from 'path';
import { pipeline, type Readable } from 'stream';
import * as multer from 'multer';

export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

/** Own only this request's files until PostgreSQL acknowledges their metadata. */
export class DocumentUpload {
  private readonly id = randomUUID();
  private readonly temporary = join('uploads', `${this.id}.bin`);
  private readonly owned = new Set<string>();
  private readonly logger = new Logger(DocumentUpload.name);
  private input?: Readable;
  private output?: WriteStream;
  private writing: Promise<void> = Promise.resolve();
  private rejectReceive?: (error: Error) => void;
  private interrupted = false;
  private committed = false;

  private readonly onAbort = () => {
    this.interrupted = true;
    this.input?.destroy();
    this.output?.destroy();
    this.rejectReceive?.(new BadRequestException('Import interrompu'));
  };
  private readonly onClose = () => {
    // IncomingMessage.close also fires on a normally received body. The response
    // distinguishes a lost client from that ordinary end-of-request event.
    if (!this.response.writableFinished) this.onAbort();
  };

  constructor(private readonly request: IncomingMessage, private readonly response: ServerResponse) {
    request.once('aborted', this.onAbort);
    response.once('close', this.onClose);
  }

  assertConnected(): void {
    if (this.interrupted || this.request.aborted || this.response.destroyed) {
      throw new BadRequestException('Import interrompu');
    }
  }

  async receive(): Promise<Express.Multer.File | undefined> {
    this.assertConnected();
    await fs.mkdir('uploads', { recursive: true });
    this.assertConnected();
    const storage: multer.StorageEngine = {
      _handleFile: (_request, file, callback) => {
        this.input = file.stream;
        this.writing = new Promise(resolve => {
          try {
            const output = this.output = createWriteStream(this.temporary, { flags: 'wx', mode: 0o600 });
            output.once('open', () => this.owned.add(this.temporary));
            pipeline(file.stream, output, error => {
              // Multer can synchronously ask _removeFile to clean up in callback.
              resolve();
              callback(error, error ? undefined : {
                destination: 'uploads', filename: `${this.id}.bin`, path: this.temporary, size: output.bytesWritten,
              });
            });
          } catch (error) { resolve(); callback(error); }
        });
      },
      _removeFile: (_request, _file, callback) => {
        this.removeUncommitted().then(() => callback(null), callback);
      },
    };
    const receive = multer({ storage, limits: {
      // Multer signals the limit at equality; enforce the public inclusive cap below.
      fileSize: MAX_DOCUMENT_BYTES + 1, files: 1, fields: 8, parts: 9, fieldSize: 1024, fieldNameSize: 100,
    } }).single('file');
    await new Promise<void>((resolve, reject) => {
      let finished = false;
      const done = (error?: unknown) => {
        if (finished) return;
        finished = true;
        this.rejectReceive = undefined;
        if (error) reject(this.multipartError(error));
        else resolve();
      };
      this.rejectReceive = done;
      // Express request/response extend the Node types used for lifecycle events.
      try { receive(this.request as any, this.response as any, done); }
      catch (error) { done(error); }
    });
    this.assertConnected();
    const file = (this.request as IncomingMessage & { file?: Express.Multer.File }).file;
    if (file && file.size > MAX_DOCUMENT_BYTES) throw new PayloadTooLargeException('Fichier trop volumineux (25 Mio maximum)');
    return file;
  }

  async header(): Promise<Buffer> {
    const file = await fs.open(this.temporary, 'r');
    try {
      const prefix = Buffer.alloc(12);
      const { bytesRead } = await file.read(prefix, 0, prefix.length, 0);
      return prefix.subarray(0, bytesRead);
    } finally { await file.close(); }
  }

  async promote(extension: string): Promise<string> {
    this.assertConnected();
    const name = `${this.id}${extension}`, target = join('uploads', name);
    // Same filesystem; exclusive link avoids overwriting even on a UUID collision.
    await fs.link(this.temporary, target);
    this.owned.add(target);
    await fs.unlink(this.temporary);
    this.owned.delete(this.temporary);
    return name;
  }

  markCommitted(): void { this.committed = true; }

  async dispose(): Promise<void> {
    try {
      if (!this.committed) { this.input?.destroy(); this.output?.destroy(); }
      await this.removeUncommitted();
    } finally {
      this.request.removeListener('aborted', this.onAbort);
      this.response.removeListener('close', this.onClose);
    }
  }

  private async removeUncommitted(): Promise<void> {
    // Do not unlink until the pending exclusive open/write has actually closed.
    await this.writing;
    if (this.committed) return;
    let failed = false;
    for (const name of this.owned) {
      try { await fs.unlink(name); this.owned.delete(name); }
      catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') this.owned.delete(name);
        else {
          failed = true;
          this.logger.error(`Nettoyage de l’import ${this.id} impossible (${code ?? 'I/O'})`);
        }
      }
    }
    if (failed) throw new InternalServerErrorException('Échec du nettoyage de l’import');
  }

  private multipartError(error: unknown): unknown {
    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') return new PayloadTooLargeException('Fichier trop volumineux (25 Mio maximum)');
      return new BadRequestException('Requête multipart invalide');
    }
    if (error instanceof Error && /^(Multipart:|Unexpected end of (form|file))/.test(error.message)) {
      return new BadRequestException('Requête multipart invalide');
    }
    return error;
  }
}
