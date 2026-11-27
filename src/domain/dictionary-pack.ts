import { z } from 'zod';
import { LanguageUseSchema, NonBlankTextSchema, OpaqueIdSchema } from './schema';

export const DICTIONARY_PACK_FORMAT = 'termforge-dictionary-pack';
export const DICTIONARY_PACK_VERSION = 1;
export const MAX_DICTIONARY_PACK_BYTES = 2_097_152;
export const MAX_DICTIONARY_PACK_ENTRIES = 10_000;

export class DictionaryPackValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DictionaryPackValidationError';
  }
}

export const DictionaryPackSourceSchema = z
  .object({
    authority: NonBlankTextSchema,
    uri: NonBlankTextSchema,
    release: NonBlankTextSchema,
    license: NonBlankTextSchema,
  })
  .strict();

export type DictionaryPackSource = z.infer<typeof DictionaryPackSourceSchema>;

export const DictionaryPackEntrySchema = z
  .object({
    id: OpaqueIdSchema,
    text: NonBlankTextSchema,
    language: LanguageUseSchema,
    externalId: OpaqueIdSchema.optional(),
  })
  .strict();

export type DictionaryPackEntry = z.infer<typeof DictionaryPackEntrySchema>;

export const DictionaryPackSchema = z
  .object({
    format: z.literal(DICTIONARY_PACK_FORMAT),
    version: z.literal(DICTIONARY_PACK_VERSION),
    id: OpaqueIdSchema,
    name: NonBlankTextSchema,
    source: DictionaryPackSourceSchema,
    entries: z.array(DictionaryPackEntrySchema).max(MAX_DICTIONARY_PACK_ENTRIES),
  })
  .strict();

export type DictionaryPack = z.infer<typeof DictionaryPackSchema>;

export interface DictionaryPackSuggestion {
  start: number;
  end: number;
  surface: string;
  packId: string;
  packName: string;
  authority: string;
  release: string;
  license: string;
  entries: DictionaryPackEntry[];
  /** Strictly read-only unverified pack suggestion; never canonical known-form or DB write. */
  status: 'unverified-pack-suggestion';
}

export function parseDictionaryPack(input: unknown): DictionaryPack {
  const result = DictionaryPackSchema.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue?.path?.length ? `${issue.path.join('.')}: ` : '';
    throw new DictionaryPackValidationError(
      `Invalid dictionary pack: ${path}${issue?.message ?? 'schema validation failed.'}`,
    );
  }

  const seenIds = new Set<string>();
  for (const entry of result.data.entries) {
    if (seenIds.has(entry.id)) {
      throw new DictionaryPackValidationError(
        `Invalid dictionary pack: duplicate entry ID "${entry.id}". Pack rejected before activation.`,
      );
    }
    seenIds.add(entry.id);
  }

  return result.data;
}

export function parseDictionaryPackJson(
  rawJson: string,
  maxBytes: number = MAX_DICTIONARY_PACK_BYTES,
): DictionaryPack {
  const byteLength = new TextEncoder().encode(rawJson).byteLength;
  if (byteLength > maxBytes) {
    throw new DictionaryPackValidationError(
      `Dictionary pack JSON exceeds the ${maxBytes.toLocaleString('en-US')}-byte limit (${byteLength.toLocaleString('en-US')} bytes provided).`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new DictionaryPackValidationError('Dictionary pack file is not valid JSON.');
  }

  return parseDictionaryPack(parsed);
}
