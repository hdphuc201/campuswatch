import { describe, expect, it } from 'vitest';
import { loginRequestSchema, registerRequestSchema } from './auth.js';
import { createPortalConnectionRequestSchema } from './connection.js';

describe('registerRequestSchema', () => {
  it('normalizes the email address', () => {
    const parsed = registerRequestSchema.parse({
      email: '  Student@Example.EDU ',
      password: 'correct horse battery',
    });

    expect(parsed.email).toBe('student@example.edu');
  });

  it('rejects short passwords', () => {
    expect(
      registerRequestSchema.safeParse({ email: 'a@example.edu', password: 'short' }).success,
    ).toBe(false);
  });

  it('rejects client-supplied ownership fields', () => {
    const result = loginRequestSchema.safeParse({
      email: 'a@example.edu',
      password: 'whatever',
      userId: '00000000-0000-4000-8000-000000000000',
    });

    expect(result.success).toBe(false);
  });
});

describe('createPortalConnectionRequestSchema', () => {
  it('accepts only known adapters', () => {
    expect(
      createPortalConnectionRequestSchema.safeParse({ adapterKey: 'citd', consentVersion: '1' })
        .success,
    ).toBe(true);
    expect(
      createPortalConnectionRequestSchema.safeParse({ adapterKey: 'other', consentVersion: '1' })
        .success,
    ).toBe(false);
  });
});
