import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

/** 统一错误响应结构。 */
interface ErrorBody {
  code: number;
  message: string;
}

/**
 * 全局异常过滤器：把任何异常规整为 `{code, message}`。
 * - HttpException：若其 response 已含 {code,message} 则透传，否则用 HTTP 状态码兜底。
 * - 其它异常：一律 500，不泄露堆栈。
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: ErrorBody = { code: status, message: '服务器开小差了' };

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      body = this.normalize(res, status);
    } else if (exception instanceof Error) {
      this.logger.error(`未捕获异常: ${exception.message}`, exception.stack);
    }

    response.status(status).json(body);
    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(`${request.method} ${request.url} -> ${status}`);
    }
  }

  /** 把 HttpException 的 response 归一为 {code, message}。 */
  private normalize(res: string | object, status: number): ErrorBody {
    if (typeof res === 'string') {
      return { code: status, message: res };
    }
    const obj = res as Record<string, unknown>;
    const code = typeof obj.code === 'number' ? obj.code : status;
    let message = '请求失败';
    if (typeof obj.message === 'string') {
      message = obj.message;
    } else if (Array.isArray(obj.message)) {
      // class-validator 校验错误会是字符串数组，取首条
      message = String(obj.message[0]);
    }
    return { code, message };
  }
}
