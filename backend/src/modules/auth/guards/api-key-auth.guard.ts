import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthService } from '../auth.service';

/**
 * Guard that authenticates requests via the X-API-Key header.
 * Falls through to the next guard if no API key is present (allows combining with JwtAuthGuard).
 *
 * Usage: @UseGuards(ApiKeyAuthGuard)
 */
@Injectable()
export class ApiKeyAuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const apiKey = request.headers['x-api-key'] as string;

    if (!apiKey) {
      throw new UnauthorizedException('Missing X-API-Key header');
    }

    const userContext = await this.authService.validateApiKey(apiKey);

    if (!userContext) {
      throw new UnauthorizedException('Invalid or revoked API key');
    }

    // Attach user context to request (same shape as JWT auth)
    request.user = userContext;
    return true;
  }
}
