-- OCR progress for scanned PDFs. A scanned PDF has no text layer; it is read page by page
-- (in batches, so each request stays short) and the text is stored in documents.extracted_text.
alter table documents
  add column needs_ocr       boolean not null default false,
  add column ocr_pages_done  integer not null default 0,
  add column ocr_confidence  real;
