/** The kinds of file an advocate can upload, shared by the upload screen (what to accept) and the server (what to trust). */
export interface DocKind { id: 'pdf' | 'docx' | 'txt' | 'png' | 'jpg'; label: string; exts: string[]; mime: string }

export const DOC_KINDS: DocKind[] = [
  { id: 'pdf', label: 'PDF', exts: ['pdf'], mime: 'application/pdf' },
  { id: 'docx', label: 'Word', exts: ['docx'], mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  { id: 'txt', label: 'Text', exts: ['txt'], mime: 'text/plain' },
  { id: 'png', label: 'Photo', exts: ['png'], mime: 'image/png' },
  { id: 'jpg', label: 'Photo', exts: ['jpg', 'jpeg'], mime: 'image/jpeg' },
];

export const SUPPORTED_TEXT = 'PDF, Word (.docx), text (.txt) or a photo (.png, .jpg)';
export const ACCEPT = DOC_KINDS.flatMap((k) => [...k.exts.map((e) => `.${e}`), k.mime]).join(',');

const extOf = (name: string) => /\.([a-z0-9]+)$/i.exec(name)?.[1].toLowerCase() ?? '';
export const kindOfName = (name: string): DocKind | undefined => DOC_KINDS.find((k) => k.exts.includes(extOf(name)));
export const kindOfMime = (mime: string): DocKind | undefined => DOC_KINDS.find((k) => k.mime === mime);
export const isImageMime = (mime: string) => mime.startsWith('image/');
export const stripExt = (name: string) => name.replace(/\.[a-z0-9]+$/i, '');
