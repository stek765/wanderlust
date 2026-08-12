-- I posti smettono di essere isole: diventano tappe di un viaggio.
--
-- Ricostruzione da zero e non conversione: niente è mai stato deployato, e l'unico dato
-- esistente è un posto di prova sul database locale. Portarsi dietro una conversione per
-- un solo record costerebbe più di quanto vale.
--
-- La chiave di cifratura e il token di scrittura appartengono ora al VIAGGIO: è quello
-- che rende possibile scorrere da una tappa all'altra decifrando con un'unica chiave.

DROP TABLE IF EXISTS photos;
DROP TABLE IF EXISTS places;

CREATE TABLE trips (
  slug             TEXT PRIMARY KEY,   -- id casuale, non compare mai in un URL del browser
  name             TEXT NOT NULL,
  write_token_hash TEXT NOT NULL,      -- SHA-256 esadecimale del token di scrittura
  created_at       INTEGER NOT NULL
);

CREATE TABLE stops (
  slug       TEXT PRIMARY KEY,         -- id casuale, è questo che sta nell'URL del tag NFC
  trip_slug  TEXT NOT NULL REFERENCES trips(slug) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  lat        REAL NOT NULL,
  lon        REAL NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE photos (
  id         TEXT PRIMARY KEY,
  stop_slug  TEXT NOT NULL REFERENCES stops(slug) ON DELETE CASCADE,
  r2_key     TEXT NOT NULL,   -- blob cifrato, versione grande
  thumb_key  TEXT NOT NULL,   -- blob cifrato, miniatura
  width      INTEGER NOT NULL,
  height     INTEGER NOT NULL,
  taken_at   INTEGER,         -- da EXIF, NULL se la foto non ce l'ha
  sort_index INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_stops_trip  ON stops(trip_slug, created_at);
CREATE INDEX idx_photos_stop ON photos(stop_slug, sort_index);
