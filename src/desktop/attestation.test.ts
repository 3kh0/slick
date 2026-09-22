import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { verifyBundle } from './attestation.ts';

// A real bundle: GitHub's attestation for the published v85 Linux tarball.
const bundle = JSON.parse(readFileSync(new URL('./fixtures/attestation-v85-linux-x64.json', import.meta.url), 'utf8'));
const DIGEST = '212b5fe66576edb51d5842c25d7156182e18f623f07c6f7cc49637bd027743a1';
const clone = () => structuredClone(bundle);

test('accepts the release workflow attestation for the matching digest', () => {
  assert.doesNotThrow(() => verifyBundle(bundle, DIGEST));
  assert.doesNotThrow(() => verifyBundle(bundle, DIGEST.toUpperCase()));
});

test('refuses a download whose digest the attestation does not cover', () => {
  assert.throws(() => verifyBundle(bundle, DIGEST.replace(/^./, '0')), /subject does not match/);
});

test('refuses a payload that was changed after signing', () => {
  const tampered = clone();
  const statement = JSON.parse(Buffer.from(tampered.dsseEnvelope.payload, 'base64').toString('utf8'));
  statement.subject[0].digest.sha256 = '0'.repeat(64);
  tampered.dsseEnvelope.payload = Buffer.from(JSON.stringify(statement)).toString('base64');
  assert.throws(() => verifyBundle(tampered, '0'.repeat(64)), /signature is invalid/);
});

test('refuses a signature that is not the original', () => {
  const tampered = clone();
  const sig = Buffer.from(tampered.dsseEnvelope.signatures[0].sig, 'base64');
  sig[sig.length - 1] ^= 1;
  tampered.dsseEnvelope.signatures[0].sig = sig.toString('base64');
  assert.throws(() => verifyBundle(tampered, DIGEST));
});

test('refuses a certificate that does not chain to Fulcio', () => {
  const tampered = clone();
  const cert = Buffer.from(tampered.verificationMaterial.certificate.rawBytes, 'base64');
  cert[cert.length - 10] ^= 1;
  tampered.verificationMaterial.certificate.rawBytes = cert.toString('base64');
  assert.throws(() => verifyBundle(tampered, DIGEST));
});

test('refuses bundles missing their parts', () => {
  assert.throws(() => verifyBundle({}, DIGEST), /missing required fields/);
  const unsigned = clone();
  unsigned.dsseEnvelope.signatures = [];
  assert.throws(() => verifyBundle(unsigned, DIGEST), /no signature/);
});
