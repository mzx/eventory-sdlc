import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';

/**
 * Thin wrapper around a `pg` connection pool.
 *
 * The Prisma schema (apps/api/prisma/schema.prisma) is intentionally empty of
 * domain models for this scaffold task (EVT-1 non-goal), which means
 * `prisma generate` has nothing to emit yet. Prisma is still the schema/migration
 * tool of record (`prisma migrate deploy` runs on every container start — see
 * apps/api/Dockerfile), but until the first domain migration lands we use `pg`
 * directly for the health check's real DB round-trip. Once domain models exist,
 * swap this for `@prisma/client` and generate it in the Docker build.
 */
@Injectable()
export class DbService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DbService.name);
  private readonly pool: Pool;

  constructor() {
    this.pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }

  async onModuleInit(): Promise<void> {
    await this.pool.query('SELECT 1');
    this.logger.log('Connected to database');
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  async ping(): Promise<void> {
    await this.pool.query('SELECT 1');
  }
}
