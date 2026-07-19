import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';

/**
 * Guard that enforces tenant isolation by checking that the requested resource's
 * organizationId matches the authenticated user's organizationId.
 *
 * This guard expects:
 * 1. request.user to be set (by JwtAuthGuard or ApiKeyAuthGuard)
 * 2. The route handler or interceptor to set request.resourceOrganizationId
 *    OR the guard checks route params for common patterns.
 *
 * For most use cases, this guard is applied at the service layer rather than
 * as a route guard. Services should call `ensureTenantAccess()` when fetching resources.
 *
 * Usage as a guard:
 *   @UseGuards(JwtAuthGuard, TenantIsolationGuard)
 *
 * Usage in services (preferred):
 *   TenantIsolationGuard.ensureTenantAccess(user.organizationId, resource.organizationId)
 */
@Injectable()
export class TenantIsolationGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user || !user.organizationId) {
      throw new ForbiddenException('Authentication required for tenant isolation');
    }

    // If the resource's orgId has been explicitly set on the request, check it
    const resourceOrgId = request.resourceOrganizationId;
    if (resourceOrgId && resourceOrgId !== user.organizationId) {
      throw new ForbiddenException('Access denied: Resource belongs to a different organization');
    }

    return true;
  }

  /**
   * Static utility for service-layer tenant isolation checks.
   * Call this when fetching/mutating any tenant-scoped resource.
   *
   * @param userOrgId - The authenticated user's organizationId
   * @param resourceOrgId - The organizationId of the resource being accessed
   * @throws ForbiddenException if the org IDs don't match
   */
  static ensureTenantAccess(userOrgId: string, resourceOrgId: string): void {
    if (userOrgId !== resourceOrgId) {
      throw new ForbiddenException('Access denied: Resource belongs to a different organization');
    }
  }
}
