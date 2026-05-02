import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ThrottlerException } from '@nestjs/throttler';
import { Prisma } from '@prisma/client';

const getHttpExceptionMessage = (
  body: string | object,
  fallback: string,
): string => {
  if (typeof body === 'string') return body;
  const message = (body as { message?: unknown }).message;
  if (Array.isArray(message)) return message.join(', ');
  return typeof message === 'string' ? message : fallback;
};

const getPrismaMessage = (
  exception: Prisma.PrismaClientKnownRequestError,
): { status: number; message: string } => {
  switch (exception.code) {
    case 'P2002': {
      const fields =
        (exception.meta?.target as string[])?.join(', ') ?? 'field';
      return {
        status: HttpStatus.CONFLICT,
        message: `A record with that ${fields} already exists.`,
      };
    }
    case 'P2025':
      return {
        status: HttpStatus.NOT_FOUND,
        message: 'The requested record was not found.',
      };
    case 'P2003':
      return {
        status: HttpStatus.CONFLICT,
        message:
          'Cannot complete this action — related records are linked to this item.',
      };
    case 'P2000':
      return {
        status: HttpStatus.BAD_REQUEST,
        message: 'One of the provided values is too long.',
      };
    case 'P2014':
      return {
        status: HttpStatus.CONFLICT,
        message:
          'This change would violate a required relationship between records.',
      };
    default:
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'A database error occurred. Please try again.',
      };
  }
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Something went wrong. Please try again.';

    if (exception instanceof ThrottlerException) {
      status = HttpStatus.TOO_MANY_REQUESTS;
      message = 'Too many requests — please slow down and try again shortly.';
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      message = getHttpExceptionMessage(exception.getResponse(), message);
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      const result = getPrismaMessage(exception);
      status = result.status;
      message = result.message;
    } else if (exception instanceof Prisma.PrismaClientValidationError) {
      status = HttpStatus.BAD_REQUEST;
      message = 'Invalid data provided. Please check your input and try again.';
    } else if (exception instanceof Prisma.PrismaClientInitializationError) {
      status = HttpStatus.SERVICE_UNAVAILABLE;
      message =
        'The database is currently unavailable. Please try again later.';
    }

    if (status >= 500) {
      this.logger.error(
        `${req.method} ${req.url} → ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else if (status >= 400) {
      this.logger.warn(`${req.method} ${req.url} → ${status}: ${message}`);
    }

    res.status(status).json({
      statusCode: status,
      message,
      timestamp: new Date().toISOString(),
      path: req.url,
    });
  }
}
