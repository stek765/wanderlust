-- Indice dei posti e delle foto.
-- Qui NON stanno né i file né le chiavi di cifratura: solo dove trovare i blob su R2.

CREATE TABLE places (
  slug             TEXT PRIMARY KEY,   -- id casuale non indovinabile, compare nell'URL
  name             TEXT NOT NULL,
  lat              REAL NOT NULL,
  lon              REAL NOT NULL,
  cover_photo_id   TEXT,               -- photos.id, NULL finché non c'è nessuna foto
  write_token_hash TEXT NOT NULL,      -- SHA-256 esadecimale del token di scrittura
  created_at       INTEGER NOT NULL
);

CREATE TABLE photos (
  id          TEXT PRIMARY KEY,
  place_slug  TEXT NOT NULL REFERENCES places(slug) ON DELETE CASCADE,
  r2_key      TEXT NOT NULL,   -- blob cifrato, versione grande
  thumb_key   TEXT NOT NULL,   -- blob cifrato, miniatura
  width       INTEGER NOT NULL,
  height      INTEGER NOT NULL,
  taken_at    INTEGER,         -- da EXIF, NULL se la foto non ce l'ha
  sort_index  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE INDEX idx_photos_place ON photos(place_slug, sort_index);
