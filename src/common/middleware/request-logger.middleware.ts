import { Request, Response, NextFunction } from 'express';
import { Logger } from '@nestjs/common';

const logger = new Logger('HTTP');

export function RequestLoggerMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const { method, originalUrl } = req;
  const start = Date.now();

  res.on('finish', () => {
    const { statusCode } = res;
    const ms = Date.now() - start;
    const level =
      statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'log';
    logger[level](`${method} ${originalUrl} ${statusCode} +${ms}ms`);
  });

  next();
}
