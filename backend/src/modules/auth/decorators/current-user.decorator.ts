import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Extracts the authenticated user object from the request.
 * The user is injected by JwtAuthGuard or ApiKeyAuthGuard after validation.
 *
 * Usage:
 *   @Get('profile')
 *   getProfile(@CurrentUser() user: AuthenticatedUser) { ... }
 *
 *   @Get('org')
 *   getOrg(@CurrentUser('organizationId') orgId: string) { ... }
 */
export const CurrentUser = createParamDecorator(
  (data: string | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      return null;
    }

    return data ? user[data] : user;
  },
);

/**
 * Shape of the user object attached to request after authentication
 */
export interface AuthenticatedUser {
  userId: string;
  email: string;
  organizationId: string;
  role: string;
}
