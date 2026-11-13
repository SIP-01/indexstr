import { describe, expect, test } from 'vitest';
import { normalizeIndexUrl, documentId, contentHash, buildIndexEvent } from './webIndex';

/**
 * SIP-01 §7 normalization — the ecosystem-critical property: every
 * implementation must produce byte-identical output for the same page or
 * `d`-tag dedup breaks. Vectors mirror spec §13.1.
 */
describe('normalizeIndexUrl', () => {
  test('keeps a clean root URL unchanged', () => {
    expect(normalizeIndexUrl('https://example.com/')).toBe('https://example.com/');
  });

  test('spec vector: scheme/host case, default port, tracking, fragment, param order', () => {
    expect(
      normalizeIndexUrl('HTTPS://WWW.Example.Com:443/page/?b=2&utm_source=x&a=1#top'),
    ).toBe('https://example.com/page?a=1&b=2');
  });

  test('keeps a non-slash-terminated path as-is', () => {
    expect(normalizeIndexUrl('https://example.com/page')).toBe('https://example.com/page');
  });

  test('path case is significant (GitHub owner/repo must survive)', () => {
    expect(normalizeIndexUrl('https://github.com/NostrDanish/Crwalstr')).toBe(
      'https://github.com/NostrDanish/Crwalstr',
    );
  });

  test('strips known tracking parameters but keeps real ones', () => {
    expect(normalizeIndexUrl('https://example.com/?fbclid=abc&id=7')).toBe(
      'https://example.com/?id=7',
    );
  });

  test('removes default http port', () => {
    expect(normalizeIndexUrl('http://example.com:80/x')).toBe('http://example.com/x');
  });

  test('keeps non-default ports', () => {
    expect(normalizeIndexUrl('http://example.com:8080/x')).toBe('http://example.com:8080/x');
  });

  test('drops the fragment', () => {
    expect(normalizeIndexUrl('https://example.com/a#section')).toBe('https://example.com/a');
  });

  test('rejects non-http(s) schemes', () => {
    expect(normalizeIndexUrl('ftp://example.com/x')).toBeNull();
    expect(normalizeIndexUrl('file:///etc/passwd')).toBeNull();
    expect(normalizeIndexUrl('javascript:alert(1)')).toBeNull();
  });

  test('rejects garbage', () => {
    expect(normalizeIndexUrl('not a url')).toBeNull();
    expect(normalizeIndexUrl('')).toBeNull();
  });

  test('trailing slash only stripped on non-root paths', () => {
    expect(normalizeIndexUrl('https://example.com/dir/')).toBe('https://example.com/dir');
    expect(normalizeIndexUrl('https://example.com/')).toBe('https://example.com/');
  });

  test('duplicate query parameters are preserved in stable input order', () => {
    // Duplicate keys may be semantically meaningful. SIP-01 requires a
    // stable sort by key, so values with equal keys retain their input order.
    expect(normalizeIndexUrl('https://example.com/?a=2&a=1')).toBe(
      'https://example.com/?a=2&a=1',
    );
  });
});

describe('documentId', () => {
  test('is widx: + 32 hex chars, deterministic per URL', async () => {
    const a = await documentId('https://example.com/');
    const b = await documentId('https://example.com/');
    expect(a).toBe(b);
    expect(a).toMatch(/^widx:[0-9a-f]{32}$/);
  });

  test('different URLs get different ids', async () => {
    expect(await documentId('https://example.com/a')).not.toBe(
      await documentId('https://example.com/b'),
    );
  });
});

describe('contentHash', () => {
  test('sha256 of title + newline + description', async () => {
    const hash = await contentHash('Title', 'Desc');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await contentHash('Title', 'Desc')).toBe(hash);
    expect(await contentHash('Title', 'Other')).not.toBe(hash);
  });
});

/**
 * Rule zero: byte-compatibility. The exact §13 test vectors from the
 * canonical spec (v1.3) — if these pass, our events deduplicate against
 * every other implementation in the ecosystem (0xSearchstr, UNCAGED-ENGINE,
 * Crawlstr, UNCAGED Index Relay).
 */
describe('SIP-01 §13 test vectors (exact hashes)', () => {
  const D_VECTORS = [
    {
      input: 'https://example.com/',
      normalized: 'https://example.com/',
      d: 'widx:0f115db062b7c0dd030b16878c99dea5',
    },
    {
      input: 'HTTPS://WWW.Example.Com:443/page/?b=2&utm_source=x&a=1#top',
      normalized: 'https://example.com/page?a=1&b=2',
      d: 'widx:f68176b3eb966bd682c3c6eadcc5fe44',
    },
    {
      input: 'https://example.com/page',
      normalized: 'https://example.com/page',
      d: 'widx:3641c5f2274c5471278ab5bf1df6d185',
    },
    {
      input: 'https://github.com/NostrDanish/Crwalstr',
      normalized: 'https://github.com/NostrDanish/Crwalstr',
      d: 'widx:cdfd4df8c01d609fc9cdf943afa80197',
    },
  ];

  test.each(D_VECTORS)('normalizes %s byte-identically', ({ input, normalized }) => {
    expect(normalizeIndexUrl(input)).toBe(normalized);
  });

  test.each(D_VECTORS)('derives the exact d tag for %s', async ({ input, d }) => {
    const normalized = normalizeIndexUrl(input);
    expect(normalized).not.toBeNull();
    expect(await documentId(normalized!)).toBe(d);
  });

  const X_VECTORS = [
    {
      title: 'Example',
      description: '',
      x: 'e1762f14d9924e37b32f1c81dfd256410af462f5136415c96877efa8c80345d0',
    },
    {
      title: 'Example Page',
      description: 'A page about examples.',
      x: '2a5cbdf44513f552fb571d6c6de2ddf16c5452b235cc887980b52898fb38e7c1',
    },
  ];

  test.each(X_VECTORS)('derives the exact x tag for "$title"', async ({ title, description, x }) => {
    expect(await contentHash(title, description)).toBe(x);
  });
});


describe('SIP-01 v1.3 capability references', () => {
  test('emits role, repeatable proto tags and a kind-39698 pointer', async () => {
    const event = await buildIndexEvent({
      url: 'https://example.com/mcp',
      title: 'Example tool',
      role: 'tool',
      proto: ['mcp', 'http'],
      capabilityAddress: '39698:' + 'a'.repeat(64) + ':example-tool',
    });
    expect(event?.tags).toContainEqual(['role', 'tool']);
    expect(event?.tags).toContainEqual(['proto', 'mcp']);
    expect(event?.tags).toContainEqual(['proto', 'http']);
    expect(event?.tags).toContainEqual(['a', '39698:' + 'a'.repeat(64) + ':example-tool']);
  });
});
