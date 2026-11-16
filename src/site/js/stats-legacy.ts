// Theme toggle and page-view count on BentoPDF's own pages (loaded from src/js/main.ts). Finished operations are
// signalled by BentoPDF's downloadFile() through the 'plyleaf:done' event that stats.ts listens to.
import { countView } from './stats';
import './theme';

countView();
