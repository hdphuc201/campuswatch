import { z } from 'zod';

/** Emails are compared and stored trimmed and lowercased. */
export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export const newPasswordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);

export const registerRequestSchema = z.strictObject({
  email: emailSchema,
  password: newPasswordSchema,
});

export type RegisterRequest = z.infer<typeof registerRequestSchema>;

export const loginRequestSchema = z.strictObject({
  email: emailSchema,
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;

/** Body of `POST /auth/refresh` and `POST /auth/logout`. */
export const refreshTokenRequestSchema = z.strictObject({
  refreshToken: z.string().min(1).max(512),
});

export type RefreshTokenRequest = z.infer<typeof refreshTokenRequestSchema>;

export const authTokensResponseSchema = z.object({
  tokenType: z.literal('Bearer'),
  accessToken: z.string().min(1),
  accessTokenExpiresAt: z.iso.datetime(),
  refreshToken: z.string().min(1),
  refreshTokenExpiresAt: z.iso.datetime(),
});

export type AuthTokensResponse = z.infer<typeof authTokensResponseSchema>;

export const userProfileSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  createdAt: z.iso.datetime(),
});

export type UserProfile = z.infer<typeof userProfileSchema>;
