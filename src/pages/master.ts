/**
 * L'indirizzo segreto da cui si entra la prima volta.
 *
 * Non fa quasi niente: ricorda il token su questo browser e mostra a schermo pieno lo
 * stesso pannello che poi vivrà dentro il ☰. Una implementazione sola, due modi di
 * arrivarci — e dopo la prima visita questo indirizzo non serve più.
 */

import { rememberMasterToken } from '../lib/session';
import { buildMenuPanel } from '../scenes/menu-panel';

export function renderMasterPage(root: HTMLElement, masterToken: string): void {
  rememberMasterToken(localStorage, masterToken);

  root.replaceChildren();

  const page = document.createElement('div');
  page.className = 'master';
  page.append(buildMenuPanel(masterToken));

  root.append(page);
}
