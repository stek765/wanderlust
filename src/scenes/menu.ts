/**
 * Il ☰ in alto a sinistra.
 *
 * Compare solo se questo browser conosce il token master, e va detto chiaramente perché
 * non se ne tragga la conclusione sbagliata: NON è un controllo di sicurezza. Quello sta
 * dove è sempre stato, nel Worker, che rifiuta la creazione a chi non presenta il token.
 * Qui è solo questione di ingombro — a chi riceve un link condiviso il pulsante "nuovo
 * viaggio" non serve, e mostrarglielo sarebbe rumore.
 */

import { recallMasterToken } from '../lib/session';
import { buildMenuPanel } from './menu-panel';

export class Menu {
  /**
   * Aggancia il menu, se questo browser ha di che riempirlo.
   *
   * `primaDiAprire` serve a chi ha qualcosa da togliere di mezzo: aprendo il cassetto dei
   * viaggi con le foto di una tappa ancora aperte, quelle restavano lì sotto — si chiudeva
   * il menu e ci si ritrovava dentro una tappa che si credeva di aver lasciato. Il menu
   * non sa cosa c'è aperto sulla pagina, e non deve saperlo: lo chiede a chi lo monta.
   */
  static mount(root: HTMLElement, primaDiAprire?: () => void): void {
    const masterToken = recallMasterToken(localStorage);
    if (!masterToken) return;

    const nav = document.createElement('nav');
    nav.className = 'menu';

    // Il velo dietro il cassetto: separa dalla mappa e si chiude toccandolo.
    const scrim = document.createElement('div');
    scrim.className = 'menu__scrim';
    scrim.hidden = true;

    const drawer = document.createElement('div');
    drawer.className = 'menu__drawer';
    drawer.hidden = true;
    drawer.append(buildMenuPanel(masterToken));

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'menu__toggle';
    toggle.setAttribute('aria-label', 'Apri i viaggi');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.innerHTML = '<span class="menu__bars" aria-hidden="true"><i></i><i></i><i></i></span>';

    let chiuso = true;

    /*
     * Il cassetto nasce dal ☰ e ci torna dentro.
     *
     * `transform-origin` in alto a sinistra, dove sta il pulsante: è quello che lo fa
     * sembrare aperto DA lì invece che comparso al centro dello schermo. E la chiusura è
     * più rapida dell'apertura, perché chi chiude vuole vedere sparire.
     */
    const apri = () => {
      chiuso = false;
      scrim.hidden = false;
      // Chi ha aperto qualcosa sopra la mappa se lo tolga di mezzo prima: due pannelli a
      // schermo intero sovrapposti sono un modo sicuro di perdere l'orientamento.
      primaDiAprire?.();

      drawer.hidden = false;
      // Un fotogramma di ritardo: senza, il browser applica lo stato finale insieme a
      // quello iniziale e l'animazione non parte proprio.
      requestAnimationFrame(() => {
        scrim.classList.add('menu__scrim--on');
        drawer.classList.add('menu__drawer--on');
      });
      nav.classList.add('menu--open');
      toggle.setAttribute('aria-expanded', 'true');
      document.body.classList.add('is-locked');
    };

    const chiudi = () => {
      chiuso = true;
      scrim.classList.remove('menu__scrim--on');
      drawer.classList.remove('menu__drawer--on');
      nav.classList.remove('menu--open');
      toggle.setAttribute('aria-expanded', 'false');
      document.body.classList.remove('is-locked');

      // Nascosto solo a movimento finito: toglierlo subito farebbe sparire il cassetto
      // di scatto, senza mai mostrare l'animazione di uscita.
      setTimeout(() => {
        if (!chiuso) return;
        scrim.hidden = true;
        drawer.hidden = true;
      }, 200);
    };

    toggle.addEventListener('click', (event) => {
      event.stopPropagation();
      if (chiuso) apri();
      else chiudi();
    });

    scrim.addEventListener('click', chiudi);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !chiuso) chiudi();
    });

    nav.append(toggle, scrim, drawer);
    root.append(nav);
  }
}
