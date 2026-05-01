import 'reflect-metadata';
import { ValidationPipe, HttpException, HttpStatus } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';

/**
 * Validate that production secrets are not using default/weak values.
 * Must run before bootstrap to prevent the app from starting with insecure config.
 */
function validateProductionSecrets(): void {
  if (process.env.NODE_ENV !== 'production') return;

  const requiredStrong: Record<string, string> = {
    JWT_SECRET: process.env.JWT_SECRET || '',
    POSTGRES_PASSWORD: process.env.POSTGRES_PASSWORD || '',
    S3_SECRET_KEY: process.env.S3_SECRET_KEY || '',
  };

  const forbiddenValues = [
    'change-me-in-prod',
    'lmpdf-secret-key-change-me-in-prod',
    'lmpdf',
    'password',
    'admin',
    'secret',
    'changeme',
    'default',
  ];

  for (const [key, value] of Object.entries(requiredStrong)) {
    if (!value) {
      throw new Error(`[SECURITY] ${key} est requis en production`);
    }
    if (forbiddenValues.some((fv) => value.toLowerCase().includes(fv.toLowerCase()))) {
      throw new Error(`[SECURITY] ${key} utilise une valeur faible/interdite`);
    }
    if (key === 'JWT_SECRET' && value.length < 32) {
      throw new Error(`[SECURITY] JWT_SECRET doit faire au moins 32 caractères en production`);
    }
  }

  // MFA_ENCRYPTION_KEY is required when MFA is not disabled
  const mfaPolicy = process.env.MFA_POLICY || 'optional';
  if (mfaPolicy !== 'disabled' && !process.env.MFA_ENCRYPTION_KEY) {
    throw new Error('[SECURITY] MFA_ENCRYPTION_KEY est requis en production quand MFA est activée (MFA_POLICY != disabled)');
  }
  if (process.env.MFA_ENCRYPTION_KEY && process.env.MFA_ENCRYPTION_KEY.length !== 64) {
    throw new Error('[SECURITY] MFA_ENCRYPTION_KEY doit être exactement 64 caractères hex (32 octets)');
  }
}

async function bootstrap() {
  validateProductionSecrets();
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
