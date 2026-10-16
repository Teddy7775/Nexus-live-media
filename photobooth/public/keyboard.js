// An on-screen keyboard for typing an email address on a touch kiosk (no physical keyboard, and the Windows touch keyboard is
// unreliable in kiosk mode). Lower case only (addresses are normalised anyway), with the keys addresses need and one-tap domains.

const ROWS = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm', '{backspace}'],
  ['@', '.', '-', '_', '+'],
];
const DOMAINS = ['@gmail.com', '@outlook.com', '@yahoo.com', '@icloud.com', '.com'];

/**
 * Builds the keyboard inside `container`. `onKey` receives { type: 'char', value } | { type: 'backspace' } | { type: 'clear' }.
 * Returns a function that removes it.
 */
export function createKeyboard({ container, onKey }) {
  container.replaceChildren();
  const make = (label, key, className = '') => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `key ${className}`.trim();
    button.dataset.key = key;
    button.textContent = label;
    if (key === '{backspace}') button.setAttribute('aria-label', 'Delete');
    return button;
  };

  for (const row of ROWS) {
    const el = document.createElement('div');
    el.className = 'key-row';
    for (const key of row) {
      if (key === '{backspace}') el.append(make('⌫', key, 'wide'));
      else el.append(make(key, key));
    }
    container.append(el);
  }
  const quick = document.createElement('div');
  quick.className = 'key-row quick';
  for (const domain of DOMAINS) quick.append(make(domain, domain, 'domain'));
  quick.append(make('Clear', '{clear}', 'wide action'));
  container.append(quick);

  const onClick = (event) => {
    const button = event.target.closest('button.key');
    if (!button || !container.contains(button)) return;
    const key = button.dataset.key;
    if (key === '{backspace}') onKey({ type: 'backspace' });
    else if (key === '{clear}') onKey({ type: 'clear' });
    else onKey({ type: 'char', value: key });
  };
  container.addEventListener('click', onClick);
  return () => {
    container.removeEventListener('click', onClick);
    container.replaceChildren();
  };
}
