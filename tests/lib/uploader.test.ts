import { describe, expect, it } from 'vitest';
import { UploadQueue } from '../../src/lib/uploader';

const fakeFile = (name: string) => new File([name], name, { type: 'image/jpeg' });
const files = (count: number) => Array.from({ length: count }, (_, i) => fakeFile(`foto-${i}.jpg`));

/** Nessuna attesa reale nei test: il backoff verrebbe solo cronometrato a vuoto. */
const noWait = { waitBeforeRetry: async () => {}, isOnline: () => true };

describe('coda di caricamento', () => {
  it('carica tutte le foto', async () => {
    const caricate: string[] = [];
    const queue = new UploadQueue(async (file) => void caricate.push(file.name), noWait);

    queue.add(files(10));
    const progress = await queue.run();

    expect(caricate).toHaveLength(10);
    expect(progress.done).toBe(10);
    expect(progress.failed).toBe(0);
  });

  it('non tiene mai più di quattro caricamenti insieme', async () => {
    let inCorso = 0;
    let picco = 0;

    const queue = new UploadQueue(async () => {
      inCorso++;
      picco = Math.max(picco, inCorso);
      await new Promise((r) => setTimeout(r, 5));
      inCorso--;
    }, noWait);

    queue.add(files(20));
    await queue.run();

    expect(picco).toBe(4);
  });

  it('riprova la foto fallita senza toccare le altre', async () => {
    const tentativi = new Map<string, number>();

    const queue = new UploadQueue(async (file) => {
      const n = (tentativi.get(file.name) ?? 0) + 1;
      tentativi.set(file.name, n);
      // La seconda foto fallisce una volta sola, poi funziona.
      if (file.name === 'foto-1.jpg' && n === 1) throw new Error('rete instabile');
    }, noWait);

    queue.add(files(3));
    const progress = await queue.run();

    expect(progress.done).toBe(3);
    expect(tentativi.get('foto-1.jpg')).toBe(2);
    expect(tentativi.get('foto-0.jpg')).toBe(1);
    expect(tentativi.get('foto-2.jpg')).toBe(1);
  });

  it('si arrende dopo tre tentativi e dice perché', async () => {
    const queue = new UploadQueue(async () => {
      throw new Error('server rotto');
    }, noWait);

    queue.add(files(1));
    const progress = await queue.run();

    expect(progress.failed).toBe(1);
    expect(progress.items[0]?.attempts).toBe(3);
    expect(progress.items[0]?.error).toBe('server rotto');
  });

  it('una foto fallita non impedisce alle altre di arrivare', async () => {
    const queue = new UploadQueue(async (file) => {
      if (file.name === 'foto-2.jpg') throw new Error('questa no');
    }, noWait);

    queue.add(files(5));
    const progress = await queue.run();

    expect(progress.done).toBe(4);
    expect(progress.failed).toBe(1);
  });

  it('retryFailed rimette in coda solo le fallite', async () => {
    let permettiTutto = false;
    const caricate: string[] = [];

    const queue = new UploadQueue(async (file) => {
      if (file.name === 'foto-1.jpg' && !permettiTutto) throw new Error('non ancora');
      caricate.push(file.name);
    }, noWait);

    queue.add(files(3));
    await queue.run();
    expect(caricate).toHaveLength(2);

    permettiTutto = true;
    queue.retryFailed();
    const progress = await queue.run();

    // Le due già riuscite non sono state ricaricate: in coda è tornata solo la terza.
    expect(caricate).toEqual(['foto-0.jpg', 'foto-2.jpg', 'foto-1.jpg']);
    expect(progress.done).toBe(3);
    expect(progress.failed).toBe(0);
  });

  it('aspetta il ritorno della rete invece di bruciare tentativi', async () => {
    let online = false;
    let tentativi = 0;

    const queue = new UploadQueue(
      async () => {
        tentativi++;
      },
      { ...noWait, isOnline: () => online },
    );

    queue.add(files(1));
    const running = queue.run();

    // Con la rete giù nessun tentativo deve partire.
    await new Promise((r) => setTimeout(r, 50));
    expect(tentativi).toBe(0);

    online = true;
    const progress = await running;

    expect(tentativi).toBe(1);
    expect(progress.done).toBe(1);
  });

  it('fermata, non fa partire quelle che non sono ancora partite', async () => {
    const partite: string[] = [];

    const queue: UploadQueue = new UploadQueue(async (file) => {
      partite.push(file.name);
      // Alla prima foto qualcuno preme "Ferma".
      if (partite.length === 1) queue.cancel();
      await new Promise((r) => setTimeout(r, 5));
    }, noWait);

    queue.add(files(20));
    const progress = await queue.run();

    expect(progress.cancelled).toBe(true);
    // Le quattro già in volo arrivano comunque: una richiesta a metà non si richiama
    // indietro. La quinta non parte.
    expect(partite.length).toBeLessThanOrEqual(4);
    // Le altre restano in attesa, non fallite: non sono andate male, non sono partite.
    expect(progress.items.filter((i) => i.status === 'attesa').length).toBeGreaterThanOrEqual(16);
    expect(progress.failed).toBe(0);
  });

  it('scegliere altre foto fa ripartire una coda fermata', async () => {
    const caricate: string[] = [];
    const queue = new UploadQueue(async (file) => void caricate.push(file.name), noWait);

    queue.add(files(3));
    queue.cancel();
    await queue.run();
    expect(caricate).toHaveLength(0);

    queue.add([fakeFile('nuova.jpg')]);
    await queue.run();

    // `add` è una richiesta nuova, e riprende anche quelle rimaste ferme: chi torna a
    // scegliere foto non si aspetta che le precedenti restino lì per sempre.
    expect(caricate).toContain('nuova.jpg');
    expect(caricate).toHaveLength(4);
  });

  it('racconta l\'avanzamento mentre lavora', async () => {
    const istantanee: number[] = [];

    const queue = new UploadQueue(async () => {}, {
      ...noWait,
      onProgress: (p) => istantanee.push(p.done),
    });

    queue.add(files(4));
    await queue.run();

    expect(istantanee.at(-1)).toBe(4);
    expect(istantanee.length).toBeGreaterThan(4);
  });
});
