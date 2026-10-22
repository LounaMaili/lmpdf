import { CallHandler, ExecutionContext, HttpException, Injectable, NestInterceptor } from '@nestjs/common';
import { defer, finalize, Observable } from 'rxjs';

export const MAX_EXPORT_BYTES = 25 * 1024 * 1024;
export const MAX_CONCURRENT_EXPORTS = 2;

/** Reserve capacity before Multer buffers bytes; hold it until completion/error. */
@Injectable()
export class ExportCapacityInterceptor implements NestInterceptor {
  private active = 0;

  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (this.active >= MAX_CONCURRENT_EXPORTS) {
      throw new HttpException('Trop d’exports simultanés, réessayez après la fin d’un export', 429);
    }
    this.active++;
    return defer(() => next.handle()).pipe(finalize(() => { this.active--; }));
  }
}
