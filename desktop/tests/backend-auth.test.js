import { describe, it, expect } from 'vitest';
import backendAuth from '../lib/backend-auth';

describe('authedBackendHeaders', () => {
  it('sends both the local API token and the signed-in user session', () => {
    const headers = backendAuth.authedBackendHeaders(
      { 'X-Lore-Token': 'local-install-token' },
      'user-session-jwt',
    );

    expect(headers['X-Lore-Token']).toBe('local-install-token');
    expect(headers.Authorization).toBe('Bearer user-session-jwt');
    expect(headers['content-type']).toBe('application/json');
  });

  it('preserves explicit request headers', () => {
    const headers = backendAuth.authedBackendHeaders(
      { 'X-Lore-Token': 'local-install-token' },
      'user-session-jwt',
      { 'x-request-id': 'team-create' },
    );

    expect(headers['x-request-id']).toBe('team-create');
  });
});
