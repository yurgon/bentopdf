// Data passed between the PDF to EPUB stages: extraction (PDF or OCR) → structure → EPUB.
// Coordinates are PDF points with the origin at the top left of each page.

/** A run of text with one style. */
export interface Seg {
  t: string;
  bold?: boolean;
  italic?: boolean;
  /** raised and smaller: a footnote marker or exponent */
  sup?: boolean;
  /** id of the footnote this marker points to */
  note?: string;
}

export interface Line {
  page: number;
  segs: Seg[];
  x0: number;
  x1: number;
  /** top of the line box and baseline */
  top: number;
  base: number;
  /** dominant font size */
  size: number;
  bold: boolean;
  italic: boolean;
  /** OCR found a paragraph start here */
  paraHint?: boolean;
}

export interface Picture {
  page: number;
  top: number;
  bottom: number;
  x0: number;
  x1: number;
  blob: Blob;
  type: 'image/jpeg' | 'image/png';
  w: number;
  h: number;
}

export interface OutlineItem {
  title: string;
  depth: number;
  page: number;
  /** top of the target on the page, if the bookmark says */
  top: number | null;
}

export interface PageInfo {
  w: number;
  h: number;
  /** the page had no text layer and was recognised */
  ocr: boolean;
}

export interface Extracted {
  pages: PageInfo[];
  lines: Line[];
  pictures: Picture[];
  outline: OutlineItem[];
  title: string;
  author: string;
  lang: string;
  cover: Blob | null;
}

export interface Block {
  kind: 'p' | 'h' | 'img';
  level?: number;
  segs?: Seg[];
  picture?: Picture;
  page: number;
  top: number;
}

export interface Note {
  page: number;
  marker: string;
  segs: Seg[];
  id: string;
}

export interface Chapter {
  title: string;
  /** pages before the first chapter heading (title page, contents) */
  front?: boolean;
  blocks: Block[];
  notes: Note[];
}

export interface Book {
  title: string;
  author: string;
  lang: string;
  chapters: Chapter[];
  stats: {
    pages: number;
    paragraphs: number;
    headings: number;
    pictures: number;
    removedLines: number;
    notes: number;
    ocrPages: number;
    /** how chapters were found in the end */
    chapterSource: 'bookmarks' | 'fonts' | 'pages';
  };
}

export interface StructureOptions {
  cleanHeaders: boolean;
  chapters: 'auto' | 'fonts' | 'none';
  pictures: boolean;
  notes: boolean;
}
