import {
  DELIMITED_INTAKE_LIMITS,
  DelimitedParseError,
  getSyntheticImportFixtureById,
  parseDelimitedText,
  verifyApprovedSyntheticImportBytes,
  type BlankLinePolicy,
  type DelimitedDelimiter,
  type RawDelimitedStage,
} from '@/domain/delimited-intake';

export interface ReadSyntheticDelimitedFileOptions {
  delimiter: DelimitedDelimiter;
  blankLinePolicy?: BlankLinePolicy;
}

/**
 * Browser File adapter for WP03 E2 delimited intake.
 * Enforces:
 * 1. Pre-read byte bound (`<= 2 MiB`) before reading file buffer;
 * 2. Fatal UTF-8 decoding (`new TextDecoder('utf-8', { fatal: true })`);
 * 3. Exact raw-byte SHA-256 verification against `APPROVED_SYNTHETIC_IMPORT_FIXTURES` before staging;
 * 4. Pure delimited parsing with explicit delimiter (no silent delimiter sniffing).
 */
export async function readSyntheticDelimitedFile(
  file: File,
  options: ReadSyntheticDelimitedFileOptions,
): Promise<RawDelimitedStage> {
  if (file.size > DELIMITED_INTAKE_LIMITS.maxFileBytes) {
    throw new DelimitedParseError(
      `File "${file.name}" (${file.size.toLocaleString('en-US')} bytes) exceeds the 2 MiB (${DELIMITED_INTAKE_LIMITS.maxFileBytes.toLocaleString('en-US')} bytes) maximum limit and was rejected before reading.`,
    );
  }

  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  if (bytes.byteLength > DELIMITED_INTAKE_LIMITS.maxFileBytes) {
    throw new DelimitedParseError(
      `File "${file.name}" (${bytes.byteLength.toLocaleString('en-US')} bytes) exceeds the 2 MiB (${DELIMITED_INTAKE_LIMITS.maxFileBytes.toLocaleString('en-US')} bytes) maximum limit.`,
    );
  }

  let decodedText: string;
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    decodedText = decoder.decode(bytes);
  } catch {
    throw new DelimitedParseError(
      `File "${file.name}" contains malformed UTF-8 byte sequences and cannot be decoded safely.`,
    );
  }

  const { fixture, rawByteSha256 } = await verifyApprovedSyntheticImportBytes(bytes);

  if (options.delimiter !== fixture.delimiter) {
    throw new DelimitedParseError(
      `Approved synthetic fixture "${fixture.name}" requires explicit delimiter ${fixture.delimiter === ',' ? 'comma (",")' : 'tab ("\\t")'}, not ${options.delimiter === ',' ? 'comma (",")' : 'tab ("\\t")'}. No silent delimiter sniffing is performed.`,
    );
  }

  return parseDelimitedText(decodedText, {
    delimiter: options.delimiter,
    blankLinePolicy: options.blankLinePolicy ?? 'skip',
    sourceName: file.name || fixture.filename,
    rawByteLength: bytes.byteLength,
    rawByteSha256,
    approvedFixtureId: fixture.id,
  });
}

/**
 * Built-in synthetic fixture loader for one-click staging or downloadable example verification.
 * Still runs full raw-byte SHA-256 verification and pure delimited parsing.
 */
export async function stageApprovedBuiltInSyntheticFixture(
  fixtureId: string,
  blankLinePolicy: BlankLinePolicy = 'skip',
): Promise<RawDelimitedStage> {
  const fixture = getSyntheticImportFixtureById(fixtureId);
  if (!fixture) {
    throw new DelimitedParseError(`Unknown synthetic import fixture ID "${fixtureId}".`);
  }

  const bytes = new TextEncoder().encode(fixture.rawText);
  const verified = await verifyApprovedSyntheticImportBytes(bytes);

  return parseDelimitedText(fixture.rawText, {
    delimiter: fixture.delimiter,
    blankLinePolicy,
    sourceName: fixture.filename,
    rawByteLength: bytes.byteLength,
    rawByteSha256: verified.rawByteSha256,
    approvedFixtureId: fixture.id,
  });
}
