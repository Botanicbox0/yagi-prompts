import { it, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, dirname, resolve, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { createLocalStorageDriver } from '@/lib/storage/local-driver';
it('keeps staging immutable on retries, matching cloud uploads', async () => {
  const dir = await mkdtemp(join(tmpdir(),'twings-private-staging-'));
  try {
    const storage=createLocalStorageDriver(dir);
    await storage.putStaging('brand-workspace/reference.pdf',new Uint8Array([1,2,3]),'application/pdf');
    await storage.putStaging('brand-workspace/reference.pdf',new Uint8Array([9,9,9]),'application/pdf');
    expect(await storage.read('content','brand-workspace/reference.pdf')).toEqual(new Uint8Array([1,2,3]));
    await expect(storage.putStaging('../../escape.pdf',new Uint8Array([1]),'application/pdf')).rejects.toThrow('illegal storage key');
  } finally {
    if (dirname(resolve(dir)) !== resolve(tmpdir()) || !basename(dir).startsWith('twings-private-staging-')) throw Error('Unsafe fixture cleanup');
    await rm(dir,{recursive:true,force:true});
  }
});
