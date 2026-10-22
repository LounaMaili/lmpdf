import { BadRequestException, CallHandler, ExecutionContext, HttpException, Injectable, NestInterceptor } from '@nestjs/common';
import { defer, finalize, fromEvent, mergeMap, Observable, race, throwError } from 'rxjs';

export const MAX_EXPORT_BYTES = 25 * 1024 * 1024;
export const MAX_CONCURRENT_EXPORTS = 2;

/** Reserve capacity before Multer buffers bytes; hold it until completion/error. */
@Injectable()
export class ExportCapacityInterceptor implements NestInterceptor {
  private active = 0;

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const interrupted = () => new BadRequestException('Requête d’export interrompue');
    if (request.aborted || request.destroyed) throw interrupted();
    if (this.active >= MAX_CONCURRENT_EXPORTS) {
      throw new HttpException('Trop d’exports simultanés, réessayez après la fin d’un export', 429);
    }
    this.active++;
    return defer(() => {
      if (request.aborted || request.destroyed) throw interrupted();
      return race(next.handle(), fromEvent(request, 'aborted').pipe(mergeMap(() => throwError(interrupted))));
    }).pipe(finalize(() => { this.active--; }));
  }
}
