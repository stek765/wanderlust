import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

describe('schema', () => {
  it('ha le tabelle dei viaggi e non più quella dei posti', async () => {
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    ).all<{ name: string }>();
    const nomi = results.map((r) => r.name);

    expect(nomi).toContain('trips');
    expect(nomi).toContain('stops');
    expect(nomi).toContain('photos');
    expect(nomi).not.toContain('places');
  });

  it('lega ogni tappa a un viaggio e ogni foto a una tappa', async () => {
    await env.DB.prepare(
      'INSERT INTO trips (slug, name, write_token_hash, created_at) VALUES (?, ?, ?, ?)',
    ).bind('viaggio1', 'Thailandia', 'hash', 1).run();

    await env.DB.prepare(
      'INSERT INTO stops (slug, trip_slug, name, lat, lon, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).bind('tappa1', 'viaggio1', 'Bangkok', 13.7563, 100.5018, 2).run();

    const riga = await env.DB.prepare(
      'SELECT t.name AS viaggio FROM stops s JOIN trips t ON t.slug = s.trip_slug WHERE s.slug = ?',
    ).bind('tappa1').first<{ viaggio: string }>();

    expect(riga?.viaggio).toBe('Thailandia');

    await env.DB.exec('DELETE FROM stops');
    await env.DB.exec('DELETE FROM trips');
  });

  it('non conserva più la colonna della copertina', async () => {
    const { results } = await env.DB.prepare('PRAGMA table_info(stops)').all<{ name: string }>();
    expect(results.map((r) => r.name)).not.toContain('cover_photo_id');
  });
});
