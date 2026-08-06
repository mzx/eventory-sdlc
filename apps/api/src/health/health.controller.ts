import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { Public } from '../auth/decorators';
import { DbService } from '../db/db.service';

interface HealthResponse {
  status: 'ok';
  db: true;
}

@Controller('health')
export class HealthController {
  constructor(private readonly db: DbService) {}

  /** @Public() (EVT-14) — container healthchecks/load balancers hit this unauthenticated. */
  @Public()
  @Get()
  async check(): Promise<HealthResponse> {
    try {
      // Real DB round-trip, not just a config check.
      await this.db.ping();
    } catch (error) {
      throw new HttpException(
        { status: 'error', db: false, message: (error as Error).message },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return { status: 'ok', db: true };
  }
}
