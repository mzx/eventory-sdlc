import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AdminGuard } from './admin.guard';
import { AuthController } from './auth.controller';
import { AuthService, DEFAULT_JWT_SECRET } from './auth.service';
import { GoogleStrategy } from './google.strategy';
import { JwtAuthGuard } from './jwt-auth.guard';

@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      // See `DEFAULT_JWT_SECRET`'s doc comment — dev/test fallback only; the
      // operator must set `JWT_SECRET` for real deployments.
      secret: process.env.JWT_SECRET || DEFAULT_JWT_SECRET,
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, GoogleStrategy, JwtAuthGuard, AdminGuard],
  // Exported so `AppModule`'s global `APP_GUARD` providers (and `UsersModule`,
  // for `AdminGuard`) can inject them; `AuthService` is also consumed
  // directly by `AuthController` here.
  exports: [AuthService, JwtAuthGuard, AdminGuard],
})
export class AuthModule {}
