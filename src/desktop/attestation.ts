// Slick Update Attestation
//
// The check that decides whether a downloaded update may be installed, kept
// apart from updater.ts so it can be tested without Electron. An update is
// only installed if GitHub holds a SLSA build-provenance attestation whose
// subject digest matches the bytes downloaded, signed by a Fulcio certificate
// chaining to the sigstore public-good root, whose SAN names Slick's own
// release workflow.

import crypto from 'node:crypto';
import fs from 'node:fs';

const REPO = '3kh0/slick';
const WORKFLOW_URI = `https://github.com/${REPO}/.github/workflows/release.yml`;
const SLSA_PROVENANCE = 'https://slsa.dev/provenance/v1';

// Public-good Fulcio roots from sigstore.dev.
const FULCIO_INTERMEDIATE_PEM = `-----BEGIN CERTIFICATE-----
MIICGjCCAaGgAwIBAgIUALnViVfnU0brJasmRkHrn/UnfaQwCgYIKoZIzj0EAwMw
KjEVMBMGA1UEChMMc2lnc3RvcmUuZGV2MREwDwYDVQQDEwhzaWdzdG9yZTAeFw0y
MjA0MTMyMDA2MTVaFw0zMTEwMDUxMzU2NThaMDcxFTATBgNVBAoTDHNpZ3N0b3Jl
LmRldjEeMBwGA1UEAxMVc2lnc3RvcmUtaW50ZXJtZWRpYXRlMHYwEAYHKoZIzj0C
AQYFK4EEACIDYgAE8RVS/ysH+NOvuDZyPIZtilgUF9NlarYpAd9HP1vBBH1U5CV7
7LSS7s0ZiH4nE7Hv7ptS6LvvR/STk798LVgMzLlJ4HeIfF3tHSaexLcYpSASr1kS
0N/RgBJz/9jWCiXno3sweTAOBgNVHQ8BAf8EBAMCAQYwEwYDVR0lBAwwCgYIKwYB
BQUHAwMwEgYDVR0TAQH/BAgwBgEB/wIBADAdBgNVHQ4EFgQU39Ppz1YkEZb5qNjp
KFWixi4YZD8wHwYDVR0jBBgwFoAUWMAeX5FFpWapesyQoZMi0CrFxfowCgYIKoZI
zj0EAwMDZwAwZAIwPCsQK4DYiZYDPIaDi5HFKnfxXx6ASSVmERfsynYBiX2X6SJR
nZU84/9DZdnFvvxmAjBOt6QpBlc4J/0DxvkTCqpclvziL6BCCPnjdlIB3Pu3BxsP
mygUY7Ii2zbdCdliiow=
-----END CERTIFICATE-----
`;
const FULCIO_ROOT_PEM = `-----BEGIN CERTIFICATE-----
MIIB9zCCAXygAwIBAgIUALZNAPFdxHPwjeDloDwyYChAO/4wCgYIKoZIzj0EAwMw
KjEVMBMGA1UEChMMc2lnc3RvcmUuZGV2MREwDwYDVQQDEwhzaWdzdG9yZTAeFw0y
MTEwMDcxMzU2NTlaFw0zMTEwMDUxMzU2NThaMCoxFTATBgNVBAoTDHNpZ3N0b3Jl
LmRldjERMA8GA1UEAxMIc2lnc3RvcmUwdjAQBgcqhkjOPQIBBgUrgQQAIgNiAAT7
XeFT4rb3PQGwS4IajtLk3/OlnpgangaBclYpsYBr5i+4ynB07ceb3LP0OIOZdxex
X69c5iVuyJRQ+Hz05yi+UF3uBWAlHpiS5sh0+H2GHE7SXrk1EC5m1Tr19L9gg92j
YzBhMA4GA1UdDwEB/wQEAwIBBjAPBgNVHRMBAf8EBTADAQH/MB0GA1UdDgQWBBRY
wB5fkUWlZql6zJChkyLQKsXF+jAfBgNVHSMEGDAWgBRYwB5fkUWlZql6zJChkyLQ
KsXF+jAKBggqhkjOPQQDAwNpADBmAjEAj1nHeXZp+13NWBNa+EDsDP8G1WWg1tCM
WP/WHPqpaVo0jhsweNFZgSs0eE7wYI4qAjEA2WB9ot98sIkoF3vZYdd3/VtWB5b9
TNMea7Ix/stJ5TfcLLeABLE4BNJOsQ4vnBHJ
-----END CERTIFICATE-----
`;

export class AttestationError extends Error {
  readonly code = 'ATTESTATION';
}

function derToPem(der: Buffer): string {
  const lines = der.toString('base64').match(/.{1,64}/g) ?? [];
  return `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----\n`;
}

/** DSSE pre-authentication encoding: what the signature actually covers. */
function dssePae(payloadType: string, payload: Buffer): Buffer {
  const type = Buffer.from(payloadType);
  return Buffer.concat([Buffer.from(`DSSEv1 ${type.length} `), type, Buffer.from(` ${payload.length} `), payload]);
}

export function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(file);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

export function verifyBundle(bundle: any, digestHex: string): void {
  if (!bundle?.dsseEnvelope || !bundle.verificationMaterial) {
    throw new AttestationError('attestation bundle is missing required fields');
  }
  const env = bundle.dsseEnvelope;
  const payload = Buffer.from(env.payload, 'base64');
  const payloadType = env.payloadType || '';
  if (payloadType !== 'application/vnd.in-toto+json') {
    throw new AttestationError('unexpected attestation payload type');
  }
  const sigEntry = env.signatures?.[0] ?? null;
  if (!sigEntry?.sig) throw new AttestationError('attestation has no signature');
  const sig = Buffer.from(sigEntry.sig, 'base64');

  const certRaw = bundle.verificationMaterial.certificate?.rawBytes;
  if (!certRaw) throw new AttestationError('attestation is missing signing certificate');
  const leaf = new crypto.X509Certificate(derToPem(Buffer.from(certRaw, 'base64')));
  const intermediate = new crypto.X509Certificate(FULCIO_INTERMEDIATE_PEM);
  const root = new crypto.X509Certificate(FULCIO_ROOT_PEM);
  if (!leaf.verify(intermediate.publicKey)) {
    throw new AttestationError('signing certificate is not trusted (Fulcio intermediate)');
  }
  if (!intermediate.verify(root.publicKey)) {
    throw new AttestationError('Fulcio intermediate is not trusted');
  }

  // The SAN is what ties the signature to Slick's own workflow rather than to
  // any other project that happens to use the same public-good roots.
  const san = String(leaf.subjectAltName || '');
  const sanOk = san
    .split(/,\s*/)
    .some((part) => part === `URI:${WORKFLOW_URI}` || part.startsWith(`URI:${WORKFLOW_URI}@`));
  if (!sanOk) throw new AttestationError('attestation was not signed by the Slick release workflow');

  const msg = dssePae(payloadType, payload);
  if (!crypto.verify('sha256', msg, { key: leaf.publicKey, dsaEncoding: 'der' }, sig)) {
    throw new AttestationError('attestation signature is invalid');
  }

  let statement: any;
  try {
    statement = JSON.parse(payload.toString('utf8'));
  } catch {
    throw new AttestationError('attestation payload is not valid JSON');
  }
  if (statement.predicateType !== SLSA_PROVENANCE) {
    throw new AttestationError('attestation is not SLSA build provenance');
  }
  const subjects = Array.isArray(statement.subject) ? statement.subject : [];
  const digest = String(digestHex).toLowerCase();
  const subjectOk = subjects.some((s: any) => String(s?.digest?.sha256 || '').toLowerCase() === digest);
  if (!subjectOk) throw new AttestationError('attestation subject does not match the downloaded file');

  const builderId = statement.predicate?.runDetails?.builder?.id || '';
  if (!String(builderId).startsWith(`${WORKFLOW_URI}@`)) {
    throw new AttestationError('attestation builder identity is unexpected');
  }
}
