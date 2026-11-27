import {
  InputLimitError,
  MAX_TEXT_UTF16_LENGTH,
  MAX_TXT_FILE_BYTES,
  validateInputText,
} from '@/application/extraction';

export interface ReadableTxtFile {
  name?: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/**
 * Strictly reads a UTF-8 TXT file locally in the browser.
 * Enforces 2 MiB raw file limit, fatal UTF-8 decoding, and 200k UTF-16 code-unit limit.
 * Never silently truncates invalid or oversized input.
 */
export async function readTxt(file: ReadableTxtFile): Promise<string> {
  if (file.size === 0) {
    throw new InputLimitError('Selected TXT file is empty.');
  }
  if (file.size > MAX_TXT_FILE_BYTES) {
    throw new InputLimitError(
      `File exceeds the 2 MiB size limit (${file.size.toLocaleString('en-US')} bytes). File rejected without truncation.`,
    );
  }

  const buffer = await file.arrayBuffer();
  if (buffer.byteLength > MAX_TXT_FILE_BYTES) {
    throw new InputLimitError(
      `File content exceeds the 2 MiB size limit (${buffer.byteLength.toLocaleString('en-US')} bytes). File rejected without truncation.`,
    );
  }

  const decoder = new TextDecoder('utf-8', { fatal: true });
  let decoded: string;
  try {
    decoded = decoder.decode(buffer);
  } catch {
    throw new InputLimitError(
      'File contains invalid UTF-8 byte sequences and cannot be decoded safely.',
    );
  }

  // Strip optional UTF-8 BOM only if present at offset 0
  if (decoded.charCodeAt(0) === 0xfeff) {
    decoded = decoded.slice(1);
  }

  if (decoded.length > MAX_TEXT_UTF16_LENGTH) {
    throw new InputLimitError(
      `Decoded text exceeds the ${MAX_TEXT_UTF16_LENGTH.toLocaleString('en-US')} UTF-16 character limit.`,
    );
  }

  validateInputText(decoded);
  return decoded;
}
