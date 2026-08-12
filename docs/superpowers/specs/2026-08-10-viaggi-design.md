# Viaggi, rotte e scorrimento continuo — Design

**Data:** 2026-08-10
**Stato:** implementato
**Sostituisce parti di:** `2026-08-06-ricordi-nfc-design.md`

## Cosa cambia, in una frase

I posti smettono di essere isole. Nasce il **viaggio**: un contenitore di tappe che si
percorrono scorrendo un'unica pagina, con la mappa che vola da una all'altra lungo una
rotta tratteggiata.

Il design del 6 agosto diceva: «Un magnete corrisponde a un posto e a un solo posto. I
posti sono indipendenti: non esiste una pagina che li elenca tutti, non esiste un percorso
per passare da un posto all'altro.» Quella frase è superata da questo documento. Il
magnete continua a corrispondere a una tappa sola — è il *punto di ingresso* che cambia
significato: apre il viaggio, posizionato su quella tappa.

## Cosa ha spinto il cambiamento

Un video di riferimento (`collectedbykayla`, "POV: now all your fridge magnets can tell
the story from the trip") mostra la stessa idea portata avanti di un passo: mappa scura
fissa in alto, tappe collegate da tratteggi curvi, e uno scorrimento continuo in cui la
barra della tappa cambia e la mappa vola da sola. La differenza rispetto a oggi non è
estetica: è che il viaggio si racconta come una sequenza, non come una cartella.

Serve anche un modo di creare i posti che non passi dal toccare un magnete. Oggi l'unica
porta è l'indirizzo segreto `/m/<token>`, che va ricordato o tenuto nei preferiti.

## Il vincolo che ha deciso tutto: le chiavi

Ogni posto ha oggi la propria chiave di cifratura, e quella chiave esiste in un solo
posto: il frammento dell'URL, dopo il `#`. Il server non la conosce e non deve conoscerla.

Da qui il problema. Chi tocca il magnete di Chiang Mai riceve la chiave di Chiang Mai e
nient'altro. Scorrendo fino a Bangkok il browser troverebbe blob che non può aprire.

Le strade erano tre: una chiave per viaggio; una chiave sola per tutto il sito; oppure
nessun raggruppamento, appoggiandosi al portachiavi in `localStorage` dei nostri due
telefoni.

**Scelta: una chiave per viaggio.** La seconda dà a chiunque riceva un link tutte le foto
di sempre, e le rotte collegherebbero Budoni a Bangkok, che non vuol dire niente. La terza
fa comportare la stessa pagina in modi diversi a seconda del telefono, che è la peggiore
delle tre proprietà. La prima invece fa combaciare il confine della cifratura con il
confine narrativo: un viaggio è quello che condividi, quello che si scorre e quello che si
decifra, e sono lo stesso insieme.

## Struttura

```
viaggio  "Thailandia"        chiave di cifratura + token di scrittura
   ├── tappa  Bangkok        lat/lon, un magnete
   │     └── foto…
   ├── tappa  Chiang Mai     lat/lon, un magnete
   │     └── foto…
   └── tappa  Phuket
         └── foto…
```

**La chiave e il token salgono di un livello.** Oggi appartengono alla tappa, domani al
viaggio. Conseguenza accettata: tutti i magneti di un viaggio portano la stessa chiave e
lo stesso token, quindi chi tocca Chiang Mai può caricare foto anche su Bangkok. Per due
persone in casa è il comportamento desiderato, e senza di esso lo scorrimento continuo non
è costruibile.

### Database

Nomi in inglese, come tutto il codice. `places` diventa `stops`, e sopra nasce `trips`.

```sql
CREATE TABLE trips (
  slug             TEXT PRIMARY KEY,   -- id casuale, compare solo nelle API
  name             TEXT NOT NULL,
  write_token_hash TEXT NOT NULL,      -- SHA-256 del token di scrittura del viaggio
  created_at       INTEGER NOT NULL
);

CREATE TABLE stops (
  slug       TEXT PRIMARY KEY,         -- id casuale, compare nell'URL del tag
  trip_slug  TEXT NOT NULL REFERENCES trips(slug) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  lat        REAL NOT NULL,
  lon        REAL NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE photos (
  id         TEXT PRIMARY KEY,
  stop_slug  TEXT NOT NULL REFERENCES stops(slug) ON DELETE CASCADE,
  r2_key     TEXT NOT NULL,
  thumb_key  TEXT NOT NULL,
  width      INTEGER NOT NULL,
  height     INTEGER NOT NULL,
  taken_at   INTEGER,
  sort_index INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_stops_trip  ON stops(trip_slug, created_at);
CREATE INDEX idx_photos_stop ON photos(stop_slug, sort_index);
```

**`cover_photo_id` e `PATCH /cover` spariscono.** Il CLAUDE.md aveva scritto che se
restavano inutilizzate a lungo andavano tolte, e questa è la ristrutturazione in cui
toglierle costa zero.

**Il token di scrittura non è più su `stops`.** Sta su `trips`, ed è l'unico posto in cui
il Worker lo cerca.

### Ordine delle tappe

Cronologico e automatico: per data della foto più vecchia della tappa. Una tappa ancora
senza foto va in fondo, in ordine di creazione. Il calcolo è del Worker, non del browser,
perché è lui che ha le date.

Nessun riordino a mano. È già fuori perimetro nel progetto, e soprattutto le rotte devono
seguire il tempo: una linea che collega le tappe in un ordine deciso a mano racconta una
bugia.

### URL

La forma non cambia. Cambia cosa c'è dentro:

```
https://sito/p/<slug-tappa>?w=<token-VIAGGIO>#<chiave-VIAGGIO>
```

Resta sui 120 caratteri, quindi i NTAG215 da 504 byte vanno bene come prima, e il vincolo
del dominio da decidere prima di scrivere i tag vale identico.

**Condividere condivide il viaggio, non la tappa.** Non è una scelta di prodotto: la
chiave è del viaggio, quindi chi riceve il link apre comunque tutto. L'interfaccia deve
dirlo, invece di far credere il contrario.

### API

| Metodo | Rotta | Autorizzazione | Cosa fa |
|---|---|---|---|
| `GET` | `/api/stops/:slug` | nessuna | il viaggio intero + la tappa messa a fuoco |
| `POST` | `/api/trips` | master | crea un viaggio, restituisce slug e token di scrittura |
| `GET` | `/api/trips` | master | elenco viaggi e tappe, per il menu |
| `POST` | `/api/trips/:slug/stops` | master | aggiunge una tappa |
| `POST` | `/api/stops/:slug/media` | token del viaggio | carica un blob cifrato su R2 |
| `POST` | `/api/stops/:slug/photos` | token del viaggio | registra la foto |
| `DELETE` | `/api/stops/:slug/photos/:id` | token del viaggio | cancella |
| `GET` | `/media/*` | nessuna | serve il blob cifrato |
| `GET` | `/api/backup` | master | invariato, adeguato alle nuove tabelle |

`GET /api/stops/:slug` restituisce il viaggio completo con tutte le tappe e tutte le foto,
più `focusStop`. Sono solo metadati — nessuna immagine — quindi anche un viaggio da otto
tappe resta una risposta piccola, e serve tutta insieme perché la rotta va disegnata per
intero fin dal primo istante.

Il token di scrittura viene verificato risalendo dalla tappa al viaggio. La creazione di
una tappa richiede il token master perché produce un nuovo magnete, e i magneti li fa solo
chi ha in mano il portachiavi.

## La pagina

### L'arrivo

Invariato nella sostanza, ed è la parte che funziona già: mappa a schermo pieno, volo di
`FLIGHT_MS` (3800 ms) sulla tappa toccata, miniature scaricate e decifrate durante il
volo. Quei 3,8 secondi restano il budget di caricamento, non decorazione.

Cambia il titolo, perché ora la tappa ha un contesto:

```
THAILANDIA            occhiello, piccolo
Chiang Mai            il titolo grande di oggi
15–18 apr · 22 foto
```

**Durante il volo lo scorrimento è bloccato.** Il sipario è una scena, non una pagina, e
non deve poter essere scavalcato a metà.

### Il primo gesto

Un solo gesto fa tre cose insieme:

1. il sipario svanisce
2. la mappa si ritira dallo schermo pieno alla fascia in alto (42vh)
3. il documento compare, già posizionato sulla sezione della tappa toccata, e lo
   scorrimento si sblocca

Il sipario è un sovrapposto in `position: fixed`: non partecipa al layout, quindi quando
sparisce non sposta niente e non serve inseguire la posizione di scorrimento. Il documento
sotto è, e resta, l'elenco delle tappe in ordine cronologico.

Dopo la ritirata va chiamata `map.resize()`: MapLibre non si accorge da solo che il suo
contenitore ha cambiato altezza.

### Il regime di scorrimento

```
┌────────────────────┐
│ ☰   mappa  ·-·-·   │  fascia fissa, 42vh, sopra al contenuto
│        ◉ Bangkok   │
├────────────────────┤
│ Bangkok  13-15 apr │  barra della tappa, appiccicata a top: 42vh
├────────────────────┤
│ ┌─────┐┌─────┐     │
│ │foto ││foto │     │  le foto scorrono sotto la fascia
│ └─────┘└─────┘     │
└────────────────────┘
```

La fascia sta sopra il contenuto e il contenuto le scorre sotto. L'elenco delle tappe ha
quindi 42vh di spazio in cima, altrimenti la prima riga di foto nascerebbe già coperta.

Il viaggio c'è tutto: si scorre in giù verso le tappe successive e in su verso quelle
precedenti, anche se il magnete toccato stava in mezzo.

### Le rotte

Una linea tratteggiata collega le tappe nell'ordine cronologico. Non un segmento dritto:
l'arco va interpolato sulla sfera con una sessantina di punti per tratta, altrimenti a
zoom largo la congiungente in coordinate proiettate taglia dritta e sembra un errore di
disegno invece che una rotta.

Il calcolo dell'arco (interpolazione sferica fra due coppie lat/lon) vive in una funzione
pura nelle librerie, testabile senza mappa e senza browser. La mappa riceve solo il
GeoJSON già pronto.

Stile: un unico `LineString` per viaggio, `line-dasharray`, colore `--rotta`. Tutte le
tratte uguali — evidenziare quella "attiva" è un'idea che si può aggiungere dopo, e per
ora non serve a niente.

### Il volo comandato dallo scorrimento

Un `IntersectionObserver` osserva le sezioni delle tappe; la tappa attiva è quella che
occupa il centro dell'area visibile sotto la fascia. Quando cambia, la mappa vola.

Volo corto, circa 1200 ms, molto più asciutto di quello d'arrivo: quello è un sipario,
questo è un accompagnamento. `flyTo` allarga e richiude lo zoom da sé, che è esattamente
il movimento del video.

**Se scorri veloce e attraversi tre tappe non si accodano tre voli.** Vince l'ultima
tappa: un volo in corso viene ridiretto, non messo in fila. Senza questa regola una
scorsa lunga produce una sequenza di voli che continua per svariati secondi dopo che le
dita si sono fermate.

### Il caricamento delle foto

Stesso principio di oggi, esteso.

- le miniature della tappa d'arrivo si decifrano durante il sipario (le prime 12, come
  adesso)
- le miniature delle altre tappe si decifrano quando la loro sezione arriva a circa uno
  schermo di distanza
- una tappa mai raggiunta non costa niente

Un viaggio da otto tappe non deve pesare più di uno da una, finché lo si guarda dall'alto.

### Caricare foto

Il `+` sta dentro ogni tappa, in fondo alle sue foto: si carica dove si sta guardando,
senza scegliere niente da un elenco. Il pannello di caricamento esistente (coda a 4,
ritentativi, ridimensionamento, conversione HEIC) non cambia — cambia solo a quale tappa
si rivolge.

### Senza WebGL

Nessuna fascia, nessun volo, nessuna rotta: restano le barre delle tappe e le foto, in
ordine. La regola generale già stabilita vale identica — la mappa è la messa in scena, le
foto sono il contenuto, e il contenuto non dipende mai dalla messa in scena.

## Il menu

In alto a sinistra, sopra la mappa. **Compare solo se quel browser conosce il token
master.**

Da chiarire, perché in fase di discussione era stato confuso: questo non è un controllo
di sicurezza. La sicurezza sta dove è sempre stata, cioè nel Worker, che rifiuta la
creazione senza token master. La visibilità del `☰` è una questione di ingombro: a chi
riceve un link condiviso il pulsante "nuovo viaggio" non serve, e mostrarglielo sarebbe
solo rumore.

Contenuto:

- l'elenco dei viaggi, ognuno apribile sulle sue tappe, con link diretti — è anche il modo
  più veloce per aprire un posto da computer senza cercare il magnete
- **+ Nuovo viaggio**: chiede il nome, la chiave nasce nel browser, il viaggio esiste.
  Nessun indirizzo da scrivere: un viaggio senza tappe non ha magneti
- **+ Nuova tappa** dentro un viaggio: nome e ricerca della città (il geocoding con
  Nominatim esiste già). Alla fine restituisce **l'indirizzo da scrivere sul tag**
- il promemoria di esportare le chiavi, che resta la cosa più importante della pagina

`/m/<token>` non sparisce: diventa la porta che salva il token su quel browser e mostra lo
stesso pannello a schermo pieno. Una implementazione sola, due modi di arrivarci.

## Il colore

Il magenta lascia il posto a un blu-ottanio. Il valore chiesto è `#2596be`, che va bene
per l'interfaccia ma non per il pin: su Dark Matter è troppo spento e si confonde con il
grigio dell'acqua — che è esattamente il motivo per cui a suo tempo era stato scelto il
magenta. Stesso colore, tre luminosità.

| Variabile | Valore | Dove |
|---|---|---|
| `--accento` | `#2596be` | pulsanti, link, "+ Aggiungi foto" |
| `--pin` | `#4fc4e0` | il pin, con l'anello bianco già presente |
| `--rotta` | `#7fd8ec` al 45% | il tratteggio fra le tappe |

Il filo sotto il titolo passa da magenta a una sfumatura di `--accento`. Il rosso
(`--pericolo`) resta dov'è: il pulsante che cancella una foto.

## Migrazione

Una nuova migrazione ricostruisce le tabelle da zero. Niente è mai stato deployato e
l'unico dato esistente è la Sardegna con 4 foto sul database locale: si perde e si
ricarica in un minuto, che costa meno di una conversione scritta per un solo record di
prova.

## Test

I test esistenti restano verdi dove ancora hanno senso, e vanno adeguati dove i nomi delle
tabelle e delle rotte sono cambiati. In più:

**Librerie**

- ordinamento cronologico delle tappe, comprese quelle senza foto
- interpolazione dell'arco sferico: gli estremi combaciano, il numero di punti è quello
  atteso, l'attraversamento dell'antimeridiano non produce una linea che gira intorno al
  mondo

**Worker (in workerd, con D1 e R2 emulati)**

- creazione di viaggio e tappa con e senza token master
- scrittura di foto autorizzata dal token del viaggio, risalendo dalla tappa
- `GET /api/stops/:slug` restituisce il viaggio intero e indica la tappa a fuoco
- cancellazione in cascata: cancellare un viaggio porta via tappe e foto

**End-to-end**

- scorro dalla prima tappa alla seconda: le foto della seconda vengono decifrate e
  compaiono
- il `☰` non compare senza token master, compare dopo il passaggio da `/m/<token>`
- le due regressioni CSS esistenti restano (il `display` che batteva `hidden`, e
  `animation-fill-mode: both` che teneva vivo l'invito a scorrere)
- una terza regressione della stessa famiglia: dopo la ritirata della mappa, il sipario
  deve essere davvero sparito e non intercettare più i tocchi

## Cosa resta fuori

Tutto quello che era fuori perimetro lo è ancora: video, originali a piena risoluzione,
didascalie, album annidati. In più:

- **riordino manuale delle tappe** — l'ordine è il tempo
- **spostare una tappa da un viaggio all'altro** — cambierebbe la chiave con cui le sue
  foto sono cifrate, quindi non è un aggiornamento di database ma una ricifratura di
  tutto. Se servirà davvero, si cancella e si ricarica
- **evidenziare la tratta percorsa** rispetto alle altre — decorazione, si valuta dopo
