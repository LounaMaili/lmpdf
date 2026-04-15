"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("reflect-metadata");
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const helmet_1 = require("helmet");
const app_module_1 = require("./app.module");
async function bootstrap() {
    const app = await core_1.NestFactory.create(app_module_1.AppModule, {
        logger: ['log', 'warn', 'error'],
    });
    app.use((0, helmet_1.default)({
        crossOriginResourcePolicy: { policy: 'cross-origin' },
        contentSecurityPolicy: false,
    }));
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
    app.useGlobalPipes(new common_1.ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api');
    const isProduction = process.env.NODE_ENV === 'production';
    if (isProduction) {
        app.useGlobalFilters({
            catch(exception, host) {
                const ctx = host.switchToHttp();
                const response = ctx.getResponse();
                if (exception instanceof common_1.HttpException) {
                    const status = exception.getStatus();
                    response.status(status).json({
                        statusCode: status,
                        message: status < 500 ? exception.message : 'Erreur interne',
                    });
                }
                else {
                    console.error('Unhandled exception:', exception);
                    response.status(common_1.HttpStatus.INTERNAL_SERVER_ERROR).json({
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
//# sourceMappingURL=main.js.map