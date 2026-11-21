# zh-TW (Тайвань), пакет 3: проверка ключей по seodata

Код страны: tw. Два раунда запросов. Совсем без данных: redact-pdf (pdf 塗黑, 遮蔽), form-creator (pdf 表單製作, 可填寫), pdf-to-pdfa (почти нет: pdf/a 170, pdf轉pdf/a 20). Объёмы в месяц.

| страница          | главный запрос            | объём | близкие варианты                                                   | что изменено                                            |
| ----------------- | ------------------------- | ----- | ------------------------------------------------------------------ | ------------------------------------------------------- |
| redact-pdf        | PDF 塗黑 (нет данных)     | n/a   | pdf 馬賽克 320, pdf redact 20                                      | без изменений                                           |
| compare-pdfs      | PDF 比對                  | 260   | pdf比對 260, 比對pdf 30                                            | h1 был 比較 PDF, стал PDF 比對; описание                |
| ocr-pdf           | PDF OCR                   | 1000  | pdf 文字辨識 590, ocr pdf 480, pdf ocr文字辨識 210                 | уже совпадало                                           |
| split-pdf         | PDF 分割                  | 33100 | pdf拆分 12100, 拆分pdf 6600, pdf 拆頁 480                          | в описание добавлено 拆分                               |
| delete-pages      | PDF 刪除頁面              | 4400  | pdf 刪頁 4400, 刪除pdf頁面 1900, pdf 刪除 3600                     | совпадало                                               |
| unlock-pdf        | PDF 解除加密 (解密)       | 4400  | pdf解密 4400, pdf解除密碼 1600, pdf 移除密碼 880, pdf 密碼解除 720 | было 解鎖 (нет данных); title, h1, описание, FAQ, абзац |
| powerpoint-to-pdf | PPT 轉 PDF                | 18100 | pptx 轉 pdf 1000, ppt pdf 880, ppt轉pdf 免費 140                   | совпадало                                               |
| form-creator      | PDF 表單製作 (нет данных) | n/a   | pdf 可填寫 10                                                      | без изменений                                           |
| heic-to-pdf       | HEIC 轉 PDF               | 880   |                                                                    | совпадало                                               |
| pdf-to-text       | PDF 轉文字                | 880   | pdf 轉 txt 590                                                     | совпадало                                               |
| sign-pdf          | PDF 簽名                  | 2900  | pdf 電子簽名 720, pdf線上簽名 590, pdf 簽名檔 320                  | описание: 電子簽名                                      |
| pdf-to-excel      | PDF 轉 Excel              | 33100 | pdf轉excel檔 720, pdf 轉 excel 免費 480                            | совпадало                                               |
| markdown-to-pdf   | MD 轉 PDF                 | 480   | markdown pdf 1600, markdown 轉 pdf 260                             | title и описание начинаются с MD 轉 PDF                 |
| crop-pdf          | PDF 裁切                  | 1300  | pdf 裁剪 720, crop pdf 170                                         | совпадало                                               |
| excel-to-pdf      | Excel 轉 PDF              | 12100 | xlsx 轉 pdf 590, excel轉pdf檔 170                                  | совпадало                                               |
| extract-images    | PDF 提取圖片              | 70    | pdf 匯出圖片 40, pdf 圖片 210; 擷取圖片 нет данных                 | 擷取 заменено на 提取 в title, h1, описании, FAQ        |
| flatten-pdf       | PDF 平面化                | 260   |                                                                    | совпадало                                               |
| form-filler       | PDF 填寫                  | 90    | pdf 填寫表單 нет данных                                            | title, описание, абзац                                  |
| pdf-to-pdfa       | PDF/A                     | 170   | pdf轉pdf/a 20                                                      | без изменений                                           |
| pdf-to-svg        | PDF 轉 SVG                | 170   | pdf to svg 170                                                     | совпадало                                               |
| protect-pdf       | PDF 加密                  | 4400  | pdf 密碼 590, pdf 加密碼 320, pdf 設定密碼 170                     | совпадало                                               |
| rotate-pdf        | PDF 旋轉                  | 3600  | pdf轉向 2900, 旋轉pdf 1300, pdf轉方向 480, rotate pdf 390          | в описание добавлено 轉向                               |
| rtf-to-pdf        | RTF 轉 PDF                | 390   |                                                                    | совпадало                                               |
| tiff-to-pdf       | TIF 轉 PDF                | 720   | tiff轉pdf 480, tiff pdf 170                                        | title, описание, абзац                                  |
| txt-to-pdf        | TXT 轉 PDF                | 880   | 文字檔轉pdf 170, 文字轉pdf 320                                     | совпадало                                               |
