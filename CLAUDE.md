# Ricordi NFC

Magnete da frigo con tag NFC dentro. Lo tocchi col telefono, si apre un globo che vola
sul posto dove sei stato, e da lì si aprono le foto di quel viaggio. Un magnete = un
posto.

**Progetto personale, non un prodotto.** Lo usano due persone (Stefano e la sua ragazza).
Niente account, niente pagamenti, niente multi-tenant. È deliberatamente separato da
`Startup_NFC`, che è il business: qui non si portano dentro requisiti da prodotto.

## Stato al 07/08/2026

**Funziona end-to-end in locale.** Design in
`docs/superpowers/specs/2026-08-06-ricordi-nfc-design.md`, istruzioni operative in
`README.md`.

83 test verdi: 48 sulle librerie, 28 sul Worker dentro workerd vero con D1 e R2 emulati,
7 end-to-end su WebKit — che è il motore di Safari, quindi il browser che conta davvero.
Il test end-to-end carica una foto vera: canvas che ridimensiona, WebCrypto che cifra,
blob che parte, torna e viene decifrato.

I due raffinamenti (Worker unico, foto attraverso il Worker) sono stati applicati e la
spec è stata aggiornata di conseguenza.

### Cosa manca, e perché

**Le risorse Cloudflare e il deploy** — servono le credenziali di Stefano. Procedura
completa nel README: `wrangler d1 create`, `wrangler r2 bucket create`, generazione del
token master, `wrangler secret put`. Finché non è fatto, `wrangler.jsonc` ha
`PLACEHOLDER-DA-SOSTITUIRE` come `database_id` (in locale è ignorato).

**La prova su un iPhone vero** — il tocco del tag NFC e Safari su iOS non si simulano in
modo attendibile. Va provato a mano prima di considerare il progetto finito.

**Il volo sul globo non è mai stato visto girare.** WebKit headless non ha WebGL, quindi
nei test la mappa non parte e la pagina ripiega sulle sole foto (comportamento voluto,
vedi sotto). L'animazione va guardata su un dispositivo vero.

### Cose imparate costruendo, che nel design non c'erano

**Senza WebGL la mappa non emette mai `load`, e la pagina restava bianca per sempre.**
Trovato dai test end-to-end. Ora `MapScene.create()` restituisce null se il browser non
regge, `ready()` ha un tetto di 5 secondi, e le foto compaiono comunque. Regola generale
che ne discende: la mappa è la messa in scena, le foto sono il contenuto, e il contenuto
non deve mai dipendere dalla messa in scena.

**I tipi Workers e quelli del DOM non convivono.** `@cloudflare/workers-types` ridefinisce
globali che esistono anche nel browser — al punto che `element.append()` smetteva di
compilare. Da qui i due tsconfig separati: `tsconfig.json` per il browser,
`tsconfig.worker.json` per il Worker. Non riunirli.

**MapLibre pesa 285 KB gzippati**, più di tutto il resto messo insieme. Su 4G lento
compete con i 2,5 secondi di volo che dovrebbero coprire la decifratura. Se il primo
tocco risultasse lento su un telefono vero, è il primo posto dove guardare.

## Decisioni prese — non ridiscutere

Ognuna è stata discussa e chiusa. Se una va riaperta serve un motivo nuovo, non una
preferenza estetica.

**Sito, non app.** Su iPhone il tag NFC in background può aprire solo un URL. Un'app
nativa non è avviabile dal tag senza aprirla a mano, il che uccide tutto l'effetto.

**Cloudflare: Worker + D1 + R2.** R2 al posto di S3 per l'egress gratuito, che su un sito
di foto è la differenza tra zero e una bolletta. Tutto dentro i piani gratuiti con
margine ampio. Il codice non deve usare API proprietarie oltre a S3 e SQLite, così
spostarsi altrove resta un cambio di configurazione.

**Cifratura lato client, AES-GCM 256 via WebCrypto.** Su R2 arrivano blob illeggibili. La
chiave sta nell'URL dopo il `#`, che per specifica HTTP non viene mai inviato al server.
Una chiave per posto. **Questa scelta ha sostituito il self-hosting**: la privacy era
l'unico motivo per auto-ospitare, e la cifratura la ottiene senza il single point of
failure di un server di casa.

**Nessun login, da nessuna parte.** Il controllo passa da due segreti in posti diversi: il
token di scrittura nella query string del tag NFC (chi tocca il magnete carica) e la
pagina master su un indirizzo segreto (chi crea i posti). Il pulsante Condividi copia
l'URL senza token, quindi chi riceve il link solo guarda. Conseguenza accettata
consapevolmente: chiunque entri in casa e tocchi un magnete può anche cancellare foto.

**Upload dalla pagina del posto, non da CLI.** Il vincolo che ha deciso quasi tutta
l'architettura: la ragazza di Stefano deve poter caricare foto senza terminale, senza
ricordare indirizzi e senza login. Tocca il magnete, tocca "+", sceglie dalla galleria.
Uno script CLI era più semplice da costruire ed è stato scartato per questo. **È anche il
motivo per cui esiste il database**: l'elenco delle foto deve poter cambiare dal telefono
senza ricompilare il sito.

**MapLibre GL JS + OpenFreeMap.** Globo 3D e `flyTo` nativi, mappe gratuite senza chiave
API e senza limiti. Mapbox scartato: marginalmente più bello ma richiede token e ha un
tetto gratuito.

**I 2,5 secondi di volo sulla mappa sono il budget di caricamento.** Con la cifratura le
miniature vanno scaricate e decifrate prima di comparire. Il volo dura esattamente quanto
serve a farlo in sottofondo. Non è decorazione: è il modo in cui il costo della cifratura
viene nascosto dietro qualcosa di bello invece che dietro uno spinner. Chi tocca questa
parte deve saperlo.

## Fuori perimetro

**I video.** Un video iPhone da 30 secondi pesa 100-150 MB e comprimerlo nel browser è
lento e inaffidabile: costerebbe più di tutto il resto del progetto. Si rivaluta a sito
funzionante.

**Gli originali a piena risoluzione.** Online sta solo la copia compressa. Gli originali
restano sul CasaOS di casa, dove i backup esistono già. CasaOS è l'archivio, il cloud è
la vetrina: nessuno dei due tiene l'unica copia di qualcosa, quindi nessuno dei due è un
single point of failure. Non c'è codice da scrivere, è una pratica operativa.

**Didascalie, riordino manuale, album annidati.** L'ordine è per data EXIF.

## Trappole da non dimenticare

**Le chiavi perse sono perse.** Non esiste recupero. L'esportazione del portachiavi in
1Password va fatta alla creazione di ogni posto nuovo, non "quando mi ricordo". È l'unico
punto del progetto dove un errore è definitivo.

**Il dominio va deciso prima di scrivere i tag.** Si parte su `*.workers.dev`.
Agganciare un dominio proprio dopo non richiede di toccare il codice, ma i tag già
scritti continuerebbero a puntare al vecchio indirizzo — e stanno fisicamente dentro i
magneti. Se un dominio proprio lo si vuole, va comprato prima.

**I tag vanno bloccati in sola lettura** solo dopo aver verificato che funzionano. NTAG215,
504 byte, l'URL completo sta sui 120 caratteri.

**Il grosso del lavoro sta nell'upload, non nell'animazione.** Ridimensionamento sul
telefono, coda a 4 in parallelo, ritentativo della singola foto fallita, pausa e ripresa
quando la rete cade. È l'unico punto dove l'utente può frustrarsi davvero.

## Convenzioni

**Mai `Co-Authored-By: Claude` nei commit.** Vale in questo repo come in tutti gli altri.

Documenti e commenti in italiano, codice e nomi in inglese.
