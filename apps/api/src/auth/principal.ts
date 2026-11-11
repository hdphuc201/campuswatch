import {
  createParamDecorator,
  type ExecutionContext,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';

/** Who is calling. The owner always comes from a verified token, never from the request body. */
export type Principal =
  | { readonly kind: 'user'; readonly userId: string }
  | { readonly kind: 'device'; readonly userId: string; readonly deviceId: string };

export type DevicePrincipal = Extract<Principal, { kind: 'device' }>;

export interface RequestWithPrincipal {
  readonly headers: Record<string, string | string[] | undefined>;
  principal?: Principal;
}

export const AUTH_MODE_KEY = 'campuswatch:auth-mode';

/**
 * Routes require a user access token unless marked otherwise.
 * - `public`: no token (health, register, login, refresh, logout).
 * - `device`: a device token issued by `POST /devices/register`.
 */
export type AuthMode = 'user' | 'device' | 'public';

export const Public = () => SetMetadata(AUTH_MODE_KEY, 'public' satisfies AuthMode);
export const DeviceAuth = () => SetMetadata(AUTH_MODE_KEY, 'device' satisfies AuthMode);

function principalOf(context: ExecutionContext): Principal {
  const principal = context.switchToHttp().getRequest<RequestWithPrincipal>().principal;
  if (!principal) {
    throw new UnauthorizedException();
  }
  return principal;
}

/** The authenticated user's id (user or device token). */
export const CurrentUserId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => principalOf(context).userId,
);

/** The authenticated device; only valid on `@DeviceAuth()` routes. */
export const CurrentDevice = createParamDecorator(
  (_data: unknown, context: ExecutionContext): DevicePrincipal => {
    const principal = principalOf(context);
    if (principal.kind !== 'device') {
      throw new UnauthorizedException();
    }
    return principal;
  },
);
