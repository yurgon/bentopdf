# Plyleaf chat export extension: store notes

Source: `extension-chat/`. Package:
`cd extension-chat && zip -qr ../extension-build/chat/plyleaf-chat-export-<version>.zip . -x 'icons/icon.svg' '.*'`
(`extension-build/` is not in git; store images are there too). Bump `version` in `manifest.json` before each upload.

## What it does (single purpose)

Export the AI chat open in the current tab (ChatGPT, Claude, Gemini, Perplexity, DeepSeek, Grok, Copilot, Le Chat) as a PDF, Markdown, Word or HTML document.

## Listing

- Name (in manifest): Plyleaf: ChatGPT to PDF, Claude and Gemini Export
- Summary (manifest description, 132 chars): Save ChatGPT, Claude, Gemini, Perplexity and DeepSeek chats as PDF, Markdown or Word. Code and math stay sharp. Nothing is uploaded.
- Category: Productivity / Tools
- Language: English
- Keyword targets (US, monthly): "chatgpt to pdf extension" 1,000, "chatgpt to pdf" 590, "export chatgpt conversation" 390, "export chatgpt conversation to pdf" 170, "how to save chatgpt conversation as pdf" 140, "chatgpt to pdf chrome extension" 140, "claude exporter" 110, "export claude chat" 90.
- Name note: the name starts with our brand, so it does not read as an OpenAI product. If the review objects to "ChatGPT" in the name, fall back to "Plyleaf: Save ChatGPT as PDF, Claude and Gemini Export".

## Description (paste into the store)

Save any ChatGPT conversation as a clean PDF in one click. Claude, Gemini, Perplexity, DeepSeek, Grok, Copilot and Le Chat work too. No account, no uploads, no limits.

CHATGPT TO PDF, DONE RIGHT
• Press the Plyleaf button on any chat, or right-click the page and choose "Export this chat to PDF".
• You get a document, not a screenshot: real text you can search and copy.
• Headings, lists, tables, code blocks and math formulas stay sharp.
• Page numbers and a clickable outline from the headings.
• No sidebar, buttons or input box in the file.

LONG CHATS COME OUT WHOLE
• Chat apps only keep part of a long conversation on screen. Plyleaf scrolls through it once, so every message is included.
• Pictures in the chat are copied into the file.

YOUR CHOICE BEFORE YOU SAVE
• Pick the messages to keep, or leave out your own questions.
• Letter, A4, Legal or A3, three text sizes, and an option to start each answer on a new page.
• Rename the file by clicking the title.

MORE FORMATS
• Markdown for notes apps and GitHub.
• Word for editing.
• HTML to share as a web page.
• Copy the whole chat as Markdown.

PRIVATE BY DESIGN
• The chat is read on your computer, only when you press the button, and only in that tab.
• Nothing is sent to us, to the AI service or to anyone else. No analytics.
• No account and no sign-up.

Works with chatgpt.com, claude.ai, gemini.google.com, perplexity.ai, chat.deepseek.com, grok.com, copilot.microsoft.com and chat.mistral.ai.

Plyleaf is a free set of more than 100 PDF tools at https://plyleaf.com
Not affiliated with OpenAI, Anthropic, Google or the other AI services named here.

## Privacy tab answers

- Single purpose: Export the AI chat open in the current tab as a PDF, Markdown, Word or HTML document.
- Remote code: No. All code is in the package.
- Data usage: collects none of the listed data types. Tick the three certifications.
- Privacy policy URL: https://plyleaf.com/privacy (section "The Plyleaf chat export extension").

## Permission justifications

- `activeTab`: the chat is read only from the tab where the user pressed the Plyleaf button, the right-click item or the shortcut, and only at that moment.
- `scripting`: runs the bundled reader script in that tab to turn the chat into a document.
- `storage`: keeps the user's export settings (paper size, text size, which parts to include) and the read chat on the device for up to a day, so the preview page can show it.
- `contextMenus`: adds "Export this chat to PDF" to the right-click menu on supported AI chat sites.
- `debugger` (optional, asked only if the user chooses "one-click PDF"): runs Chrome's own print engine (`Page.printToPDF`) on the extension's own export page to save the PDF without the print window. Never attached to websites.
- No host permissions.

## Data use

No data is collected or sent anywhere. Chats are read and turned into files on the user's computer. No remote code, no analytics.

## Store images (in `extension-build/chat/`)

- `store-icon-128.png` (96 px artwork in a 128 px canvas)
- `screenshot-1-preview.png`, `screenshot-2-pdf.png`, `screenshot-3-welcome.png` (1280×800)
- `promo-440x280.png` (small promo tile)
