'use client';

import { useRef, useState } from 'react';
import {
  EXPRESSION_ROLES,
  formatLanguageUse,
  isExpressionProtected,
  type Concept,
  type Expression,
  type ExpressionRole,
  type LanguageUse,
  type LibrarySnapshot,
} from '@/domain/schema';
import type { ChangePayload } from '@/domain/changes';

export type LanguageOptionValue = 'en' | 'en-US' | 'en-GB' | 'tr' | 'shared' | 'undetermined';

export function parseLanguageOption(value: LanguageOptionValue): LanguageUse {
  if (value === 'shared') return { kind: 'shared' };
  if (value === 'undetermined') return { kind: 'undetermined' };
  return { kind: 'language', tag: value };
}

export function toLanguageOption(language: LanguageUse): LanguageOptionValue {
  if (language.kind === 'language') return language.tag;
  return language.kind;
}

export type EditorMode =
  | { kind: 'idle' }
  | { kind: 'create-concept' }
  | { kind: 'add-expression'; concept: Concept }
  | { kind: 'edit-expression'; expression: Expression };

interface ConceptEditorProps {
  mode: EditorMode;
  snapshot: LibrarySnapshot;
  disabled: boolean;
  onCancel: () => void;
  onPropose: (payload: ChangePayload) => Promise<void>;
  onValidationError: (message: string) => void;
}

export function ConceptEditor({
  mode,
  snapshot,
  disabled,
  onCancel,
  onPropose,
  onValidationError,
}: ConceptEditorProps) {
  const initialText = mode.kind === 'edit-expression' ? mode.expression.text : '';
  const initialLang: LanguageOptionValue =
    mode.kind === 'edit-expression' ? toLanguageOption(mode.expression.language) : 'en';
  const initialRole: ExpressionRole =
    mode.kind === 'edit-expression' ? mode.expression.role : 'preferred';

  const [text, setText] = useState(initialText);
  const [language, setLanguage] = useState<LanguageOptionValue>(initialLang);
  const [role, setRole] = useState<ExpressionRole>(initialRole);
  const [localError, setLocalError] = useState<string | null>(null);
  const textInputRef = useRef<HTMLInputElement | null>(null);

  if (mode.kind === 'idle') {
    return (
      <section className="panel sticky-panel" aria-labelledby="editor-idle-heading">
        <p className="status-label">EDITOR PANEL</p>
        <h2 id="editor-idle-heading">Terminology actions</h2>
        <p className="muted small">
          Select <strong>New concept</strong> to create a concept and its initial expression
          atomically, or select an existing concept or expression to add bilingual forms, edit
          permitted fields, or record a user-confirmed assertion.
        </p>
        <hr className="divider" />
        <div className="stack-sm small muted">
          <div>• Partial bilingual concepts (EN-only, TR-only, shared) are valid.</div>
          <div>• Identical surface forms (e.g., PD) may belong to separate concepts.</div>
          <div>• Original scientific Unicode, spelling, punctuation, and case are preserved.</div>
          <div>• Every canonical change requires immutable preview and explicit approval.</div>
        </div>
      </section>
    );
  }

  const isProtected =
    mode.kind === 'edit-expression' &&
    isExpressionProtected(mode.expression, snapshot.assertions);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLocalError(null);

    if (text.trim().length === 0) {
      const msg = 'Expression text cannot be empty or whitespace-only.';
      setLocalError(msg);
      onValidationError(msg);
      textInputRef.current?.focus();
      return;
    }

    const now = new Date().toISOString();
    const langUse = parseLanguageOption(language);

    try {
      if (mode.kind === 'create-concept') {
        const conceptId = crypto.randomUUID();
        const expressionId = crypto.randomUUID();
        const provenanceId = crypto.randomUUID();
        await onPropose({
          schemaVersion: 1,
          batchId: crypto.randomUUID(),
          baseLibraryRevision: snapshot.libraryRevision,
          ops: [
            {
              kind: 'createConcept',
              opId: crypto.randomUUID(),
              concept: {
                id: conceptId,
                revision: 0,
                createdAt: now,
                updatedAt: now,
              },
              firstExpression: {
                id: expressionId,
                conceptId,
                revision: 0,
                text,
                language: langUse,
                role,
                createdAt: now,
                updatedAt: now,
              },
              provenance: {
                id: provenanceId,
                expressionId,
                kind: 'manual',
                createdAt: now,
                source: null,
              },
            },
          ],
        });
      } else if (mode.kind === 'add-expression') {
        const expressionId = crypto.randomUUID();
        const provenanceId = crypto.randomUUID();
        await onPropose({
          schemaVersion: 1,
          batchId: crypto.randomUUID(),
          baseLibraryRevision: snapshot.libraryRevision,
          ops: [
            {
              kind: 'addExpression',
              opId: crypto.randomUUID(),
              expectedConceptRevision: mode.concept.revision,
              expression: {
                id: expressionId,
                conceptId: mode.concept.id,
                revision: 0,
                text,
                language: langUse,
                role,
                createdAt: now,
                updatedAt: now,
              },
              provenance: {
                id: provenanceId,
                expressionId,
                kind: 'manual',
                createdAt: now,
                source: null,
              },
            },
          ],
        });
      } else {
        await onPropose({
          schemaVersion: 1,
          batchId: crypto.randomUUID(),
          baseLibraryRevision: snapshot.libraryRevision,
          ops: [
            {
              kind: 'editExpression',
              opId: crypto.randomUUID(),
              id: mode.expression.id,
              expectedRevision: mode.expression.revision,
              text,
              language: langUse,
              role,
            },
          ],
        });
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unable to construct change proposal.';
      setLocalError(msg);
      onValidationError(msg);
      textInputRef.current?.focus();
    }
  };

  const title =
    mode.kind === 'create-concept'
      ? 'Create concept with initial expression'
      : mode.kind === 'add-expression'
        ? `Add expression to concept ${mode.concept.id.slice(0, 8)}`
        : `Edit expression "${mode.expression.text}"`;

  const textLabel =
    mode.kind === 'create-concept' ? 'Initial expression text' : 'Expression text';
  const langLabel =
    mode.kind === 'create-concept' ? 'Language' : 'Expression language';
  const roleLabel =
    mode.kind === 'create-concept' ? 'Role' : 'Expression role';

  return (
    <section className="panel sticky-panel" aria-labelledby="editor-form-heading">
      <p className="status-label">
        {mode.kind === 'create-concept'
          ? 'NEW CONCEPT'
          : mode.kind === 'add-expression'
            ? 'ADD EXPRESSION'
            : 'EDIT EXPRESSION'}
      </p>
      <h2 id="editor-form-heading">{title}</h2>

      {isProtected && (
        <div className="banner banner-warning">
          <strong>User-confirmed protection active:</strong> Text (
          <span className="mono">{mode.expression.text}</span>) and language (
          <span className="mono">{formatLanguageUse(mode.expression.language)}</span>) are bound by
          an explicit user-confirmed assertion. Changing text or language will be rejected by the
          write gateway; role metadata remains editable.
        </div>
      )}

      {localError && (
        <div className="banner banner-error" role="alert">
          {localError}
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate className="stack-md">
        <div className="field">
          <label htmlFor="editor-text-input">{textLabel}</label>
          <input
            ref={textInputRef}
            id="editor-text-input"
            type="text"
            className="input"
            value={text}
            onChange={(event) => setText(event.target.value)}
            disabled={disabled}
            placeholder="e.g., TNF-α, tümör nekroz faktörü alfa, CD4+, PD"
            autoComplete="off"
          />
        </div>

        <div className="form-grid">
          <div className="field">
            <label htmlFor="editor-language-select">{langLabel}</label>
            <select
              id="editor-language-select"
              className="select"
              value={language}
              onChange={(event) => setLanguage(event.target.value as LanguageOptionValue)}
              disabled={disabled}
            >
              <option value="en">English (en)</option>
              <option value="en-US">English US (en-US)</option>
              <option value="en-GB">English UK (en-GB)</option>
              <option value="tr">Turkish (tr)</option>
              <option value="shared">Shared (notation/symbol)</option>
              <option value="undetermined">Undetermined</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor="editor-role-select">{roleLabel}</label>
            <select
              id="editor-role-select"
              className="select"
              value={role}
              onChange={(event) => setRole(event.target.value as ExpressionRole)}
              disabled={disabled}
            >
              {EXPRESSION_ROLES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>
        </div>

        <p className="muted small" style={{ margin: 0 }}>
          Role &ldquo;preferred&rdquo; is a local editorial designation, not independent scientific
          verification.
        </p>

        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={disabled}>
            Preview change
          </button>
          <button type="button" className="btn" onClick={onCancel} disabled={disabled}>
            Close editor
          </button>
        </div>
      </form>
    </section>
  );
}
