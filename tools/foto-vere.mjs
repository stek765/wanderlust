/**
 * Foto vere per la dimostrazione del README, scaricate con licenza libera.
 *
 * La prima versione di questo strumento disegnava i posti in SVG — cieli in sfumatura,
 * creste di montagna, palme e torii in sagoma. Funzionava, ma una GIF che deve far capire
 * a cosa serve un magnete sul frigo mostrava illustrazioni, e quello che ci finisce dentro
 * davvero sono le foto delle vacanze di due persone.
 *
 * ⚠️ **Solo CC0 e pubblico dominio.** Questa roba finisce in un README pubblico: una foto
 * "trovata su internet" ci starebbe senza il diritto di starci. Openverse permette di
 * filtrare le licenze all'origine, e qui si chiedono solo quelle che non impongono
 * condizioni. I crediti vengono scritti lo stesso in `CREDITI.md` accanto alle immagini —
 * non è obbligatorio con queste licenze, ma sapere da dove viene un file costa una riga.
 *
 * La data di scatto viene riscritta nell'EXIF, e non è un vezzo: l'ordine delle tappe di
 * un viaggio è la data della loro foto più vecchia, e queste foto arrivano con le date di
 * chi le ha scattate davvero — che manderebbero il viaggio in ordine sparso. Le date del
 * viaggio inventato sono inventate anche loro.
 *
 * Uso:
 *   node tools/foto-vere.mjs        (le immagini finiscono in tools/foto-vere/)
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const OUT = new URL('./foto-vere/', import.meta.url).pathname;
const AGENTE = 'ricordi-nfc-demo/1.0 (progetto personale, github.com/stek765)';

/** Lato lungo a cui si ridimensiona. Il sito le riduce comunque a 1600 caricandole. */
const LATO_MASSIMO = 1600;

/*
 * Quello che si scarta guardando solo i metadati, prima di spendere una richiesta.
 *
 * Openverse risponde a "Hakone" anche con un vaso del periodo Nanbokucho conservato in un
 * museo: è indicizzato con quel nome e non è sbagliato, semplicemente non è una foto di
 * vacanza. Stessa cosa per gli striscioni di Wikivoyage, che sono immagini 2100×300 fatte
 * per stare in cima a una pagina.
 */
const PROPORZIONE_MINIMA = 0.6;
const PROPORZIONE_MASSIMA = 1.8;
/*
 * Il minimo si misura sul lato LUNGO, e la prima versione lo misurava sul corto.
 *
 * Sembra un dettaglio e ha azzerato una tappa intera: Openverse serve moltissime immagini
 * a 1024 sul lato lungo, che in verticale fanno 683 sul corto. Con la soglia sul lato
 * corto, "Kanazawa" restituiva cinquantasette risultati e ne sopravvivevano zero.
 */
const LATO_MINIMO = 1000;
const TITOLI_DA_SALTARE = new RegExp(
  [
    // impaginazione e simboli, non luoghi
    'banner', '\\bmap\\b', 'mappa', 'flag', 'coat of arms', 'logo', 'diagram', 'chart',
    'poster', 'plan of', 'scheme',
    // oggetti da museo
    'stamp', 'coin', '\\bware\\b', 'vase', '\\bjar\\b', 'museum', 'manuscript',
    // stampe e dipinti: pubblico dominio per età, non foto di vacanza
    'ukiyo', 'woodblock', 'hokusai', 'hiroshige', 'engraving', 'etching', 'lithograph',
    'painting', 'drawing', 'illustration',
    // i titoli olandesi del Rijksmuseum, che di vedute giapponesi ne ha moltissime
    'gezicht', 'prent', 'schilderij', 'tekening',
    // raccolte digitalizzate di biblioteche
    'デジタルコレクション', '国立国会図書館',
  ].join('|'),
  'i',
);

/**
 * Sotto questa saturazione media la foto è in bianco e nero, e non è un ricordo di
 * vacanza: è materiale d'archivio.
 *
 * Openverse ha moltissime foto storiche pubblicate in pubblico dominio proprio perché
 * vecchie — la prima versione di questa GIF conteneva una Hiroshima del primo Novecento
 * con i tram e un vicolo di Kyoto in bianco e nero. Sono belle e sono libere, e in un
 * album di viaggio del 2027 stonano.
 *
 * Bassa apposta, e la prima taratura era già troppo alta: a 0,08 sono finite nello scarto
 * due fotografie a colori del lago Ashi nella nebbia, che misuravano 0,067 e 0,070. Una
 * giornata grigia è grigia davvero. Qui si scarta solo quello che di colore non ne ha
 * proprio.
 */
const COLORE_MINIMO = 0.04;

/* ------------------------------------------------------------------ *
 * La data di scatto, scritta nell'EXIF a mano
 *
 * Nessuna dipendenza fa solo questo, e installarne una per due campi di testo sarebbe
 * sproporzionato: un blocco EXIF con DateTimeOriginal e DateTimeDigitized sono novantasei
 * byte con una struttura fissa. Il blocco va infilato subito dopo il marcatore d'inizio
 * immagine, che è dove ogni lettore lo cerca per primo.
 * ------------------------------------------------------------------ */

function exifData(data) {
  const p = (n) => String(n).padStart(2, '0');
  const testo =
    `${data.getFullYear()}:${p(data.getMonth() + 1)}:${p(data.getDate())} ` +
    `${p(data.getHours())}:${p(data.getMinutes())}:${p(data.getSeconds())}\0`;

  const tiff = Buffer.alloc(96);
  tiff.write('II', 0, 'ascii'); // ordine dei byte: little endian
  tiff.writeUInt16LE(42, 2); // il numero magico del TIFF
  tiff.writeUInt32LE(8, 4); // dove comincia la prima directory

  // Directory 0: una voce sola, il puntatore alla directory Exif.
  tiff.writeUInt16LE(1, 8);
  tiff.writeUInt16LE(0x8769, 10); // ExifIFDPointer
  tiff.writeUInt16LE(4, 12); // tipo LONG
  tiff.writeUInt32LE(1, 14);
  tiff.writeUInt32LE(26, 18);
  tiff.writeUInt32LE(0, 22); // nessuna directory dopo questa

  // Directory Exif: le due date, col testo parcheggiato in fondo al blocco.
  tiff.writeUInt16LE(2, 26);
  tiff.writeUInt16LE(0x9003, 28); // DateTimeOriginal
  tiff.writeUInt16LE(2, 30); // tipo ASCII
  tiff.writeUInt32LE(20, 32);
  tiff.writeUInt32LE(56, 36);
  tiff.writeUInt16LE(0x9004, 40); // DateTimeDigitized
  tiff.writeUInt16LE(2, 42);
  tiff.writeUInt32LE(20, 44);
  tiff.writeUInt32LE(76, 48);
  tiff.writeUInt32LE(0, 52);

  tiff.write(testo, 56, 'ascii');
  tiff.write(testo, 76, 'ascii');

  const app1 = Buffer.alloc(10);
  app1.writeUInt16BE(0xffe1, 0);
  app1.writeUInt16BE(2 + 6 + tiff.length, 2); // la lunghezza si conta da sé stessa in poi
  app1.write('Exif\0\0', 4, 'binary');

  return Buffer.concat([app1, tiff]);
}

function conDataDiScatto(jpeg, data) {
  if (jpeg.readUInt16BE(0) !== 0xffd8) throw new Error('non è un JPEG');
  return Buffer.concat([jpeg.subarray(0, 2), exifData(data), jpeg.subarray(2)]);
}

/* ------------------------------------------------------------------ *
 * Openverse
 * ------------------------------------------------------------------ */

async function cerca(query) {
  const url =
    'https://api.openverse.org/v1/images/?' +
    new URLSearchParams({
      q: query,
      license: 'cc0,pdm',
      // Venti è il massimo concesso senza chiave: chiedendone di più Openverse risponde
      // 401, che sembra un problema di autenticazione e invece è un limite di pagina.
      page_size: '20',
      mature: 'false',
      extension: 'jpg',
      /*
       * Solo archivi di fotografie.
       *
       * Il pubblico dominio è pieno di stampe ukiyo-e e di vedute ottocentesche del
       * Rijksmuseum: sono libere perché hanno due secoli, e cercando "Hakone" o "Mount
       * Fuji" arrivano prima delle foto. Una versione di questa GIF ne conteneva tre di
       * seguito e sembrava un catalogo d'asta invece di un album di viaggio.
       *
       * ⚠️ Il filtro `category=photograph` sarebbe la strada diretta e **non si può
       * usare**: combinato con una ricerca di più parole azzera i risultati — "Lake Ashi
       * Hakone" passa da 10 a 0 — e nella risposta il campo `category` torna vuoto,
       * quindi non si può nemmeno filtrare a valle. Restringere la fonte ottiene la
       * stessa cosa senza svuotare la ricerca.
       */
      source: 'flickr,wikimedia',
    });

  const risposta = await fetch(url, { headers: { 'User-Agent': AGENTE } });
  if (!risposta.ok) throw new Error(`Openverse ha risposto ${risposta.status} per "${query}"`);

  const { results = [] } = await risposta.json();
  return results.filter((r) => {
    if (!r.url || !r.width || !r.height) return false;
    if (Math.max(r.width, r.height) < LATO_MINIMO) return false;
    const proporzione = r.width / r.height;
    if (proporzione < PROPORZIONE_MINIMA || proporzione > PROPORZIONE_MASSIMA) return false;
    return !TITOLI_DA_SALTARE.test(r.title ?? '');
  });
}

/**
 * Ridimensiona e riscrive la data. Il ridimensionamento passa da ffmpeg, che è già
 * richiesto per fare la GIF: una dipendenza in più per riquadrare un JPEG non serve.
 */
function prepara(originale, destinazione, quando) {
  const scala =
    `scale='if(gt(iw,ih),min(${LATO_MASSIMO},iw),-2)':'if(gt(iw,ih),-2,min(${LATO_MASSIMO},ih))'`;

  const ridotto = execFileSync(
    'ffmpeg',
    ['-y', '-loglevel', 'error', '-i', originale, '-vf', scala, '-q:v', '4', '-f', 'mjpeg', 'pipe:1'],
    { maxBuffer: 64 * 1024 * 1024 },
  );

  const piccola = miniatura(originale);
  const colore = quantoColore(piccola);
  if (colore < COLORE_MINIMO) throw new Error(`in bianco e nero (colore ${colore.toFixed(3)})`);

  // L'EXIF si riscrive DOPO ffmpeg: rifacendo il JPEG lo butta via insieme al resto.
  writeFileSync(destinazione, conDataDiScatto(ridotto, quando));
  return { impronta: createHash('sha256').update(ridotto).digest('hex'), piccola };
}

/** Trentadue per trentadue in RGB crudo: mille pixel su cui è comodo fare i conti. */
function miniatura(file) {
  return execFileSync(
    'ffmpeg',
    ['-v', 'error', '-i', file, '-vf', 'scale=32:32', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'],
    { maxBuffer: 1024 * 1024 },
  );
}

/**
 * Quanto colore c'è, in media, da 0 a 1. Si legge dalla miniatura invece che dalle
 * statistiche di ffmpeg, che andrebbero estratte dal suo registro: mille pixel bastano, e
 * il conto non dipende da come ffmpeg formatta i messaggi.
 */
function quantoColore(pixel) {
  let somma = 0;
  for (let i = 0; i + 2 < pixel.length; i += 3) {
    const alto = Math.max(pixel[i], pixel[i + 1], pixel[i + 2]);
    const basso = Math.min(pixel[i], pixel[i + 1], pixel[i + 2]);
    if (alto > 0) somma += (alto - basso) / alto;
  }
  return somma / (pixel.length / 3);
}

/**
 * Quanto due foto si somigliano, guardandole piccole: differenza media per canale, da 0
 * (identiche) a 255.
 *
 * L'impronta dei byte non basta e il motivo si è visto nella griglia: la stessa
 * fotografia del lago Ashi è indicizzata due volte, una da Flickr e una da Wikimedia, con
 * ritagli e compressioni appena diversi. Byte diversi, titoli diversi, stessa immagine —
 * e nella prima riga compariva due volte.
 */
const SOMIGLIANZA_MASSIMA = 8;

function differenza(a, b) {
  if (a.length !== b.length) return 255;
  let somma = 0;
  for (let i = 0; i < a.length; i++) somma += Math.abs(a[i] - b[i]);
  return somma / a.length;
}

/* ------------------------------------------------------------------ *
 * Il lavoro
 * ------------------------------------------------------------------ */

/**
 * Scarica `quante` foto per ogni posto richiesto, ridimensionate e datate.
 *
 * `richieste` è un elenco di `{ posto, cerca: [...], quante, giorno }`. Le chiavi di
 * ricerca sono più d'una per posto perché una sola dà sei varianti della stessa
 * inquadratura, e in una griglia si vede subito.
 *
 * Quello che è già sul disco non si riscarica: si ripete la ripresa dieci volte mentre si
 * aggiustano i tempi, e non ha senso ribussare a Openverse ogni volta.
 */
export async function scaricaFoto(richieste) {
  mkdirSync(OUT, { recursive: true });
  const risultato = {};
  const crediti = [];

  for (const { posto, cerca: chiavi, quante, giorno } of richieste) {
    const già = readdirSync(OUT).filter((f) => f.startsWith(`${posto}-`) && f.endsWith('.jpg'));
    if (già.length >= quante) {
      risultato[posto] = già.sort().slice(0, quante).map((f) => path.join(OUT, f));
      console.log(`${posto}: ${quante} foto già sul disco`);
      continue;
    }

    // Le chiavi si alternano invece di esaurirsi una alla volta: così le prime foto della
    // tappa — quelle che finiscono nella copertina e nella prima riga — sono diverse fra
    // loro anche quando una sola chiave avrebbe già dato tutti i risultati che servono.
    // Una chiave alla volta, non tutte insieme: senza chiave d'accesso Openverse tiene
    // un limite di frequenza basso, e una raffica di richieste parallele se lo mangia.
    const perChiave = [];
    for (const chiave of chiavi) {
      perChiave.push(await cerca(chiave));
      await new Promise((r) => setTimeout(r, 350));
    }
    const candidati = [];
    for (let i = 0; candidati.length < perChiave.flat().length; i++) {
      let aggiunto = false;
      for (const lista of perChiave) {
        if (lista[i]) {
          candidati.push(lista[i]);
          aggiunto = true;
        }
      }
      if (!aggiunto) break;
    }

    const presi = [];
    const visti = new Set();
    /*
     * L'impronta del file, non solo l'indirizzo.
     *
     * Openverse indicizza la stessa immagine più volte quando è stata caricata su archivi
     * diversi: indirizzi diversi, byte identici. Cercando "Hakone" la prima versione di
     * questa GIF ha messo la stessa stampa tre volte di fila e la stessa fotografia di
     * barche due volte, e nella griglia si vedeva benissimo.
     */
    const impronte = new Set();
    const miniature = [];

    for (const c of candidati) {
      if (presi.length >= quante) break;
      const titolo = (c.title ?? '').trim().toLowerCase();
      if (visti.has(c.url) || (titolo && visti.has(titolo))) continue;
      visti.add(c.url);
      if (titolo) visti.add(titolo);

      const quando = new Date(giorno);
      quando.setHours(9 + presi.length * 2, 11 + presi.length * 7, 40);

      const destinazione = path.join(OUT, `${posto}-${String(presi.length + 1).padStart(2, '0')}.jpg`);
      const grezzo = path.join(OUT, '.scarico.tmp');

      try {
        const r = await fetch(c.url, { headers: { 'User-Agent': AGENTE } });
        if (!r.ok) continue;
        writeFileSync(grezzo, Buffer.from(await r.arrayBuffer()));
        const { impronta, piccola } = prepara(grezzo, destinazione, quando);
        const gemella =
          impronte.has(impronta) || miniature.some((m) => differenza(m, piccola) < SOMIGLIANZA_MASSIMA);
        if (gemella) {
          rmSync(destinazione, { force: true });
          continue;
        }
        impronte.add(impronta);
        miniature.push(piccola);
      } catch (errore) {
        // Un collegamento morto o un file che ffmpeg non digerisce: si passa al prossimo
        // candidato invece di fermare tutto. Il motivo si stampa, o una tappa che resta
        // corta sembra un capriccio dell'archivio invece di venti scaricamenti falliti.
        console.log(`  scartata ${c.url.slice(0, 70)}… — ${String(errore).split('\n')[0]}`);
        continue;
      }

      presi.push(destinazione);
      crediti.push({
        posto,
        file: path.basename(destinazione),
        titolo: c.title ?? '(senza titolo)',
        autore: c.creator ?? '(ignoto)',
        licenza: `${c.license}${c.license_version ? ` ${c.license_version}` : ''}`,
        origine: c.foreign_landing_url ?? c.url,
      });
    }

    if (presi.length < quante) {
      throw new Error(`${posto}: trovate solo ${presi.length} foto su ${quante} richieste`);
    }

    risultato[posto] = presi;
    console.log(`${posto}: ${presi.length} foto`);
  }

  if (crediti.length) scriviCrediti(crediti);
  return risultato;
}

function scriviCrediti(nuovi) {
  const file = path.join(OUT, 'CREDITI.md');
  const testa =
    '# Da dove vengono queste foto\n\n' +
    'Scaricate da [Openverse](https://openverse.org) con licenza **CC0** o **pubblico\n' +
    'dominio**: non impongono condizioni, e i crediti stanno qui per tracciabilità, non\n' +
    'per obbligo. Le date di scatto originali sono state sostituite con quelle del viaggio\n' +
    'inventato (vedi `tools/foto-vere.mjs`).\n\n' +
    '| Posto | File | Titolo | Autore | Licenza | Origine |\n' +
    '|---|---|---|---|---|---|\n';

  const vecchie = existsSync(file)
    ? readFileSync(file, 'utf8').split('\n').filter((r) => r.startsWith('| ') && !r.startsWith('| Posto') && !r.startsWith('|---'))
    : [];

  const righe = nuovi.map(
    (c) => `| ${c.posto} | ${c.file} | ${c.titolo.replace(/\|/g, '/')} | ${c.autore} | ${c.licenza} | ${c.origine} |`,
  );

  writeFileSync(file, testa + [...new Set([...vecchie, ...righe])].sort().join('\n') + '\n');
}

// Eseguito a mano, scarica il viaggio della dimostrazione così com'è.
if (import.meta.url === `file://${process.argv[1]}`) {
  const { TAPPE, FOTO_PER_TAPPA } = await import('./viaggio-demo.mjs');
  await scaricaFoto(
    TAPPE.map((t) => ({
      posto: t.posto,
      cerca: t.cerca,
      quante: FOTO_PER_TAPPA,
      giorno: `${t.giorno}T00:00:00`,
    })),
  );
  console.log('in', OUT);
}
