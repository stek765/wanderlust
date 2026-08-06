# Ricordi NFC — Design

**Data:** 2026-08-06
**Stato:** design approvato, da implementare

## Cos'è

Un magnete da frigo con un tag NFC dentro. Lo tocchi con il telefono, si apre un globo
terrestre che vola sul posto dove sei stato, e da quel punto si aprono le foto di quel
viaggio.

Un magnete corrisponde a un posto e a un solo posto. I posti sono indipendenti: non
esiste una pagina che li elenca tutti, non esiste un percorso per passare da un posto
all'altro. Chi tocca un magnete vede quel viaggio e nient'altro.

## Vincoli

**Uso personale.** Lo usano due persone: Stefano e la sua ragazza. Nessun account,
nessun signup, nessun pagamento, nessun multi-tenant. Se un giorno diventerà un
prodotto, sarà un progetto diverso.

**Caricare foto deve essere banale.** La ragazza deve poter aggiungere foto senza sapere
cos'è un terminale, senza ricordare un indirizzo e senza fare login. Questo vincolo ha
scartato l'ipotesi di uno script CLI ed è la ragione per cui esiste un database.

**Le foto sono private.** Nessun estraneo deve poterle trovare, e il fornitore di hosting
non deve poterle leggere.

**Costo zero.** Il progetto deve stare dentro i piani gratuiti senza margini stretti.

## Perché un sito e non un'app

Su iPhone la lettura NFC in background funziona solo con tag che contengono un URL:
compare la notifica in alto, la tocchi, si apre Safari. Un'app nativa non può essere
avviata da un tag NFC in background — servirebbe aprire l'app e attivare il lettore a
mano, perdendo tutto l'effetto.

Quindi: tag NFC → URL → web app. Il sito è installabile come PWA sulla home, ma la porta
d'ingresso resta sempre un URL.

## Architettura

Tutto su Cloudflare, quattro pezzi.

| Pezzo | Ruolo | Piano gratuito |
|---|---|---|
| **Pages** | serve il sito statico (HTML/JS/CSS) su CDN, HTTPS automatico | illimitato |
| **Worker** | l'API: legge e scrive i metadati, firma i permessi di upload | 100k richieste/giorno |
| **D1** | database SQLite: l'indice di posti e foto | 5 GB |
| **R2** | storage: i file delle foto cifrate | 10 GB, egress gratuito |

R2 è stato scelto al posto di S3 per l'egress gratuito: un sito di foto è quasi tutto
traffico in uscita, e su AWS quello si paga a GB.

**Portabilità.** R2 parla il protocollo S3 e D1 è SQLite. Entrambi sono standard con
implementazioni alternative ovunque: spostare tutto su Backblaze, su un MinIO
auto-ospitato o su un altro provider è un cambio di configurazione, non una riscrittura.
Il codice non deve mai usare API proprietarie Cloudflare oltre a queste due interfacce.

### Flusso di lettura

1. Il tag NFC contiene `https://<dominio>/p/<slug>#<chiave>`. Safari apre la pagina.
2. Pages serve il guscio HTML+JS.
3. Il JS chiede al Worker i metadati dello slug. Il Worker interroga D1 e risponde con
   nome, coordinate, ed elenco delle foto con i rispettivi percorsi su R2.
4. Il browser scarica le miniature cifrate direttamente da R2, senza ripassare dal
   Worker, e le decifra localmente con la chiave presa dal frammento dell'URL.
5. Intanto la mappa vola sul punto. Quando il volo finisce, le miniature sono pronte.

### Flusso di scrittura

1. Sulla pagina del posto compare "+ Aggiungi foto" (le condizioni sotto, in Accessi).
2. Selezione multipla dalla galleria del telefono.
3. Il browser, per ogni foto: legge la data da EXIF, ridimensiona, genera una miniatura
   da 300px, cifra sia la miniatura sia la versione grande.
4. Il browser chiede al Worker dei permessi di upload temporanei (URL firmati R2). Il
   Worker li rilascia solo dopo aver validato il token di scrittura.
5. Il browser carica i blob cifrati **direttamente su R2**, 4 alla volta. I file non
   passano mai dal Worker: nessun limite di dimensione, nessun collo di bottiglia.
6. A caricamento completato, il browser dice al Worker di registrare le foto. Il Worker
   scrive le righe in D1.

## Cifratura

Le foto vengono cifrate nel browser prima di partire. Su R2 arrivano blob illeggibili:
Cloudflare ospita i file senza avere alcun modo di guardarli.

**Algoritmo:** AES-GCM a 256 bit tramite WebCrypto, l'API di cifratura nativa del
browser. Nessuna libreria esterna.

**IV:** 12 byte casuali per ogni file, generati con `crypto.getRandomValues` e
anteposti al ciphertext. Il file su R2 è quindi `[IV 12 byte][ciphertext]`. Non serve
memorizzare l'IV nel database.

**Dove sta la chiave.** Nell'URL, dopo il `#`. Il frammento di un URL non viene **mai**
inviato al server: è nella specifica HTTP, non è una scelta di Cloudflare né una
configurazione che qualcuno può cambiare. Il server riceve `/p/k7f3a9x2m4q` e basta.

**Una chiave per posto**, generata alla creazione del posto. Condividere il link di un
viaggio non espone gli altri viaggi.

**Backup delle chiavi — la parte da non sbagliare.** Se una chiave si perde, quelle foto
sono irrecuperabili: non esiste recupero, non esiste assistenza, la matematica non
ammette eccezioni. Due difese:

- La pagina master (sotto) tiene un portachiavi in `localStorage` con tutte le chiavi.
- Dalla pagina master si esporta un file JSON con tutte le chiavi, da salvare in
  1Password. **Va fatto alla creazione del primo posto e ripetuto a ogni posto nuovo.**

## Accessi

Nessun login, in nessun punto. Il controllo passa da due segreti diversi che stanno in
posti diversi.

**Token di scrittura.** L'URL scritto sul tag NFC è
`/p/<slug>?w=<token>#<chiave>`. Il token sta nella *query string*, che al server ci
arriva. Il Worker ne conserva solo l'hash e lo confronta a ogni richiesta di scrittura.

Alla prima apertura la pagina salva il token in `localStorage` e lo toglie dalla barra
degli indirizzi, così resta valido su quel telefono per sempre senza restare in bella
vista.

Chi ha il token vede "+ Aggiungi foto". Chi non ce l'ha vede solo le foto.

**Il pulsante Condividi copia l'URL senza il token**, cioè `/p/<slug>#<chiave>`. Chi
riceve il link guarda; chi tocca fisicamente il magnete in casa tua carica. La
separazione tra lettura e scrittura è fisica, e non richiede una password.

**Pagina master.** All'indirizzo `/m/<token-master>` si creano i posti nuovi: nome,
ricerca della città sulla mappa per fissare le coordinate, e in uscita l'URL completo da
scrivere sul tag più il pulsante di esportazione del portachiavi. È l'unico indirizzo da
salvare tra i preferiti, e sta in 1Password insieme alle chiavi.

Il token master è un valore casuale generato una sola volta al primo deploy e messo tra
i segreti del Worker (`wrangler secret put`). Il Worker ne conserva l'hash e lo pretende
su ogni rotta che crea posti. Non compare mai nel codice sorgente.

**Cosa questo modello non protegge.** Chiunque entri in casa e tocchi un magnete può
caricare e cancellare foto di quel posto. È una conseguenza accettata dell'aver tolto il
login: chi è davanti al tuo frigo è già in casa tua.

## Foto in quantità

Due problemi distinti con due soluzioni distinte.

**In caricamento.** Le foto vengono ridimensionate sul telefono prima di partire: una
foto iPhone da 4 MB diventa circa 400 KB senza differenza visibile su schermo. Cento
foto passano da 400 MB a 40 MB. Il caricamento procede a 4 in parallelo con barra di
avanzamento, e una foto fallita viene ritentata da sola senza far ricominciare le altre.
Questo è il punto in cui l'utente può frustrarsi, ed è dove va speso il lavoro sui casi
limite.

**In visualizzazione.** La griglia carica solo miniature da 300px (~20 KB). La versione
grande si scarica soltanto quando si tocca una foto. Con lazy loading, il browser
scarica solo le miniature effettivamente visibili sullo schermo: un posto con 300 foto
si apre veloce quanto uno con 5.

**Stima spazio.** 20 posti × 200 foto × (400 KB + 20 KB) ≈ 1,7 GB, contro i 10 GB
gratuiti di R2.

## Animazione

È l'effetto centrale del progetto, non una decorazione.

1. **Apertura:** globo terrestre visto da lontano, in lenta rotazione.
2. **Volo:** in circa 2,5 secondi la camera scende sul punto con una traiettoria ad arco
   — veloce all'inizio, in decelerazione all'arrivo — fino alla scala della città.
3. **Apertura del pin:** il pin pulsa, e da lì la foto di copertina si espande fino a
   riempire lo schermo, con nome del posto e date sopra.
4. **Griglia:** scorrendo, la copertina si ritira e compare la griglia completa. Toccando
   una foto si apre a schermo intero, con scorrimento laterale tra le altre.

**Il volo è il budget di caricamento.** Con la cifratura le foto non possono comparire
istantaneamente: vanno scaricate e decifrate, e questo costa qualche centinaio di
millisecondi. I 2,5 secondi di volo sono esattamente il tempo in cui quel lavoro avviene
in sottofondo. Senza volo si vedrebbe uno spinner; con il volo si vede un effetto
scenografico. Il costo della cifratura non viene ridotto, viene nascosto dietro qualcosa
di bello.

Se il caricamento finisce prima, il volo mantiene comunque la sua durata: la fluidità
conta più della velocità. Se dovesse tardare, l'ultimo fotogramma del volo regge fino a
quando la copertina è pronta.

**Libreria:** MapLibre GL JS, che supporta la proiezione a globo e ha `flyTo` nativo.
**Mappe:** OpenFreeMap — gratuito, senza chiave API e senza limiti di utilizzo, quindi
nessun account da registrare e nessun contatore che un giorno scade. Mapbox è stato
scartato: marginalmente più bello, ma richiede token e ha un tetto gratuito.

## Modello dati

Due tabelle in D1.

```sql
CREATE TABLE places (
  slug             TEXT PRIMARY KEY,   -- id casuale non indovinabile, in URL
  name             TEXT NOT NULL,
  lat              REAL NOT NULL,
  lon              REAL NOT NULL,
  cover_photo_id   TEXT,               -- FK photos.id, NULL finché non c'è una foto
  write_token_hash TEXT NOT NULL,      -- SHA-256 del token di scrittura
  created_at       INTEGER NOT NULL
);

CREATE TABLE photos (
  id          TEXT PRIMARY KEY,
  place_slug  TEXT NOT NULL REFERENCES places(slug) ON DELETE CASCADE,
  r2_key      TEXT NOT NULL,   -- percorso del file grande cifrato
  thumb_key   TEXT NOT NULL,   -- percorso della miniatura cifrata
  width       INTEGER NOT NULL,
  height      INTEGER NOT NULL,
  taken_at    INTEGER,         -- da EXIF, NULL se assente
  sort_index  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE INDEX idx_photos_place ON photos(place_slug, sort_index);
```

Le chiavi di cifratura non compaiono da nessuna parte nel database. Il server non le ha
mai viste e non deve poterle ricostruire.

`cover_photo_id` viene impostato automaticamente alla prima foto caricata e si cambia dal
visore a schermo pieno con "imposta come copertina". `sort_index` segue la data EXIF
crescente; le foto senza EXIF finiscono in coda nell'ordine in cui sono state caricate.

## Componenti

Ognuno con un confine netto, comprensibile e sostituibile da solo.

| Componente | Responsabilità | Dipende da |
|---|---|---|
| `crypto` | cifra/decifra blob, genera chiavi, codifica base64url | WebCrypto |
| `media` | ridimensiona, genera miniature, legge EXIF | Canvas API |
| `uploader` | coda a 4 in parallelo, avanzamento, ritenta i falliti | `crypto`, `media`, API |
| `api-client` | chiamate al Worker, gestione del token di scrittura | — |
| `map-scene` | globo, volo, pin, transizione verso la copertina | MapLibre |
| `gallery` | griglia lazy, visore a schermo pieno | `crypto`, `api-client` |
| `worker` | rotte API, validazione token, query D1, firma URL R2 | D1, R2 |

Il confine importante è che `worker` non sa nulla di cifratura e `crypto` non sa nulla
di foto: il primo maneggia byte opachi, il secondo maneggia byte e basta.

## Errori

| Situazione | Comportamento |
|---|---|
| Chiave assente o errata nell'URL | schermata "link incompleto", nessun tentativo di decifrare |
| Foto singola non decifrabile | riquadro rotto al suo posto, il resto della griglia funziona |
| Upload di una foto fallito | 3 ritentativi, poi la foto resta in coda con "riprova" |
| Rete assente durante l'upload | la coda si mette in pausa e riparte al ritorno della rete |
| Slug inesistente | 404 generica, senza rivelare se lo slug è mai esistito |
| Token di scrittura non valido | la pagina si comporta come sola lettura, senza messaggi d'errore |

## Test

**Unitari:** `crypto` (ciclo cifra→decifra, IV diversi a ogni chiamata, chiave errata
fallisce), `media` (dimensioni e orientamento EXIF), `uploader` (ritenta solo i falliti,
rispetta il limite di 4).

**Integrazione:** rotte del Worker con D1 in locale — creazione posto, upload registrato,
token non valido rifiutato.

**Manuale, da fare su un iPhone vero prima di considerarlo finito:** tocco del tag NFC
reale, caricamento di 50 foto da 4G, apertura di un posto con 200 foto su rete lenta.
Il tag NFC e Safari su iOS non si simulano in modo affidabile.

## Fuori perimetro

**I video.** Un video di 30 secondi dell'iPhone pesa 100-150 MB e comprimerlo nel browser
è lento e inaffidabile. Costerebbe più di tutto il resto del progetto. Si valuta dopo, a
sito funzionante.

**Gli originali a piena risoluzione.** Online sta solo la copia compressa. Gli originali
restano sul CasaOS di casa, dove esistono già i backup. Il ruolo dei due sistemi è
diverso e va tenuto diverso: CasaOS è l'archivio, il cloud è la vetrina. Nessuno dei due
tiene l'unica copia di qualcosa, quindi nessuno dei due è un single point of failure.
Non c'è codice da scrivere per questo: è una pratica, non una funzione.

**La modifica delle foto** (didascalie, riordino manuale, album annidati). L'ordine è per
data EXIF. Si aggiunge se emerge il bisogno.

## Note operative

**Backup del database.** Un cron settimanale del Worker esporta le due tabelle in JSON e
lo deposita su R2. Serve a sapere quale foto apparteneva a quale posto se D1 sparisse.
Non contiene chiavi.

**Dominio.** Si parte sul dominio `*.pages.dev` assegnato da Cloudflare, che funziona
subito e gratis. Un dominio proprio si può agganciare in qualsiasi momento senza toccare
il codice — ma **i tag già scritti continuerebbero a puntare al vecchio indirizzo**,
quindi se un dominio proprio lo si vuole, va comprato prima di scrivere i tag.

**Tag NFC.** NTAG215 (504 byte di memoria): un URL con slug, token e chiave sta intorno
ai 120 caratteri, quindi c'è abbondanza. Si scrivono con l'app NFC Tools. Conviene
scriverli in modalità di sola lettura una volta verificato che funzionano, così un tocco
accidentale non può sovrascriverli.

**Indicizzazione.** `noindex` su tutte le pagine e `robots.txt` che vieta tutto. Non
esiste comunque nessuna pagina che elenca gli slug, quindi non c'è niente da cui partire
per scoprirli.
