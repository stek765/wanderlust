# Ricordi NFC

Tocchi un magnete sul frigo, si apre un globo che vola sul posto dove sei stato, e da lì
si aprono le foto. Poi scorri, e la mappa vola alla tappa successiva lungo la rotta.

Un magnete = una tappa, ma aprirlo mostra **tutto il viaggio** a cui appartiene,
posizionato lì.

Le foto sono cifrate nel browser prima di partire: su Cloudflare arrivano byte illeggibili.
La chiave sta nell'URL dopo il `#`, che i browser non inviano mai al server, ed è **una per
viaggio** — è quello che permette di scorrere da una tappa all'altra decifrando tutto.

Design: [`docs/superpowers/specs/2026-08-10-viaggi-design.md`](docs/superpowers/specs/2026-08-10-viaggi-design.md)
(il precedente, ancora utile per l'impianto generale, è `2026-08-06-ricordi-nfc-design.md`)
Decisioni e trappole: [`CLAUDE.md`](CLAUDE.md)

## Sviluppo in locale

Funziona tutto senza account Cloudflare: D1 e R2 vengono emulati su disco.

```bash
npm install
npm run db:local          # crea le tabelle nel database locale
npm run dev               # build del sito + Worker su http://localhost:8787
```

Serve un file `.dev.vars` con il token master di sviluppo (non è nel repo):

```
MASTER_TOKEN_HASH=fb911d9fa5ff4100174f088ba0e2ad0ee6b579e7ec895af9df113dfdce662b5e
```

È l'hash di `master-di-test`, quindi in locale la pagina master è
`http://localhost:8787/m/master-di-test`. Aprila **una volta**: da lì in poi quel browser
si ricorda il token e il menu ☰ compare in cima a ogni pagina.

```bash
npm test                  # 118 test: librerie + Worker su workerd vero
npm run test:e2e          # 17 test end-to-end (server dedicato sulla porta 8788)
npm run typecheck         # browser e Worker hanno tsconfig separati
node tools/screenshots.mjs   # dodici schermate del sito, in tools/screenshots/
node tools/misura.mjs        # quanto ci mette ad aprirsi, con la rete rallentata
```

⚠️ **I 17 test end-to-end sono attualmente tutti rossi, e non per un guasto del sito.**
Falliscono nella funzione condivisa che crea un viaggio: riempie i campi latitudine e
longitudine, che da quando la tappa si aggiunge cercando il luogo restano nascosti finché
la ricerca non fallisce. È il test rimasto indietro rispetto al modulo, e va riallineato.

`screenshots.mjs` apre il sito con foto finte in tre proporzioni e fotografa ogni
schermata, su telefono e su desktop. Serve perché i difetti visivi non si vedono leggendo
il CSS. Cancella e ricrea i viaggi del database **delle prove**.

`misura.mjs` misura due tempi sulla prima apertura — il primo pixel e il momento in cui la
pagina diventa usabile — con la rete a 4G scarso e il processore rallentato quattro volte.
Serve per non discutere di prestazioni a sensazione.

## Cosa serve fare a te, una volta sola

Queste sono le uniche cose che il codice non può fare da solo.

### 1. Creare le risorse Cloudflare

```bash
npx wrangler login
npx wrangler d1 create ricordi
npx wrangler r2 bucket create ricordi-media
```

Il primo comando stampa un `database_id`: incollalo in `wrangler.jsonc` al posto di
`PLACEHOLDER-DA-SOSTITUIRE`.

### 2. Generare il token master

```bash
node -e "const t=require('crypto').randomBytes(32).toString('base64url'); \
console.log('TOKEN (in 1Password):', t); \
console.log('HASH  (nel Worker) :', require('crypto').createHash('sha256').update(t).digest('hex'))"
```

Il **token** va in 1Password: è l'indirizzo `/m/<token>` da cui entri la prima volta.
L'**hash** va nel Worker:

```bash
npx wrangler secret put MASTER_TOKEN_HASH
```

### 3. Decidere il dominio — prima di scrivere i tag

Si parte su `ricordi-nfc.<tuo-account>.workers.dev`, che funziona subito e gratis.

Un dominio tuo si aggancia in qualsiasi momento senza toccare il codice, **ma i tag già
scritti continuerebbero a puntare al vecchio indirizzo** — e stanno dentro i magneti. Se
un dominio proprio lo vuoi, compralo adesso.

### 4. Primo deploy

```bash
npm run db:remote         # applica le tabelle al database vero
npm run deploy
```

### 5. Creare un viaggio e scrivere i tag

Vai su `/m/<token-master>` una volta sola, poi usa il ☰.

1. **+ Nuovo viaggio** — chiede solo il nome. Qui nasce la chiave di cifratura, nel
   browser. Nessun indirizzo da scrivere: un viaggio senza tappe non ha magneti.
2. **Aggiungi la tappa** dentro il viaggio — nome e città (le coordinate le trova da solo).
   Alla fine compare l'indirizzo da scrivere sul tag.
3. Scrivilo su un tag NTAG215 con l'app **NFC Tools**. L'URL sta sui 120 caratteri, il
   tag ne regge 504.

Blocca il tag in sola lettura **solo dopo** aver verificato che funziona: è irreversibile.

### 6. Esportare le chiavi — ogni volta che crei un VIAGGIO

Nel ☰, pulsante **Esporta le chiavi** → il file JSON va in 1Password.

Aggiungere una tappa non produce chiavi nuove: la chiave è del viaggio. È quando nasce un
viaggio che l'esportazione va rifatta.

Non è un consiglio. Se perdi una chiave, quelle foto non le riapre più nessuno: non c'è
recupero, non c'è assistenza, non c'è scorciatoia. La pagina te lo ricorda finché non lo fai.

## Come funziona un URL

```
https://sito/p/<tappa>?w=<token>#<chiave>
               ^^^^^^^  ^^^^^^^^  ^^^^^^^
               |        |         del viaggio, mai inviata al server (è il frammento)
               |        del viaggio: permette di caricare e cancellare
               identifica la tappa — e da lei il server risale al viaggio
```

Il tag NFC contiene tutto. Il pulsante **Condividi il viaggio** copia lo stesso URL
**senza** il token: chi riceve il link guarda, chi tocca il magnete carica.

Siccome la chiave è del viaggio, condividere condivide il viaggio intero. L'interfaccia lo
dice, invece di far credere il contrario.

## Struttura

```
worker/           API, media e sito statico — un solo Worker, zero CORS
  index.ts        rotte
  db.ts           tutte le query D1, nessun SQL altrove
  auth.ts         confronto token a tempo costante
src/lib/          crypto · media · uploader · session · keychain · photo-store · tinta
                  geo (l'arco delle rotte) · geocode (da un nome a delle coordinate)
src/scenes/       map-scene (la mappa e i suoi spostamenti) · stop-deck (il carosello)
                  gallery-view · gallery · viewer · upload-panel
                  menu · menu-panel (l'indice) · master-forms · encrypted-thumb · widgets
src/pages/        trip (la pagina del viaggio) · master (la porta d'ingresso)
shared/           i tipi dell'API, importati da entrambi i lati
tools/            screenshots.mjs (guardare il sito) · misura.mjs (cronometrarlo)
```

Il database ha tre tabelle: `trips` → `stops` → `photos`. Chiave di cifratura e token di
scrittura stanno sul viaggio.

## Una nota sul volo di 3,8 secondi

Non è decorazione. Le foto sono cifrate: prima di comparire vanno scaricate e decifrate, e
quel lavoro costa. Il volo d'arrivo dura esattamente quanto serve a farlo in sottofondo.

Togliere l'animazione non renderebbe la pagina più veloce: farebbe comparire uno spinner
al posto di un globo che scende su Bangkok.

I voli fra una tappa e l'altra sono un'altra cosa: 1,2 secondi, perché lì non c'è niente da
nascondere — accompagnano lo scorrimento, non lo coprono.
