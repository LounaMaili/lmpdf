import 'reflect-metadata';
import { ValidationPipe, HttpException, HttpStatus } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  // Security headers — disable CSP in dev (frontend is on a different port)
  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:"],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
      },
    }, // handled by reverse proxy in prod
  }));

  // CORS — strict in production, optional strict mode in development
  const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:4173,http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const strictCors = process.env.STRICT_CORS === 'true';

  app.enableCors({
    origin: (origin, callback) => {
      if (process.env.NODE_ENV !== 'production' && !strictCors) {
        return callback(null, true);
      }
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error('Not allowed by CORS'));
    },
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
  });

  // Validation
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // Global prefix
  app.setGlobalPrefix('api');

  // Global exception filter: hide internal details in production
  const isProduction = process.env.NODE_ENV === 'production';
  if (isProduction) {
    app.useGlobalFilters({
      catch(exception: unknown, host: import('@nestjs/common').ArgumentsHost) {
        const ctx = host.switchToHttp();
        const response = ctx.getResponse();
        if (exception instanceof HttpException) {
          const status = exception.getStatus();
          response.status(status).json({
            statusCode: status,
            message: status < 500 ? exception.message : 'Erreur interne',
          });
        } else {
          console.error('Unhandled exception:', exception);
          response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
            statusCode: 500,
            message: 'Erreur interne',
          });
        }
      },
    });
  }

  await app.listen(3000);
  console.log(`LMPdf API listening on port 3000 (CORS: ${allowedOrigins.join(', ')})`);
}

bootstrap();
