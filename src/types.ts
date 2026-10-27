/**
 * Shared data model for TypeShift.
 *
 * The comparison model intentionally stores a normalized, syntax-level view of
 * each exported declaration. It is not a resolved TypeScript type model: type
 * text is preserved so changes can be reported without pretending to prove
 * assignability.
 */

export type ApiExportKind =
  | "function"
  | "class"
  | "interface"
  | "type"
  | "enum"
  | "variable"
  | "namespace"
  | "unknown";

export interface TypeParameterInfo {
  name: string;
  constraint: string | null;
  default: string | null;
}

export interface ParameterInfo {
  name: string;
  type: string;
  optional: boolean;
  rest: boolean;
  /**
   * Declaration files erase default values and turn defaulted parameters into
   * optional parameters. This stays false for `.d.ts` input but keeps the
   * model explicit for callers that inspect it.
   */
  hasDefault: boolean;
}

export interface SignatureInfo {
  parameters: ParameterInfo[];
  returnType: string;
  typeParameters: TypeParameterInfo[];
  /** True only for the implicit no-argument constructor of a class. */
  implicit?: boolean;
}

export type MemberKind = "property" | "method";

export interface MemberInfo {
  name: string;
  kind: MemberKind;
  optional: boolean;
  readonly: boolean;
  static: boolean;
  /** Property type, or null for methods. */
  type: string | null;
  /** Method signatures. Empty for properties. */
  signatures: SignatureInfo[];
}

export interface IndexSignatureInfo {
  keyName: string;
  keyType: string;
  valueType: string;
  readonly: boolean;
}

export type HeritageKind = "extends" | "implements";

export interface HeritageInfo {
  kind: HeritageKind;
  text: string;
}

export interface EnumMemberInfo {
  name: string;
  /** String values are JSON-quoted; numeric and computed values are shown as source text. */
  value: string;
}

export interface ApiExport {
  name: string;
  kind: ApiExportKind;
  /** Function signatures, or callable type alias signatures. */
  signatures: SignatureInfo[];
  callSignatures: SignatureInfo[];
  constructSignatures: SignatureInfo[];
  members: MemberInfo[];
  indexSignatures: IndexSignatureInfo[];
  heritage: HeritageInfo[];
  enumMembers: EnumMemberInfo[] | null;
  typeParameters: TypeParameterInfo[];
  /** True for abstract classes; false for every other export kind. */
  abstract: boolean;
  /** Used for variables and non-object type aliases. */
  typeText: string | null;
}

export interface ApiSurface {
  exports: ApiExport[];
}

export type Severity = "breaking" | "compatible";

export type ChangeRule =
  | "export-removed"
  | "export-added"
  | "export-kind-changed"
  | "class-became-abstract"
  | "class-became-concrete"
  | "function-parameter-added-required"
  | "function-parameter-added-optional"
  | "function-parameter-removed"
  | "function-parameter-became-required"
  | "function-parameter-became-optional"
  | "function-parameter-type-changed"
  | "function-parameter-rest-changed"
  | "function-return-type-changed"
  | "function-type-parameters-changed"
  | "overload-removed"
  | "overload-added"
  | "member-removed"
  | "member-added"
  | "member-kind-changed"
  | "member-became-required"
  | "member-became-optional"
  | "member-type-changed"
  | "property-readonly-added"
  | "property-readonly-removed"
  | "constructor-removed"
  | "construct-signature-removed"
  | "construct-signature-added"
  | "call-signature-removed"
  | "call-signature-added"
  | "index-signature-removed"
  | "index-signature-added"
  | "index-signature-type-changed"
  | "index-signature-readonly-added"
  | "index-signature-readonly-removed"
  | "heritage-changed"
  | "type-parameters-changed"
  | "enum-member-removed"
  | "enum-member-added"
  | "enum-value-changed"
  | "type-changed";

export const RULE_LABELS: Record<ChangeRule, string> = {
  "export-removed": "Export removed",
  "export-added": "Export added",
  "export-kind-changed": "Export kind changed",
  "class-became-abstract": "Class became abstract",
  "class-became-concrete": "Class became concrete",
  "function-parameter-added-required": "Required parameter added",
  "function-parameter-added-optional": "Optional parameter added",
  "function-parameter-removed": "Parameter removed",
  "function-parameter-became-required": "Parameter became required",
  "function-parameter-became-optional": "Parameter became optional",
  "function-parameter-type-changed": "Parameter type changed",
  "function-parameter-rest-changed": "Rest parameter changed",
  "function-return-type-changed": "Return type changed",
  "function-type-parameters-changed": "Type parameters changed",
  "overload-removed": "Overload removed",
  "overload-added": "Overload added",
  "member-removed": "Member removed",
  "member-added": "Member added",
  "member-kind-changed": "Member kind changed",
  "member-became-required": "Member became required",
  "member-became-optional": "Member became optional",
  "member-type-changed": "Member type changed",
  "property-readonly-added": "Readonly modifier added",
  "property-readonly-removed": "Readonly modifier removed",
  "constructor-removed": "Constructor removed",
  "construct-signature-removed": "Constructor signature removed",
  "construct-signature-added": "Constructor signature added",
  "call-signature-removed": "Call signature removed",
  "call-signature-added": "Call signature added",
  "index-signature-removed": "Index signature removed",
  "index-signature-added": "Index signature added",
  "index-signature-type-changed": "Index signature type changed",
  "index-signature-readonly-added": "Readonly modifier added",
  "index-signature-readonly-removed": "Readonly modifier removed",
  "heritage-changed": "Heritage changed",
  "type-parameters-changed": "Type parameters changed",
  "enum-member-removed": "Enum member removed",
  "enum-member-added": "Enum member added",
  "enum-value-changed": "Enum value changed",
  "type-changed": "Type changed",
};

export const RULE_SEVERITY: Record<ChangeRule, Severity> = {
  "export-removed": "breaking",
  "export-added": "compatible",
  "export-kind-changed": "breaking",
  "class-became-abstract": "breaking",
  "class-became-concrete": "compatible",
  "function-parameter-added-required": "breaking",
  "function-parameter-added-optional": "compatible",
  "function-parameter-removed": "breaking",
  "function-parameter-became-required": "breaking",
  "function-parameter-became-optional": "compatible",
  "function-parameter-type-changed": "breaking",
  "function-parameter-rest-changed": "breaking",
  "function-return-type-changed": "breaking",
  "function-type-parameters-changed": "breaking",
  "overload-removed": "breaking",
  "overload-added": "compatible",
  "member-removed": "breaking",
  "member-added": "compatible",
  "member-kind-changed": "breaking",
  "member-became-required": "breaking",
  "member-became-optional": "compatible",
  "member-type-changed": "breaking",
  "property-readonly-added": "breaking",
  "property-readonly-removed": "compatible",
  "constructor-removed": "breaking",
  "construct-signature-removed": "breaking",
  "construct-signature-added": "compatible",
  "call-signature-removed": "breaking",
  "call-signature-added": "compatible",
  "index-signature-removed": "breaking",
  "index-signature-added": "compatible",
  "index-signature-type-changed": "breaking",
  "index-signature-readonly-added": "breaking",
  "index-signature-readonly-removed": "compatible",
  "heritage-changed": "breaking",
  "type-parameters-changed": "breaking",
  "enum-member-removed": "breaking",
  "enum-member-added": "compatible",
  "enum-value-changed": "breaking",
  "type-changed": "breaking",
};

/**
 * Type text changes are reported as breaking, but explicitly marked for human
 * review because TypeShift does not attempt full assignability proofs.
 */
export const REVIEW_RULES: ReadonlySet<ChangeRule> = new Set<ChangeRule>([
  "function-parameter-type-changed",
  "function-return-type-changed",
  "function-type-parameters-changed",
  "member-type-changed",
  "index-signature-type-changed",
  "heritage-changed",
  "type-parameters-changed",
  "type-changed",
]);

export interface Change {
  severity: Severity;
  rule: ChangeRule;
  label: string;
  path: string;
  message: string;
  review: boolean;
  before: string | null;
  after: string | null;
}

export type RecommendedBump = "major" | "minor" | "patch" | "none";
export type ActualBump = RecommendedBump | "prerelease";

export interface ComparisonSummary {
  breaking: number;
  compatible: number;
  total: number;
  oldExports: number;
  newExports: number;
  recommendedBump: RecommendedBump;
}

export interface ComparisonResult {
  changes: Change[];
  summary: ComparisonSummary;
}

export interface SourceInfo {
  source: string;
  files: string[];
}

export interface SemverCheck {
  from: string;
  to: string;
  actualBump: ActualBump;
  recommendedBump: RecommendedBump;
  ok: boolean;
  message: string;
}

export interface ReportData {
  schemaVersion: 1;
  tool: {
    name: string;
    version: string;
  };
  old: SourceInfo;
  new: SourceInfo;
  summary: ComparisonSummary;
  changes: Change[];
  semver: SemverCheck | null;
}
