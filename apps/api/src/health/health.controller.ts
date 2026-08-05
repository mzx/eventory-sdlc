import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { DbService } from '../db/db.service';

interface HealthResponse {
  status: 'ok';
  db: true;
}

@Controller('health')
export class HealthController {
  constructor(private readonly db: DbService) {}

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
