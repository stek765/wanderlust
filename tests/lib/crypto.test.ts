import { describe, expect, it } from 'vitest';
import {
  base64UrlDecode,
  base64UrlEncode,
  decryptBlob,
  encryptBlob,
  exportKey,
  generateKey,
  importKey,
} from '../../src/lib/crypto';

const bytesOf = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer;
const textOf = (buffer: ArrayBuffer) => new TextDecoder().decode(buffer);

describe('cifratura', () => {
  it('riporta indietro esattamente i byte di partenza', async () => {
    const key = await generateKey();
    const original = bytesOf('finta foto di Bangkok');

    const encrypted = await encryptBlob(key, original);
    const decrypted = await decryptBlob(key, await encrypted.arrayBuffer());

    expect(textOf(decrypted)).toBe('finta foto di Bangkok');
  });

  it('produce un ciphertext diverso ogni volta, a parità di chiave e contenuto', async () => {
    // Se due cifrature identiche dessero lo stesso output, l'IV non starebbe cambiando —
    // ed è esattamente la condizione che rompe AES-GCM.
    const key = await generateKey();
    const data = bytesOf('stesso contenuto');

    const first = new Uint8Array(await (await encryptBlob(key, data)).arrayBuffer());
    const second = new Uint8Array(await (await encryptBlob(key, data)).arrayBuffer());

    expect(first).not.toEqual(second);
    expect(first.subarray(0, 12)).not.toEqual(second.subarray(0, 12));
  });

  it('rifiuta la chiave sbagliata invece di restituire spazzatura', async () => {
    const encrypted = await encryptBlob(await generateKey(), bytesOf('segreto'));
    const otherKey = await generateKey();

    await expect(decryptBlob(otherKey, await encrypted.arrayBuffer())).rejects.toThrow();
  });

  it('si accorge se il ciphertext è stato manomesso', async () => {
    const key = await generateKey();
    const encrypted = new Uint8Array(await (await encryptBlob(key, bytesOf('intatto'))).arrayBuffer());
    const ultimo = encrypted.length - 1;
    encrypted[ultimo] = (encrypted[ultimo] ?? 0) ^ 0xff;

    await expect(decryptBlob(key, encrypted.buffer as ArrayBuffer)).rejects.toThrow();
  });

  it('rifiuta un blob troppo corto per contenere un IV', async () => {
    const key = await generateKey();
    await expect(decryptBlob(key, new Uint8Array(5).buffer as ArrayBuffer)).rejects.toThrow(/troppo corto/);
  });
});

describe('chiavi', () => {
  it('sopravvive al giro esporta → testo → importa', async () => {
    const key = await generateKey();
    const encoded = await exportKey(key);
    const reimported = await importKey(encoded);

    const encrypted = await encryptBlob(key, bytesOf('viaggio'));
    const decrypted = await decryptBlob(reimported, await encrypted.arrayBuffer());

    expect(textOf(decrypted)).toBe('viaggio');
  });

  it('produce una chiave che sta in un URL senza doverla codificare', async () => {
    const encoded = await exportKey(await generateKey());
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(encoded).toBe(encodeURIComponent(encoded));
  });

  it('rifiuta una chiave di lunghezza sbagliata', async () => {
    await expect(importKey(base64UrlEncode(new Uint8Array(16)))).rejects.toThrow(/lunghezza/);
  });
});

describe('base64url', () => {
  it('gestisce i byte che in base64 normale userebbero + e /', async () => {
    const bytes = new Uint8Array([0xfb, 0xff, 0xbe, 0x00, 0x7f]);
    const encoded = base64UrlEncode(bytes);

    expect(encoded).not.toMatch(/[+/=]/);
    expect(base64UrlDecode(encoded)).toEqual(bytes);
  });

  it('regge tutti i valori possibili di un byte', () => {
    const bytes = new Uint8Array(256).map((_, i) => i);
    expect(base64UrlDecode(base64UrlEncode(bytes))).toEqual(bytes);
  });
});
