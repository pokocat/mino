import { Controller, Get } from '@nestjs/common';

/** 健康检查：供 CI / 负载均衡 / 容器探针使用。 */
@Controller('health')
export class HealthController {
  @Get()
  check(): { status: string } {
    return { status: 'ok' };
  }
}
