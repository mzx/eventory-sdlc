import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AdminGuard } from './admin.guard';
import { AuthController } from './auth.controller';
import { AuthService, resolveJwtSecret } from './auth.service';
import { GoogleStrategy } from './google.strategy';
import { JwtAuthGuard } from './jwt-auth.guard';

@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      // `resolveJwtSecret` throws at bootstrap when JWT_SECRET is unset (or
      // left at the known dev default) and NODE_ENV=production — see its
      // doc comment in auth.service.ts (EVT-14 review round 2, finding 1).
      secret: resolveJwtSecret(),
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
