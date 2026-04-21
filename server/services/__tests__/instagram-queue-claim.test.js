import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildInstagramClaimFailurePayload,
  isGoogleDriveAuthRequiredError,
} from '../instagram-download-queue.js';

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

test('isGoogleDriveAuthRequiredError detects Drive reconnect failures', () => {
  assert.equal(isGoogleDriveAuthRequiredError('Google drive needs to be reconnected.'), true);
  assert.equal(isGoogleDriveAuthRequiredError('Google Drive is not connected for this account.'), true);
  assert.equal(isGoogleDriveAuthRequiredError('Instagram content is private or requires login.'), false);
});
