/**
 * Punto d'ingresso. Guarda l'URL e decide che pagina è.
 *
 * Non c'è una home, ed è voluto: non esiste nessun posto da cui si possa risalire
 * all'elenco dei ricordi. Ogni magnete apre il suo, e nient'altro.
 */

import './styles.css';
import { renderMasterPage } from './pages/master';
import { renderPlacePage } from './pages/place';
import { parseRoute } from './lib/session';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('#app mancante nel documento');

const route = parseRoute(location.href);

switch (route.kind) {
  case 'place':
    void renderPlacePage(root, route);
    break;

  case 'master':
    renderMasterPage(root, route.masterToken);
    break;

  default:
    // Chi arriva alla radice non deve capire cosa c'è dietro: nessun indizio, nessun
    // elenco, nessun invito a cercare.
    root.innerHTML = '<div class="message"><h1>Niente da vedere qui</h1></div>';
}
