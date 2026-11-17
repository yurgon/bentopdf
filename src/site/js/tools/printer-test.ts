// Printer test page: test sheets drawn in the browser, printed at real size or saved as PDF.
import { mountGenerator, formAll, formVal, presetPaper } from '../print/gen';
import { PAPER, type Page, type Paper } from '../print/sheet';
import { SHEETS, duplexSheets } from '../print/test-sheets';

presetPaper();

mountGenerator({
  tool: 'printer-test-page',
  title: 'Printer test page',
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
      return { pages, summary: '', error: 'Pick at least one sheet to print.' };
    const sheets = pages.length - (chosen.includes('duplex') ? 1 : 0);
    return {
      pages,
      summary: `${pages.length} ${pages.length === 1 ? 'page' : 'pages'} on ${sheets} ${sheets === 1 ? 'sheet' : 'sheets'}`,
    };
  },
});
