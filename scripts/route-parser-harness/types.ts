// Phase 5: parser harness fixture types. Lives outside src/ so nothing here
// is ever bundled into the React Native app.

export type FixtureKind = 'text' | 'csv' | 'pdf';

export interface FixtureExpect {
  minValid?: number;
  maxValid?: number;
  minNeedsReview?: number;
  maxNeedsReview?: number;
  minInvalid?: number;
  maxInvalid?: number;
  /** Each substring must appear in at least one valid OR needs_review address. */
  addressContains?: string[];
  /** None of these substrings may appear in any VALID address. */
  noValidContains?: string[];
  /** Each value must appear in at least one stop's matching field across valid + needs_review. */
  fieldsContain?: {
    customer_name?: string[];
    access_code?: string[];
    notes?: string[];
    pickup_type?: string[];
  };
}

export interface Fixture {
  name: string;
  description: string;
  kind: FixtureKind;
  input: string;
  expect: FixtureExpect;
}
