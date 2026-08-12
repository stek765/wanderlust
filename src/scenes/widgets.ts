/**
 * I mattoncini della pagina master: un pulsante, un campo. Uno solo per tipo.
 *
 * Non è pignoleria. La versione precedente di quella pagina aveva sei modi diversi di
 * fare un pulsante, e bastava aggiungerne un settimo per rompere il ritmo di tutto —
 * ogni volta che qui è ricomparsa una variante nuova, la pagina è tornata illeggibile.
 * Passare da qui è il modo di rendere quel guaio impossibile invece che sconsigliato.
 */

/**
 * Le varianti sono tre e coprono tutto: `primary` per l'azione principale (una sola per
 * schermata), `ghost` per tutto il resto, `danger` per quello che distrugge — e in questo
 * progetto il rosso significa una cosa sola, definitiva.
 */
export function button(
  label: string,
  variant: 'primary' | 'ghost' | 'danger',
  onClick: () => void | Promise<void>,
): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = `btn btn--${variant}`;
  element.textContent = label;
  element.addEventListener('click', () => void onClick());
  return element;
}

/** Etichetta sopra, campo sotto. Restituisce entrambi: chi lo usa deve poterci leggere dentro. */
export function field(label: string, type: string, placeholder: string) {
  const wrapper = document.createElement('label');
  wrapper.className = 'field';

  const text = document.createElement('span');
  text.textContent = label;

  const input = document.createElement('input');
  input.type = type;
  input.placeholder = placeholder;
  if (type === 'number') input.step = 'any';

  wrapper.append(text, input);
  return { wrapper, input };
}
