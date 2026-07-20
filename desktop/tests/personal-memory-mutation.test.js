import { describe, expect, it, vi } from 'vitest';

import personalMemory from '../lib/personal-memory';


describe('personal memory mutation boundary', () => {
  it('invalidates frozen prompt context after a successful mutation', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, version: 2 });
    const invalidate = vi.fn();
    const result = await personalMemory.mutate(
      fetcher,
      invalidate,
      '/learn/memory/user',
      { method: 'PUT' },
    );
    expect(result.version).toBe(2);
    expect(invalidate).toHaveBeenCalledOnce();
  });

  it('keeps the existing cache when the backend mutation fails', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('backend failed'));
    const invalidate = vi.fn();
    await expect(personalMemory.mutate(fetcher, invalidate, '/learn/memory/user'))
      .rejects.toThrow('backend failed');
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('serializes a stable newline-terminated export', () => {
    const bundle = { schema: 'lore-personal-memory/v1', documents: [] };
    expect(personalMemory.serializeExport(bundle)).toBe(
      '{\n  "schema": "lore-personal-memory/v1",\n  "documents": []\n}\n',
    );
  });
});

