// Short lines Plyleaf adds to BentoPDF tools. They live here so the translation script finds
// them (it reads src/site/js only) and every language gets them.
import { t } from '../i18n';

export const cancelLabel = () => t('Cancel');

export const officeNote = () =>
  t(
    'The first conversion downloads the converter, about 77 MB, once. After that it starts at once, even offline.'
  );

export const textEngineNote = () =>
  t(
    'The first run downloads the text engine, about 39 MB, once. After that it starts at once.'
  );

/** Puts a short note above a tool's main button, once. */
export function noteBefore(button: Element | null, id: string, text: string) {
  if (!button || document.getElementById(id)) return;
  const note = document.createElement('p');
  note.id = id;
  note.className = 'text-sm text-gray-400 mb-3';
  note.textContent = text;
  button.before(note);
}
