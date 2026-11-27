import {
  MAX_DICTIONARY_PACK_BYTES,
  parseDictionaryPackJson,
  type DictionaryPack,
} from '@/domain/dictionary-pack';
import { verifyApprovedSyntheticDictionaryPack } from '@/domain/synthetic-dictionary-manifest';

export interface DictionaryPackFile {
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/**
 * Enforces the pack byte ceiling before reading, rejects malformed UTF-8, validates
 * the v1 DictionaryPack schema, and verifies exact canonical SHA-256 content digest
 * against the immutable project-owned synthetic fixture manifest (QC01).
 */
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
  const pack = parseDictionaryPackJson(raw);
  await verifyApprovedSyntheticDictionaryPack(pack);
  return pack;
}
