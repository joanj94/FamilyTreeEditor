/**
 * The schema gate.
 *
 * Nothing is written out unless the document validates against `schema/gedcom7.schema.json` *and*
 * the audit is clean. This module is the first half; `audit()` -- referential integrity, which a
 * schema cannot check -- is the second. Both run before export, never after: a lossy file that has
 * already been handed to the user cannot be un-handed.
 *
 * What the schema does and does not catch is worth being clear about. It checks shape: that a tag
 * is one the standard defines, that an identifier matches the standard's grammar, that a date
 * carries the payload it was built from. It cannot check that `@I1@` in a family's `children`
 * refers to a record that exists, nor that a person listed as a child of two families is not the
 * same person twice. Those are the audit's, and passing here is not passing both.
 *
 * Errors are reported with the observed value against the expected one: "invalid document" tells
 * a user nothing they can act on.
 */
import Ajv2020 from 'ajv/dist/2020.js';
import type { ErrorObject, ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';

import schema from '../../schema/gedcom7.schema.json' with { type: 'json' };
import type { GedcomDoc } from './types.js';

export { schema };

/** A single schema violation, flattened into something a UI can render without knowing ajv. */
export interface ValidationError {
  /** JSON Pointer to the offending value, e.g. `/persons/12/id`. */
  readonly path: string;
  readonly message: string;
  /** The value actually found at `path`, when ajv could resolve one. */
  readonly observed: unknown;
}

export type ValidationResult =
  | { readonly ok: true; readonly doc: GedcomDoc }
  | { readonly ok: false; readonly errors: readonly ValidationError[] };

function buildValidator(): ValidateFunction {
  const ajv = new Ajv2020({ allErrors: true, strict: true, verbose: true });
  addFormats(ajv);
  return ajv.compile(schema);
}

/**
 * Compiling the schema costs a few milliseconds and is pure, so it is done once and reused.
 * Deferred rather than done at module load so that importing the types does not pay for it.
 */
let validator: ValidateFunction | undefined;

function getValidator(): ValidateFunction {
  validator ??= buildValidator();
  return validator;
}

function toValidationError(error: ErrorObject): ValidationError {
  return {
    path: error.instancePath === '' ? '/' : error.instancePath,
    message: error.message ?? 'failed schema constraint',
    // `verbose: true` attaches the failing value; without it the caller only learns where.
    observed: (error as ErrorObject & { data?: unknown }).data,
  };
}

/** Validate an unknown value against the contract, narrowing it to `GedcomDoc` on success. */
export function validateDoc(value: unknown): ValidationResult {
  const validate = getValidator();
  if (validate(value)) {
    return { ok: true, doc: value as GedcomDoc };
  }
  const errors = (validate.errors ?? []).map(toValidationError);
  return { ok: false, errors };
}

/**
 * Validate or throw. Use at boundaries where continuing with an invalid document would corrupt
 * something -- the export path, and loading a tree back out of storage.
 */
export function assertValidDoc(value: unknown): GedcomDoc {
  const result = validateDoc(value);
  if (result.ok) return result.doc;

  const detail = result.errors
    .slice(0, 10)
    .map((e) => `  ${e.path}: ${e.message} (observed: ${JSON.stringify(e.observed)})`)
    .join('\n');
  const more = result.errors.length > 10 ? `\n  ...and ${result.errors.length - 10} more` : '';
  throw new Error(
    `Document does not satisfy gedcom7.schema.json (${result.errors.length} error(s)):\n${detail}${more}`,
  );
}
