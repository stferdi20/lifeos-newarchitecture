import test from 'node:test';
import assert from 'node:assert/strict';

import { buildInstagramClaimFailurePayload } from '../instagram-download-queue.js';

test('buildInstagramClaimFailurePayload preserves worker ownership metadata', () => {
  const payload = buildInstagramClaimFailurePayload(
    { claim_token: 'claim-token-1' },
    'Google Drive is not connected for this account.',
    'worker-1',
  );

  assert.deepEqual(payload, {
    message: 'Google Drive is not connected for this account.',
    workerId: 'worker-1',
    claimToken: 'claim-token-1',
  });
});
