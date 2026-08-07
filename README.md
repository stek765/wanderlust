# Ricordi NFC

Tocchi un magnete sul frigo, si apre un globo che vola sul posto dove sei stato, e da lì
si aprono le foto di quel viaggio. Un magnete = un posto.

Le foto sono cifrate nel browser prima di partire: su Cloudflare arrivano byte illeggibili.
La chiave sta nell'URL dopo il `#`, che i browser non inviano mai al server.

Design completo: [`docs/superpowers/specs/2026-08-06-ricordi-nfc-design.md`](docs/superpowers/specs/2026-08-06-ricordi-nfc-design.md)
Decisioni e trappole: [`CLAUDE.md`](CLAUDE.md)

## Sviluppo in locale

Funziona tutto senza account Cloudflare: D1 e R2 vengono emulati su disco.

```bash
npm install
npm run db:local          # crea le tabelle nel database locale
npm run dev               # build del sito + Worker su http://localhost:8788
```

Serve un file `.dev.vars` con il token master di sviluppo (non è nel repo):

```
MASTER_TOKEN_HASH=fb911d9fa5ff4100174f088ba0e2ad0ee6b579e7ec895af9df113dfdce662b5e
```

È l'hash di `master-di-test`, quindi in locale la pagina master è
`http://localhost:8788/m/master-di-test`.

```bash
npm test                  # 76 test: librerie + Worker su workerd vero
npm run typecheck         # browser e Worker hanno tsconfig separati
```

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

Il **token** va in 1Password: è l'indirizzo `/m/<token>` da cui crei i posti.
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

### 5. Scrivere i tag

Vai su `/m/<token-master>`, crea un posto, copia l'indirizzo che compare e scrivilo su un
tag NTAG215 con l'app **NFC Tools**. L'URL sta sui 120 caratteri, il tag ne regge 504.

Blocca il tag in sola lettura **solo dopo** aver verificato che funziona: è irreversibile.

### 6. Esportare le chiavi — ogni volta che crei un posto

Sulla pagina master, pulsante **Esporta le chiavi** → il file JSON va in 1Password.

Non è un consiglio. Se perdi una chiave, quelle foto non le riapre più nessuno: non c'è
recupero, non c'è assistenza, non c'è scorciatoia. La pagina te lo ricorda finché non lo fai.

## Come funziona un URL

```
https://sito/p/<slug>?w=<token>#<chiave>
               ^^^^^^  ^^^^^^^^  ^^^^^^^
               |       |         mai inviata al server (è il frammento)
               |       permette di caricare e cancellare
               identifica il posto
```

Il tag NFC contiene tutto. Il pulsante **Condividi** copia lo stesso URL **senza** il
token: chi riceve il link guarda, chi tocca il magnete carica.

## Struttura

```
worker/           API, media e sito statico — un solo Worker, zero CORS
  index.ts        rotte
  db.ts           tutte le query D1, nessun SQL altrove
  auth.ts         confronto token a tempo costante
src/lib/          crypto · media · uploader · session · keychain · photo-store
src/scenes/       map-scene (il volo) · gallery · viewer · upload-panel
src/pages/        place · master
shared/           i tipi dell'API, importati da entrambi i lati
```

## Una nota sul volo di 2,5 secondi

Non è decorazione. Le foto sono cifrate: prima di comparire vanno scaricate e decifrate, e
quel lavoro costa. Il volo dura esattamente quanto serve a farlo in sottofondo.

Togliere l'animazione non renderebbe la pagina più veloce: farebbe comparire uno spinner
al posto di un globo che scende su Bangkok.
