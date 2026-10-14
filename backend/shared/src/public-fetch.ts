import { lookup } from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';

const blocked = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24],
  ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) blocked.addSubnet(address, prefix, 'ipv4');

const globalIPv6 = new BlockList();
globalIPv6.addSubnet('2000::', 3, 'ipv6');
blocked.addSubnet('2001::', 23, 'ipv6'); // Protocol assignments, including Teredo/ORCHID.
blocked.addSubnet('2001:db8::', 32, 'ipv6');
blocked.addSubnet('2002::', 16, 'ipv6'); // 6to4 can embed a private IPv4 destination.
blocked.addSubnet('3fff::', 20, 'ipv6');

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, 'ipv4');
  return family === 6 && globalIPv6.check(address, 'ipv6') && !blocked.check(address, 'ipv6');
}

async function requestPublic(url: URL, headers: Record<string, string>, signal: AbortSignal): Promise<IncomingMessage> {
  signal.throwIfAborted();
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Crawler URL must be an HTTP(S) URL without credentials');
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const family = isIP(hostname);
  const addresses = family ? [{ address: hostname, family }] : await new Promise<LookupAddress[]>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    void lookup(hostname, { all: true }).then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', abort));
  });
  signal.throwIfAborted();
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new Error('Crawler destination must resolve only to public addresses');
  }
  const address = addresses.find((entry) => entry.family === 4) ?? addresses[0];
  const request = url.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = request(url, {
      headers: { ...headers, 'Accept-Encoding': 'gzip, deflate, br' },
      signal,
      agent: false,
      family: address.family,
      // Pin the checked address: a second DNS lookup must not permit rebinding.
      lookup: (_hostname, options, callback) => callback(null, options.all ? [address] : address.address, address.family),
    }, resolve);
    req.on('error', reject);
    req.end();
  });
}

async function readLimitedText(response: IncomingMessage, maxBytes: number): Promise<string> {
  const encoding = response.headers['content-encoding']?.toLowerCase();
  const decoder = encoding === 'gzip' ? createGunzip()
    : encoding === 'deflate' ? createInflate()
      : encoding === 'br' ? createBrotliDecompress() : undefined;
  const body = decoder ? response.pipe(decoder) : response;
  if (decoder) response.on('error', (error) => decoder.destroy(error));
  try {
    if (encoding && encoding !== 'identity' && !decoder) throw new Error('Unsupported content encoding');
    if (Number(response.headers['content-length']) > maxBytes) throw new Error('Response too large');
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of body) {
      if (!Buffer.isBuffer(chunk)) throw new Error('Unexpected response chunk');
      bytes += chunk.length;
      if (bytes > maxBytes) throw new Error('Response too large');
      chunks.push(chunk);
    }
    return Buffer.concat(chunks, bytes).toString('utf8');
  } finally {
    body.destroy();
    response.destroy();
  }
}

/** Every request and redirect uses a checked, pinned address; limits cover decoded bytes. */
export async function fetchPublicText(
  value: string,
  options: { headers: Record<string, string>; maxBytes: number; timeoutMs: number },
): Promise<{ ok: boolean; headers: Headers; text: string; url: string }> {
  const signal = AbortSignal.timeout(options.timeoutMs);
  let url = new URL(value);
  for (let redirects = 0; redirects <= 5; redirects++) {
    const response = await requestPublic(url, options.headers, signal);
    const status = response.statusCode ?? 500;
    if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
      response.destroy();
      url = new URL(response.headers.location, url);
      continue;
    }
    const headers = new Headers();
    for (const [name, value] of Object.entries(response.headers)) {
      if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
    }
    return { ok: status >= 200 && status < 300, headers, text: await readLimitedText(response, options.maxBytes), url: url.href };
  }
  throw new Error('Too many redirects');
}
