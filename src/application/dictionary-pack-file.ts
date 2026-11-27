import {
  MAX_DICTIONARY_PACK_BYTES,
  parseDictionaryPackJson,
  type DictionaryPack,
} from '@/domain/dictionary-pack';

export interface DictionaryPackFile {
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** Enforce the pack byte ceiling before reading and reject malformed UTF-8. */
export async function readDictionaryPackFile(file: DictionaryPackFile): Promise<DictionaryPack> {
  if (file.size > MAX_DICTIONARY_PACK_BYTES) {
    throw new Error(
      `Dictionary pack exceeds the ${MAX_DICTIONARY_PACK_BYTES.toLocaleString('en-US')}-byte limit and was rejected without reading.`,
    );
  }
  const buffer = await file.arrayBuffer();
  if (buffer.byteLength > MAX_DICTIONARY_PACK_BYTES) {
    throw new Error(
      `Dictionary pack content exceeds the ${MAX_DICTIONARY_PACK_BYTES.toLocaleString('en-US')}-byte limit and was rejected without parsing.`,
    );
  }

  let raw: string;
  try {
    raw = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw new Error('Dictionary pack contains invalid UTF-8 and was rejected.');
  }
  return parseDictionaryPackJson(raw);
}
