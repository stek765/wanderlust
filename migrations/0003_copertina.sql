-- La copertina di un viaggio si può scegliere.
--
-- Finora era sempre la foto più vecchia: una scelta ragionevole ma arbitraria, e la prima
-- foto di un viaggio quasi mai è quella che lo racconta. Qui il viaggio può indicarne una,
-- e quando non lo fa resta la regola di prima.
--
-- NULL non è un difetto: è "non ho ancora scelto".
ALTER TABLE trips ADD COLUMN cover_photo_id TEXT;
