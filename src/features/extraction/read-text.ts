import {
  InputLimitError,
  validateInputText,
} from '@/application/extraction';
import {
  DEFAULT_PROCESSING_LIMITS,
  parseProcessingLimits,
  type ProcessingLimits,
} from '@/domain/processing-limits';

export interface ReadableTxtFile {
  name?: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/**
 * Strictly reads a UTF-8 TXT file locally in the browser.
 * Enforces configured byte and UTF-16 limits within authorized hard ceilings, with fatal UTF-8 decoding.
 * Never silently truncates invalid or oversized input.
 */
export async function readTxt(
  file: ReadableTxtFile,
  limits: ProcessingLimits = DEFAULT_PROCESSING_LIMITS,
): Promise<string> {
  limits = parseProcessingLimits(limits);
  if (file.size === 0) {
    throw new InputLimitError('Selected TXT file is empty.');
  }
  if (file.size > limits.maxTxtInputBytes) {
    throw new InputLimitError(
      `File exceeds the ${limits.maxTxtInputBytes.toLocaleString('en-US')} byte size limit (${file.size.toLocaleString('en-US')} bytes). File rejected without truncation.`,
    );
  }

  const buffer = await file.arrayBuffer();
  if (buffer.byteLength > limits.maxTxtInputBytes) {
    throw new InputLimitError(
      `File content exceeds the ${limits.maxTxtInputBytes.toLocaleString('en-US')} byte size limit (${buffer.byteLength.toLocaleString('en-US')} bytes). File rejected without truncation.`,
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

  if (decoded.length > limits.maxTextUtf16CodeUnits) {
    throw new InputLimitError(
      `Decoded text exceeds the ${limits.maxTextUtf16CodeUnits.toLocaleString('en-US')} UTF-16 character limit.`,
    );
  }

  validateInputText(decoded, limits);
  return decoded;
}
