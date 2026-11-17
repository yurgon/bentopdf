// Printer test page: test sheets drawn in the browser, printed at real size or saved as PDF.
import { mountGenerator, formAll, formVal, presetPaper } from '../print/gen';
import { PAPER, type Page, type Paper } from '../print/sheet';
import { SHEETS, duplexSheets } from '../print/test-sheets';
import { t, tn } from '../i18n';

presetPaper();

mountGenerator({
  tool: 'printer-test-page',
  title: t('Printer test page'),
  fileName: () => `printer-test-page-${formVal('paper')}.pdf`,
  previewMax: 5,
  build() {
    const [w, h] = PAPER[(formVal('paper') || 'a4') as Paper];
    const chosen = formAll('sheet');
    const pages: Page[] = [];
    for (const k of ['black', 'color', 'align'] as const)
      if (chosen.includes(k)) pages.push(SHEETS[k].build(w, h));
    if (chosen.includes('duplex')) pages.push(...duplexSheets(w, h));
    if (!pages.length)
      return {
        pages,
        summary: '',
        error: t('Pick at least one sheet to print.'),
      };
    const sheets = pages.length - (chosen.includes('duplex') ? 1 : 0);
    return {
      pages,
      summary: `${tn(pages.length, '{n} page', '{n} pages')} · ${tn(sheets, '{n} sheet', '{n} sheets')}`,
    };
  },
});
