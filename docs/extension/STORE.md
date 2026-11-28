# Plyleaf Chrome extension: store notes

Source: `extension/`. Package: `cd extension && zip -qr ../extension-build/plyleaf-extension-<version>.zip . -x 'icons/icon.svg' '.*'`
(`extension-build/` is not in git). Bump `version` in `manifest.json` before each upload.

## What it does (single purpose)

Save the current web page as a PDF, and open PDFs (links or the open PDF tab) in Plyleaf's free in-browser tools.

## Listing

- Name: Plyleaf: Save Web Page as PDF
- Summary (≤132): Save any web page as a PDF in one click and open PDFs in free Plyleaf tools. No account, no uploads: files stay on your device.
- Category: Productivity / Tools
- Keyword target: "save webpage as pdf" (1,900/mo US, 6,600 with variants), "chrome extension pdf", "pdf editor chrome".

## Description (paste into the store)

Save any web page as a PDF in one click, and open PDFs in free Plyleaf tools. No account, no uploads, no limits.

SAVE WEB PAGES AS PDF
• Press the Plyleaf button, or right-click a page and choose "Save page as PDF".
• Chrome's own print engine makes the PDF, so text and links stay selectable and searchable.
• Choose Letter, A4, Legal or A3, portrait or landscape, with or without margins and backgrounds. Your choice is remembered.
• The PDF goes straight to your Downloads folder, named after the page.

OPEN PDFS IN PLYLEAF
• Right-click any link to a PDF and open it in a Plyleaf tool: edit, sign, compress, merge, split, rearrange pages, rotate, convert to Word or JPG, add a password.
• Viewing a PDF in Chrome? Press the Plyleaf button to open it in any of those tools.
• Plyleaf tools run in your browser. Your file is never uploaded to a server.

PRIVATE BY DESIGN
• No account and no sign-up.
• No analytics or tracking in the extension. It collects no data.
• Permissions are asked only when you first use a feature.

Plyleaf is a free set of more than 100 PDF tools at https://plyleaf.com

## Privacy tab answers

- Single purpose: Save web pages as PDF and open PDFs in Plyleaf's in-browser PDF tools.
- Remote code: No.
- Data usage: collects none of the listed data types. Tick the three certifications.
- Privacy policy URL: https://plyleaf.com/privacy

## v1.1 (built-in editor): extra fields

- Name: Plyleaf: Save Web Page as PDF, PDF Editor
- Summary: Save any web page as a PDF in one click. Edit, sign and fill in PDFs in Chrome. No account, no uploads: files stay on your device.
- Add to the description, under OPEN PDFS IN PLYLEAF: "• Built-in PDF editor: add text, draw, highlight, insert images, sign and fill in forms right in Chrome, then save. Works offline." and "• Optional: open every PDF link in the Plyleaf editor instead of Chrome's viewer."
- declarativeNetRequestWithHostAccess: Only when the user turns on "Open PDF links in the Plyleaf editor": one redirect rule sends tabs opening a .pdf address to the bundled editor page. Off by default.
- Host permission (all sites, optional): asked only when the user turns on that setting, to read the PDF the user opened so the bundled editor can show it.
- 'wasm-unsafe-eval' in the extension CSP: the bundled PDF.js uses WebAssembly to decode images inside PDFs. All code is in the package; nothing is loaded from the web.

## Permission justifications

- `debugger` (optional, asked on first save): runs Chrome's own print engine (`Page.printToPDF`) on the page the user chose to save. Attached only for the moment of saving, then detached.
- `downloads`: saves the finished PDF to the Downloads folder.
- `offscreen`: turns the PDF bytes into a blob URL for the download (service workers cannot).
- `contextMenus`: "Save page as PDF" and "Open PDF in Plyleaf" on right-click.
- `activeTab`, `scripting`: detect whether the open tab is a PDF; show a short status message on the page.
- `storage`: the user's PDF settings (paper size, orientation, margins, backgrounds).
- Optional host access (asked per site, on use): download the PDF behind a link the user right-clicked, to hand it to the Plyleaf tool.
- Content script on plyleaf.com only: puts the handed-over PDF into the tool's file picker.

## Data use

No data is collected or sent anywhere. Pages and PDFs are processed on the user's computer; plyleaf.com tools run in the browser and do not upload files. No remote code.

## Still needed before publishing

- Chrome Web Store developer account (one-time 5 USD fee, paid by the owner).
- Privacy policy URL: https://plyleaf.com/privacy (add a short extension paragraph first).
- Screenshots 1280×800 and a 440×280 promo tile.
