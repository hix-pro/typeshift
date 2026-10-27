import { recommendBump } from "./semver";
import type {
  ApiExport,
  ApiSurface,
  Change,
  ChangeRule,
  ComparisonResult,
  HeritageInfo,
  IndexSignatureInfo,
  MemberInfo,
  ParameterInfo,
  SignatureInfo,
  TypeParameterInfo,
} from "./types";
import { REVIEW_RULES, RULE_LABELS, RULE_SEVERITY } from "./types";

interface SignatureSetRules {
  removed: ChangeRule;
  added: ChangeRule;
  noun: string;
}

/**
 * Compares two normalized API surfaces.
 *
 * Type text changes are deliberately treated as breaking and flagged for
 * review. This tool does not attempt to prove full TypeScript assignability.
 */
export function compareSurfaces(
  oldSurface: ApiSurface,
  newSurface: ApiSurface,
): ComparisonResult {
  const oldExports = new Map(
    oldSurface.exports.map((exported) => [exported.name, exported]),
  );
  const newExports = new Map(
    newSurface.exports.map((exported) => [exported.name, exported]),
  );
  const names = [...new Set([...oldExports.keys(), ...newExports.keys()])].sort(
    compareStrings,
  );

  const changes: Change[] = [];
  for (const name of names) {
    const oldExport = oldExports.get(name);
    const newExport = newExports.get(name);
    if (oldExport === undefined) {
      addChange(
        changes,
        "export-added",
        name,
        `Export "${name}" was added.`,
        null,
        newExport?.kind ?? null,
      );
      continue;
    }
    if (newExport === undefined) {
      addChange(
        changes,
        "export-removed",
        name,
        `Export "${name}" was removed.`,
        oldExport.kind,
        null,
      );
      continue;
    }
    compareExport(oldExport, newExport, changes);
  }

  changes.sort(compareChanges);

  const breaking = changes.filter(
    (change) => change.severity === "breaking",
  ).length;
  const compatible = changes.length - breaking;
  const recommendedBump = recommendBump(breaking, compatible);

  return {
    changes,
    summary: {
      breaking,
      compatible,
      total: changes.length,
      oldExports: oldSurface.exports.length,
      newExports: newSurface.exports.length,
      recommendedBump,
    },
  };
}

function compareExport(
  oldExport: ApiExport,
  newExport: ApiExport,
  changes: Change[],
): void {
  if (oldExport.kind !== newExport.kind) {
    addChange(
      changes,
      "export-kind-changed",
      oldExport.name,
      `Export "${oldExport.name}" changed kind from ${oldExport.kind} to ${newExport.kind}.`,
      oldExport.kind,
      newExport.kind,
    );
    return;
  }

  if (oldExport.kind === "class" && oldExport.abstract !== newExport.abstract) {
    if (newExport.abstract) {
      addChange(
        changes,
        "class-became-abstract",
        oldExport.name,
        `Class "${oldExport.name}" became abstract; consumers can no longer instantiate it directly.`,
        "concrete",
        "abstract",
      );
    } else {
      addChange(
        changes,
        "class-became-concrete",
        oldExport.name,
        `Class "${oldExport.name}" is no longer abstract and can now be instantiated.`,
        "abstract",
        "concrete",
      );
    }
  }

  if (
    oldExport.kind === "class" ||
    oldExport.kind === "interface" ||
    oldExport.kind === "type"
  ) {
    compareTypeParameters(
      oldExport.typeParameters,
      newExport.typeParameters,
      `${oldExport.name}.typeParameters`,
      oldExport.name,
      "type-parameters-changed",
      changes,
    );
  }

  switch (oldExport.kind) {
    case "function":
      compareSignatureSets(
        oldExport.signatures,
        newExport.signatures,
        oldExport.name,
        { removed: "overload-removed", added: "overload-added", noun: "overload" },
        changes,
      );
      return;
    case "class":
      compareClassConstructors(oldExport, newExport, changes);
      compareMembers(oldExport, newExport, changes);
      compareHeritage(oldExport, newExport, changes);
      return;
    case "interface":
      compareObjectShape(oldExport, newExport, changes);
      compareHeritage(oldExport, newExport, changes);
      return;
    case "type":
      compareTypeAlias(oldExport, newExport, changes);
      return;
    case "enum":
      compareEnums(oldExport, newExport, changes);
      return;
    case "variable":
      compareTypeTexts(
        oldExport.typeText,
        newExport.typeText,
        oldExport.name,
        `exported variable "${oldExport.name}"`,
        changes,
      );
      return;
    case "namespace":
      return;
    case "unknown":
      compareTypeTexts(
        oldExport.typeText,
        newExport.typeText,
        oldExport.name,
        `export "${oldExport.name}"`,
        changes,
      );
      return;
  }
}

function compareClassConstructors(
  oldExport: ApiExport,
  newExport: ApiExport,
  changes: Change[],
): void {
  const oldSignatures = oldExport.constructSignatures;
  const newSignatures = newExport.constructSignatures;
  if (oldSignatures.length === 0 && newSignatures.length === 0) return;

  const oldImplicit = isImplicitConstructorSet(oldSignatures);
  const newImplicit = isImplicitConstructorSet(newSignatures);
  if (oldImplicit && newImplicit) return;

  const path = `${oldExport.name}.constructor`;
  if (oldSignatures.length === 0) {
    compareSignatureSets(
      [],
      newSignatures,
      path,
      {
        removed: "construct-signature-removed",
        added: "construct-signature-added",
        noun: "constructor signature",
      },
      changes,
    );
    return;
  }

  if (newSignatures.length === 0) {
    addChange(
      changes,
      "constructor-removed",
      path,
      `Public constructor removed from class "${oldExport.name}".`,
      "public constructor",
      null,
    );
    return;
  }

  if (oldImplicit) {
    compareSignatureSets(
      oldSignatures,
      newSignatures,
      path,
      {
        removed: "construct-signature-removed",
        added: "construct-signature-added",
        noun: "constructor signature",
      },
      changes,
    );
    return;
  }

  if (newImplicit) {
    const onlyOldSignature = oldSignatures[0];
    const equivalentImplicitConstructor =
      oldSignatures.length === 1 &&
      onlyOldSignature !== undefined &&
      onlyOldSignature.parameters.length === 0 &&
      onlyOldSignature.typeParameters.length === 0;
    if (equivalentImplicitConstructor) return;

    addChange(
      changes,
      "constructor-removed",
      path,
      `Explicit constructor removed from class "${oldExport.name}"; instances now use the implicit no-argument constructor.`,
      onlyOldSignature !== undefined
        ? formatSignature(onlyOldSignature)
        : null,
      "implicit constructor",
    );
    return;
  }

  compareSignatureSets(
    oldSignatures,
    newSignatures,
    path,
    {
      removed: "construct-signature-removed",
      added: "construct-signature-added",
      noun: "constructor signature",
    },
    changes,
  );
}

function compareObjectShape(
  oldExport: ApiExport,
  newExport: ApiExport,
  changes: Change[],
): void {
  compareMembers(oldExport, newExport, changes);
  compareSignatureSets(
    oldExport.callSignatures,
    newExport.callSignatures,
    oldExport.name,
    { removed: "call-signature-removed", added: "call-signature-added", noun: "call signature" },
    changes,
  );
  compareSignatureSets(
    oldExport.constructSignatures,
    newExport.constructSignatures,
    oldExport.name,
    {
      removed: "construct-signature-removed",
      added: "construct-signature-added",
      noun: "construct signature",
    },
    changes,
  );
  compareIndexSignatures(oldExport, newExport, changes);
}

function compareTypeAlias(
  oldExport: ApiExport,
  newExport: ApiExport,
  changes: Change[],
): void {
  compareSignatureSets(
    oldExport.signatures,
    newExport.signatures,
    oldExport.name,
    { removed: "overload-removed", added: "overload-added", noun: "signature" },
    changes,
  );
  compareMembers(oldExport, newExport, changes);
  compareSignatureSets(
    oldExport.callSignatures,
    newExport.callSignatures,
    oldExport.name,
    { removed: "call-signature-removed", added: "call-signature-added", noun: "call signature" },
    changes,
  );
  compareSignatureSets(
    oldExport.constructSignatures,
    newExport.constructSignatures,
    oldExport.name,
    {
      removed: "construct-signature-removed",
      added: "construct-signature-added",
      noun: "construct signature",
    },
    changes,
  );
  compareIndexSignatures(oldExport, newExport, changes);

  if (oldExport.typeText !== null || newExport.typeText !== null) {
    compareTypeTexts(
      oldExport.typeText ?? "object type",
      newExport.typeText ?? "object type",
      oldExport.name,
      `type "${oldExport.name}"`,
      changes,
    );
  }
}

function compareMembers(
  oldExport: ApiExport,
  newExport: ApiExport,
  changes: Change[],
): void {
  const oldMembers = new Map(
    oldExport.members.map((member) => [memberMapKey(member), member]),
  );
  const newMembers = new Map(
    newExport.members.map((member) => [memberMapKey(member), member]),
  );
  const keys = [...new Set([...oldMembers.keys(), ...newMembers.keys()])].sort(
    compareStrings,
  );

  for (const key of keys) {
    const oldMember = oldMembers.get(key);
    const newMember = newMembers.get(key);
    const path = oldMember
      ? memberPath(oldExport.name, oldMember)
      : memberPath(newExport.name, newMember as MemberInfo);

    if (oldMember === undefined) {
      addChange(
        changes,
        "member-added",
        path,
        `${capitalize(describeMember(newMember as MemberInfo))} was added.`,
        null,
        describeMember(newMember as MemberInfo),
      );
      continue;
    }

    if (newMember === undefined) {
      addChange(
        changes,
        "member-removed",
        path,
        `${capitalize(describeMember(oldMember))} was removed.`,
        describeMember(oldMember),
        null,
      );
      continue;
    }

    if (oldMember.kind !== newMember.kind) {
      addChange(
        changes,
        "member-kind-changed",
        path,
        `"${path}" changed from ${oldMember.kind} to ${newMember.kind}.`,
        oldMember.kind,
        newMember.kind,
      );
      continue;
    }

    if (oldMember.optional && !newMember.optional) {
      addChange(
        changes,
        "member-became-required",
        path,
        `${capitalize(describeMember(oldMember))} changed from optional to required.`,
        "optional",
        "required",
      );
    } else if (!oldMember.optional && newMember.optional) {
      addChange(
        changes,
        "member-became-optional",
        path,
        `${capitalize(describeMember(oldMember))} changed from required to optional.`,
        "required",
        "optional",
      );
    }

    if (oldMember.kind === "property") {
      if (!oldMember.readonly && newMember.readonly) {
        addChange(
          changes,
          "property-readonly-added",
          path,
          `Readonly modifier added to property "${path}".`,
          "mutable",
          "readonly",
        );
      } else if (oldMember.readonly && !newMember.readonly) {
        addChange(
          changes,
          "property-readonly-removed",
          path,
          `Readonly modifier removed from property "${path}".`,
          "readonly",
          "mutable",
        );
      }

      const oldType = oldMember.type ?? "unknown";
      const newType = newMember.type ?? "unknown";
      if (oldType !== newType) {
        addChange(
          changes,
          "member-type-changed",
          path,
          `Type of property "${path}" changed from ${quoteType(oldType)} to ${quoteType(newType)}; assignability was not proven.`,
          oldType,
          newType,
        );
      }
    } else {
      compareSignatureSets(
        oldMember.signatures,
        newMember.signatures,
        path,
        { removed: "overload-removed", added: "overload-added", noun: "overload" },
        changes,
      );
    }
  }
}

function compareIndexSignatures(
  oldExport: ApiExport,
  newExport: ApiExport,
  changes: Change[],
): void {
  const oldByIdentity = indexSignatureMap(oldExport.indexSignatures);
  const newByIdentity = indexSignatureMap(newExport.indexSignatures);
  const keys = [
    ...new Set([...oldByIdentity.keys(), ...newByIdentity.keys()]),
  ].sort(compareStrings);

  for (const key of keys) {
    const oldSignature = oldByIdentity.get(key);
    const newSignature = newByIdentity.get(key);
    const path = `${oldExport.name}.index(${key})`;

    if (oldSignature === undefined) {
      addChange(
        changes,
        "index-signature-added",
        path,
        `Index signature [${key}] was added.`,
        null,
        formatIndexSignature(newSignature as IndexSignatureInfo),
      );
      continue;
    }

    if (newSignature === undefined) {
      addChange(
        changes,
        "index-signature-removed",
        path,
        `Index signature [${key}] was removed.`,
        formatIndexSignature(oldSignature),
        null,
      );
      continue;
    }

    if (!oldSignature.readonly && newSignature.readonly) {
      addChange(
        changes,
        "index-signature-readonly-added",
        path,
        `Readonly modifier added to index signature [${key}].`,
        "mutable",
        "readonly",
      );
    } else if (oldSignature.readonly && !newSignature.readonly) {
      addChange(
        changes,
        "index-signature-readonly-removed",
        path,
        `Readonly modifier removed from index signature [${key}].`,
        "readonly",
        "mutable",
      );
    }

    if (oldSignature.valueType !== newSignature.valueType) {
      addChange(
        changes,
        "index-signature-type-changed",
        path,
        `Value type of index signature [${key}] changed from ${quoteType(oldSignature.valueType)} to ${quoteType(newSignature.valueType)}; assignability was not proven.`,
        oldSignature.valueType,
        newSignature.valueType,
      );
    }
  }
}

function compareSignatureSets(
  oldSignatures: SignatureInfo[],
  newSignatures: SignatureInfo[],
  pathBase: string,
  rules: SignatureSetRules,
  changes: Change[],
): void {
  if (oldSignatures.length === 0 && newSignatures.length === 0) return;

  const oldMatched = new Set<number>();
  const newMatched = new Set<number>();
  for (let oldIndex = 0; oldIndex < oldSignatures.length; oldIndex += 1) {
    const oldSignature = oldSignatures[oldIndex];
    if (oldSignature === undefined) continue;
    const oldKey = signatureKey(oldSignature);
    for (let newIndex = 0; newIndex < newSignatures.length; newIndex += 1) {
      if (newMatched.has(newIndex)) continue;
      const newSignature = newSignatures[newIndex];
      if (newSignature === undefined) continue;
      if (signatureKey(newSignature) !== oldKey) continue;
      oldMatched.add(oldIndex);
      newMatched.add(newIndex);
      break;
    }
  }

  const oldRemaining = oldSignatures
    .map((_signature, index) => index)
    .filter((index) => !oldMatched.has(index));
  const newRemaining = newSignatures
    .map((_signature, index) => index)
    .filter((index) => !newMatched.has(index));

  const pairCount = Math.min(oldRemaining.length, newRemaining.length);
  const overloaded = oldSignatures.length > 1 || newSignatures.length > 1;
  for (let pairIndex = 0; pairIndex < pairCount; pairIndex += 1) {
    const oldIndex = oldRemaining[pairIndex];
    const newIndex = newRemaining[pairIndex];
    if (oldIndex === undefined || newIndex === undefined) continue;
    const oldSignature = oldSignatures[oldIndex];
    const newSignature = newSignatures[newIndex];
    if (oldSignature === undefined || newSignature === undefined) continue;
    const signaturePath = overloaded
      ? `${pathBase} (${rules.noun} ${oldIndex + 1})`
      : pathBase;
    compareSignatureDetailed(
      oldSignature,
      newSignature,
      signaturePath,
      changes,
    );
  }

  for (let index = pairCount; index < oldRemaining.length; index += 1) {
    const oldIndex = oldRemaining[index];
    if (oldIndex === undefined) continue;
    const oldSignature = oldSignatures[oldIndex];
    if (oldSignature === undefined) continue;
    const signaturePath = `${pathBase} (${rules.noun} ${oldIndex + 1})`;
    addChange(
      changes,
      rules.removed,
      signaturePath,
      `${capitalize(rules.noun)} ${oldIndex + 1} of "${pathBase}" was removed.`,
      formatSignature(oldSignature),
      null,
    );
  }

  for (let index = pairCount; index < newRemaining.length; index += 1) {
    const newIndex = newRemaining[index];
    if (newIndex === undefined) continue;
    const newSignature = newSignatures[newIndex];
    if (newSignature === undefined) continue;
    const signaturePath = `${pathBase} (${rules.noun} ${newIndex + 1})`;
    addChange(
      changes,
      rules.added,
      signaturePath,
      `${capitalize(rules.noun)} ${newIndex + 1} of "${pathBase}" was added.`,
      null,
      formatSignature(newSignature),
    );
  }
}

function compareSignatureDetailed(
  oldSignature: SignatureInfo,
  newSignature: SignatureInfo,
  signaturePath: string,
  changes: Change[],
): void {
  const parameterCount = Math.max(
    oldSignature.parameters.length,
    newSignature.parameters.length,
  );

  for (let index = 0; index < parameterCount; index += 1) {
    const oldParameter = oldSignature.parameters[index];
    const newParameter = newSignature.parameters[index];

    if (oldParameter === undefined && newParameter !== undefined) {
      const optional =
        newParameter.optional || newParameter.hasDefault || newParameter.rest;
      const path = `${signaturePath}(${newParameter.name})`;
      addChange(
        changes,
        optional
          ? "function-parameter-added-optional"
          : "function-parameter-added-required",
        path,
        `Parameter "${newParameter.name}" was added and is ${optional ? "optional" : "required"}.`,
        null,
        parameterDisplay(newParameter),
      );
      continue;
    }

    if (newParameter === undefined && oldParameter !== undefined) {
      const path = `${signaturePath}(${oldParameter.name})`;
      addChange(
        changes,
        "function-parameter-removed",
        path,
        `Parameter "${oldParameter.name}" was removed.`,
        parameterDisplay(oldParameter),
        null,
      );
      continue;
    }

    if (oldParameter === undefined || newParameter === undefined) continue;
    const path = `${signaturePath}(${oldParameter.name})`;

    if (oldParameter.rest !== newParameter.rest) {
      addChange(
        changes,
        "function-parameter-rest-changed",
        path,
        `Parameter "${oldParameter.name}" changed from ${oldParameter.rest ? "a rest parameter" : "a regular parameter"} to ${newParameter.rest ? "a rest parameter" : "a regular parameter"}.`,
        oldParameter.rest ? "rest" : "regular",
        newParameter.rest ? "rest" : "regular",
      );
    }

    if (oldParameter.type !== newParameter.type) {
      addChange(
        changes,
        "function-parameter-type-changed",
        path,
        `Parameter "${oldParameter.name}" type changed from ${quoteType(oldParameter.type)} to ${quoteType(newParameter.type)}; assignability was not proven.`,
        oldParameter.type,
        newParameter.type,
      );
    }

    if (oldParameter.optional && !newParameter.optional) {
      addChange(
        changes,
        "function-parameter-became-required",
        path,
        `Parameter "${oldParameter.name}" changed from optional to required.`,
        "optional",
        "required",
      );
    } else if (!oldParameter.optional && newParameter.optional) {
      addChange(
        changes,
        "function-parameter-became-optional",
        path,
        `Parameter "${oldParameter.name}" changed from required to optional.`,
        "required",
        "optional",
      );
    }
  }

  if (oldSignature.returnType !== newSignature.returnType) {
    addChange(
      changes,
      "function-return-type-changed",
      `${signaturePath}.return`,
      `Return type changed from ${quoteType(oldSignature.returnType || "unknown")} to ${quoteType(newSignature.returnType || "unknown")}; assignability was not proven.`,
      oldSignature.returnType || null,
      newSignature.returnType || null,
    );
  }

  if (
    formatTypeParameters(oldSignature.typeParameters) !==
    formatTypeParameters(newSignature.typeParameters)
  ) {
    addChange(
      changes,
      "function-type-parameters-changed",
      `${signaturePath}.typeParameters`,
      `Type parameters changed from ${quoteType(formatTypeParameters(oldSignature.typeParameters) || "none")} to ${quoteType(formatTypeParameters(newSignature.typeParameters) || "none")}; assignability was not proven.`,
      formatTypeParameters(oldSignature.typeParameters) || null,
      formatTypeParameters(newSignature.typeParameters) || null,
    );
  }
}

function compareTypeParameters(
  oldParameters: TypeParameterInfo[],
  newParameters: TypeParameterInfo[],
  path: string,
  exportName: string,
  rule: "type-parameters-changed" | "function-type-parameters-changed",
  changes: Change[],
): void {
  const oldText = formatTypeParameters(oldParameters);
  const newText = formatTypeParameters(newParameters);
  if (oldText === newText) return;
  addChange(
    changes,
    rule,
    path,
    `Type parameters of "${exportName}" changed from ${quoteType(oldText || "none")} to ${quoteType(newText || "none")}; assignability was not proven.`,
    oldText || null,
    newText || null,
  );
}

function compareHeritage(
  oldExport: ApiExport,
  newExport: ApiExport,
  changes: Change[],
): void {
  const oldHeritage = heritageMap(oldExport.heritage);
  const newHeritage = heritageMap(newExport.heritage);
  const keys = [...new Set([...oldHeritage.keys(), ...newHeritage.keys()])].sort(
    compareStrings,
  );

  for (const key of keys) {
    const oldEntry = oldHeritage.get(key);
    const newEntry = newHeritage.get(key);
    const path = `${oldExport.name}.heritage`;

    if (oldEntry === undefined && newEntry !== undefined) {
      addChange(
        changes,
        "heritage-changed",
        path,
        `Heritage entry "${newEntry.text}" (${newEntry.kind}) was added; inherited API changes were not proven safe.`,
        null,
        newEntry.text,
      );
      continue;
    }

    if (newEntry === undefined && oldEntry !== undefined) {
      addChange(
        changes,
        "heritage-changed",
        path,
        `Heritage entry "${oldEntry.text}" (${oldEntry.kind}) was removed.`,
        oldEntry.text,
        null,
      );
    }
  }
}

function compareEnums(
  oldExport: ApiExport,
  newExport: ApiExport,
  changes: Change[],
): void {
  const oldMembers = new Map(
    (oldExport.enumMembers ?? []).map((member) => [member.name, member.value]),
  );
  const newMembers = new Map(
    (newExport.enumMembers ?? []).map((member) => [member.name, member.value]),
  );
  const names = [...new Set([...oldMembers.keys(), ...newMembers.keys()])].sort(
    compareStrings,
  );

  for (const name of names) {
    const oldValue = oldMembers.get(name);
    const newValue = newMembers.get(name);
    const path = `${oldExport.name}.${name}`;
    if (oldValue === undefined && newValue !== undefined) {
      addChange(
        changes,
        "enum-member-added",
        path,
        `Enum member "${path}" was added with value ${newValue}.`,
        null,
        newValue,
      );
    } else if (newValue === undefined && oldValue !== undefined) {
      addChange(
        changes,
        "enum-member-removed",
        path,
        `Enum member "${path}" was removed.`,
        oldValue,
        null,
      );
    } else if (oldValue !== undefined && newValue !== undefined && oldValue !== newValue) {
      addChange(
        changes,
        "enum-value-changed",
        path,
        `Enum member "${path}" changed value from ${oldValue} to ${newValue}.`,
        oldValue,
        newValue,
      );
    }
  }
}

function compareTypeTexts(
  oldType: string | null,
  newType: string | null,
  path: string,
  subject: string,
  changes: Change[],
): void {
  if (oldType === newType) return;
  const before = oldType ?? "unknown";
  const after = newType ?? "unknown";
  addChange(
    changes,
    "type-changed",
    path,
    `Type of ${subject} changed from ${quoteType(before)} to ${quoteType(after)}; assignability was not proven.`,
    oldType,
    newType,
  );
}

function addChange(
  changes: Change[],
  rule: ChangeRule,
  path: string,
  message: string,
  before: string | null,
  after: string | null,
): void {
  changes.push({
    severity: RULE_SEVERITY[rule],
    rule,
    label: RULE_LABELS[rule],
    path,
    message,
    review: REVIEW_RULES.has(rule),
    before,
    after,
  });
}

function isImplicitConstructorSet(signatures: SignatureInfo[]): boolean {
  return signatures.length === 1 && signatures[0]?.implicit === true;
}

function signatureKey(signature: SignatureInfo): string {
  const parameters = signature.parameters
    .map(
      (parameter) =>
        `${parameter.rest ? "..." : ""}${parameter.optional ? "?" : ""}${parameter.hasDefault ? "=" : ""}${parameter.type}`,
    )
    .join("|");
  return `${parameters}=>${signature.returnType}<${formatTypeParameters(signature.typeParameters)}>`;
}

function formatSignature(signature: SignatureInfo): string {
  const typeParameters = formatTypeParameters(signature.typeParameters);
  const parameters = signature.parameters
    .map((parameter) => {
      const rest = parameter.rest ? "..." : "";
      const optional = parameter.optional && !parameter.rest ? "?" : "";
      return `${rest}${parameter.name}${optional}: ${parameter.type}`;
    })
    .join(", ");
  const returnType =
    signature.returnType === "" ? "" : ` => ${signature.returnType}`;
  return `${typeParameters}(${parameters})${returnType}`;
}

function parameterDisplay(parameter: ParameterInfo): string {
  const rest = parameter.rest ? "..." : "";
  const optional = parameter.optional && !parameter.rest ? "?" : "";
  return `${rest}${parameter.name}${optional}: ${parameter.type}`;
}

function formatTypeParameters(parameters: TypeParameterInfo[]): string {
  if (parameters.length === 0) return "";
  const formatted = parameters.map((parameter) => {
    let text = parameter.name;
    if (parameter.constraint !== null) {
      text += ` extends ${parameter.constraint}`;
    }
    if (parameter.default !== null) {
      text += ` = ${parameter.default}`;
    }
    return text;
  });
  return `<${formatted.join(", ")}>`;
}

function formatIndexSignature(signature: IndexSignatureInfo): string {
  return `${signature.readonly ? "readonly " : ""}[${signature.keyName}: ${signature.keyType}]: ${signature.valueType}`;
}

function indexSignatureMap(
  signatures: IndexSignatureInfo[],
): Map<string, IndexSignatureInfo> {
  return new Map(
    signatures.map((signature) => [signature.keyType, signature]),
  );
}

function heritageMap(heritage: HeritageInfo[]): Map<string, HeritageInfo> {
  return new Map(
    heritage.map((entry) => [`${entry.kind}:${entry.text}`, entry]),
  );
}

function memberMapKey(member: MemberInfo): string {
  return `${member.static ? "static:" : ""}${member.name}`;
}

function memberPath(exportName: string, member: MemberInfo): string {
  return `${exportName}.${member.static ? "static." : ""}${member.name}`;
}

function describeMember(member: MemberInfo): string {
  const visibility = member.static ? "static " : "";
  return `${visibility}${member.kind} "${member.name}"`;
}

function quoteType(type: string): string {
  return `\`${type.replace(/`/g, "\\`")}\``;
}

function capitalize(text: string): string {
  return text.length === 0 ? text : text[0]!.toUpperCase() + text.slice(1);
}

function compareChanges(a: Change, b: Change): number {
  const severityDifference =
    (a.severity === "breaking" ? 0 : 1) - (b.severity === "breaking" ? 0 : 1);
  if (severityDifference !== 0) return severityDifference;
  return (
    compareStrings(a.path, b.path) ||
    compareStrings(a.rule, b.rule) ||
    compareStrings(a.message, b.message)
  );
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
