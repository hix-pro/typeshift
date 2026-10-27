import {
  Node,
  Scope,
  type CallSignatureDeclaration,
  type ClassDeclaration,
  type ConstructSignatureDeclaration,
  type ConstructorDeclaration,
  type ConstructorTypeNode,
  type EnumDeclaration,
  type FunctionDeclaration,
  type FunctionTypeNode,
  type GetAccessorDeclaration,
  type IndexSignatureDeclaration,
  type InterfaceDeclaration,
  type MethodDeclaration,
  type MethodSignature,
  type ParameterDeclaration,
  type PropertyDeclaration,
  type PropertySignature,
  type SetAccessorDeclaration,
  type TypeAliasDeclaration,
  type TypeLiteralNode,
  type TypeNode,
  type TypeParameterDeclaration,
  type VariableDeclaration,
} from "ts-morph";

import { SourceError, type LoadedSource } from "./load";
import type {
  ApiExport,
  ApiExportKind,
  ApiSurface,
  EnumMemberInfo,
  HeritageInfo,
  IndexSignatureInfo,
  MemberInfo,
  ParameterInfo,
  SignatureInfo,
  TypeParameterInfo,
} from "./types";

type ObjectTypeNode = InterfaceDeclaration | TypeLiteralNode;

type CallableNode =
  | FunctionDeclaration
  | MethodDeclaration
  | MethodSignature
  | ConstructorDeclaration
  | FunctionTypeNode
  | ConstructorTypeNode
  | CallSignatureDeclaration
  | ConstructSignatureDeclaration;

/**
 * Builds a normalized view of the declaration files reachable from a source's
 * entry points. Re-exports are resolved by the TypeScript checker.
 */
export function buildSurface(source: LoadedSource): ApiSurface {
  try {
    const declarationsByName = new Map<string, Map<string, Node>>();

    for (const root of source.roots) {
      const exported = root.getExportedDeclarations();
      for (const [name, declarations] of exported) {
        let byIdentity = declarationsByName.get(name);
        if (byIdentity === undefined) {
          byIdentity = new Map<string, Node>();
          declarationsByName.set(name, byIdentity);
        }
        for (const declaration of declarations) {
          byIdentity.set(nodeIdentity(declaration), declaration);
        }
      }
    }

    const exports = [...declarationsByName.entries()]
      .map(([name, declarations]) => buildExport(name, [...declarations.values()]))
      .sort((a, b) => compareStrings(a.name, b.name));

    return { exports };
  } catch (error) {
    if (error instanceof SourceError) throw error;
    throw new SourceError(
      `Failed to analyze "${source.label}": ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function buildExport(name: string, declarations: Node[]): ApiExport {
  const sortedDeclarations = [...declarations].sort((a, b) =>
    compareStrings(nodeIdentity(a), nodeIdentity(b)),
  );
  const primary = pickPrimaryDeclaration(sortedDeclarations);
  const kind = primary ? kindOfNode(primary) : "unknown";
  const base = emptyExport(name, kind);

  if (kind === "function") {
    const functions = sortedDeclarations.filter(Node.isFunctionDeclaration);
    base.signatures = functions.map((declaration) =>
      signatureFromCallable(declaration),
    );
    return finalizeExport(base);
  }

  if (kind === "class") {
    const classDeclaration = sortedDeclarations.find(Node.isClassDeclaration);
    if (classDeclaration !== undefined) {
      return buildClassExport(base, classDeclaration);
    }
  }

  if (kind === "interface") {
    const interfaces = sortedDeclarations.filter(Node.isInterfaceDeclaration);
    if (interfaces.length > 0) {
      return buildInterfaceExport(base, interfaces);
    }
  }

  if (kind === "type") {
    const alias = sortedDeclarations.find(Node.isTypeAliasDeclaration);
    if (alias !== undefined) {
      return buildTypeAliasExport(base, alias);
    }
  }

  if (kind === "enum") {
    const enumDeclaration = sortedDeclarations.find(Node.isEnumDeclaration);
    if (enumDeclaration !== undefined) {
      base.enumMembers = buildEnumMembers(enumDeclaration);
      return finalizeExport(base);
    }
  }

  if (kind === "variable") {
    const variable = sortedDeclarations.find(Node.isVariableDeclaration);
    if (variable !== undefined) {
      base.typeText = variableTypeText(variable);
      return finalizeExport(base);
    }
  }

  if (kind === "namespace") {
    return finalizeExport(base);
  }

  const unknown = primary;
  if (unknown !== undefined && !Node.isSourceFile(unknown)) {
    const text = normalizeTypeText(unknown.getText());
    base.typeText = text.length <= 20_000 ? text : null;
  }
  return finalizeExport(base);
}

function buildClassExport(base: ApiExport, declaration: ClassDeclaration): ApiExport {
  base.typeParameters = buildTypeParameters(declaration.getTypeParameters());
  base.abstract = declaration.isAbstract();
  base.heritage = buildClassHeritage(declaration);

  const constructors = declaration.getConstructors();
  if (constructors.length === 0) {
    base.constructSignatures = [
      {
        parameters: [],
        returnType: "",
        typeParameters: [],
        implicit: true,
      },
    ];
  } else {
    const publicConstructors = constructors.filter((constructor) =>
      isPublicScope(constructor),
    );
    base.constructSignatures = publicConstructors.map((constructor) =>
      signatureFromCallable(constructor),
    );
  }

  const members = new Map<string, MemberInfo>();
  for (const property of declaration.getProperties()) {
    if (!isPublicApiMember(property)) continue;
    upsertMember(members, propertyMember(property, property.hasQuestionToken(), property.isReadonly(), property.isStatic(), propertyTypeText(property)));
  }

  for (const constructor of constructors) {
    for (const parameter of constructor.getParameters()) {
      if (!parameter.isParameterProperty()) continue;
      if (!isPublicApiMember(parameter)) continue;
      upsertMember(members, {
        name: parameter.getName(),
        kind: "property",
        optional: parameter.isOptional(),
        readonly: parameter.isReadonly(),
        static: false,
        type: parameterTypeText(parameter),
        signatures: [],
      });
    }
  }

  const accessors = collectClassAccessors(declaration);
  for (const accessor of accessors) {
    upsertMember(members, accessor);
  }

  for (const method of declaration.getMethods()) {
    if (!isPublicApiMember(method)) continue;
    upsertMember(members, {
      name: method.getName(),
      kind: "method",
      optional: method.hasQuestionToken(),
      readonly: false,
      static: method.isStatic(),
      type: null,
      signatures: [signatureFromCallable(method)],
    });
  }

  base.members = sortMembers([...members.values()]);
  return finalizeExport(base);
}

function buildInterfaceExport(
  base: ApiExport,
  declarations: InterfaceDeclaration[],
): ApiExport {
  const first = declarations[0];
  if (first === undefined) return finalizeExport(base);

  base.typeParameters = buildTypeParameters(first.getTypeParameters());
  base.heritage = declarations.flatMap((declaration) =>
    declaration.getExtends().map(
      (heritage): HeritageInfo => ({
        kind: "extends",
        text: normalizeTypeText(heritage.getText()),
      }),
    ),
  );

  const members = new Map<string, MemberInfo>();
  for (const declaration of declarations) {
    const objectType = collectObjectType(declaration);
    for (const member of objectType.members) {
      upsertMember(members, member);
    }
    base.callSignatures.push(...objectType.callSignatures);
    base.constructSignatures.push(...objectType.constructSignatures);
    base.indexSignatures.push(...objectType.indexSignatures);
  }

  base.members = sortMembers([...members.values()]);
  base.heritage = dedupeHeritage(base.heritage);
  base.indexSignatures = sortIndexSignatures(base.indexSignatures);
  return finalizeExport(base);
}

function buildTypeAliasExport(
  base: ApiExport,
  declaration: TypeAliasDeclaration,
): ApiExport {
  base.typeParameters = buildTypeParameters(declaration.getTypeParameters());
  const typeNode = unwrapParentheses(declaration.getTypeNode());
  if (typeNode === undefined) {
    return finalizeExport(base);
  }

  if (Node.isTypeLiteral(typeNode)) {
    const objectType = collectObjectType(typeNode);
    base.members = sortMembers(objectType.members);
    base.callSignatures = objectType.callSignatures;
    base.constructSignatures = objectType.constructSignatures;
    base.indexSignatures = sortIndexSignatures(objectType.indexSignatures);
    return finalizeExport(base);
  }

  if (Node.isFunctionTypeNode(typeNode)) {
    base.signatures = [signatureFromCallable(typeNode)];
    return finalizeExport(base);
  }

  if (Node.isConstructorTypeNode(typeNode)) {
    base.constructSignatures = [signatureFromCallable(typeNode)];
    return finalizeExport(base);
  }

  base.typeText = normalizeTypeText(typeNode.getText());
  return finalizeExport(base);
}

function collectObjectType(node: ObjectTypeNode): {
  members: MemberInfo[];
  callSignatures: SignatureInfo[];
  constructSignatures: SignatureInfo[];
  indexSignatures: IndexSignatureInfo[];
} {
  const members = new Map<string, MemberInfo>();

  for (const property of node.getProperties()) {
    if (property.getName().startsWith("#")) continue;
    upsertMember(members, {
      name: property.getName(),
      kind: "property",
      optional: property.hasQuestionToken(),
      readonly: property.isReadonly(),
      static: false,
      type: propertyTypeText(property),
      signatures: [],
    });
  }

  const accessorMap = new Map<
    string,
    {
      name: string;
      getter: GetAccessorDeclaration | undefined;
      setter: SetAccessorDeclaration | undefined;
    }
  >();

  for (const getter of node.getGetAccessors()) {
    const name = getter.getName();
    if (name.startsWith("#")) continue;
    const key = memberKey(name, false);
    const existing = accessorMap.get(key) ?? {
      name,
      getter: undefined,
      setter: undefined,
    };
    existing.getter = getter;
    accessorMap.set(key, existing);
  }

  for (const setter of node.getSetAccessors()) {
    const name = setter.getName();
    if (name.startsWith("#")) continue;
    const key = memberKey(name, false);
    const existing = accessorMap.get(key) ?? {
      name,
      getter: undefined,
      setter: undefined,
    };
    existing.setter = setter;
    accessorMap.set(key, existing);
  }

  for (const accessor of accessorMap.values()) {
    if (members.has(memberKey(accessor.name, false))) continue;
    upsertMember(members, {
      name: accessor.name,
      kind: "property",
      optional: false,
      readonly: accessor.getter !== undefined && accessor.setter === undefined,
      static: false,
      type: accessorTypeText(accessor.getter, accessor.setter),
      signatures: [],
    });
  }

  for (const method of node.getMethods()) {
    if (method.getName().startsWith("#")) continue;
    upsertMember(members, {
      name: method.getName(),
      kind: "method",
      optional: method.hasQuestionToken(),
      readonly: false,
      static: false,
      type: null,
      signatures: [signatureFromCallable(method)],
    });
  }

  return {
    members: sortMembers([...members.values()]),
    callSignatures: node
      .getCallSignatures()
      .map((signature) => signatureFromCallable(signature)),
    constructSignatures: node
      .getConstructSignatures()
      .map((signature) => signatureFromCallable(signature)),
    indexSignatures: node
      .getIndexSignatures()
      .map((signature) => buildIndexSignature(signature)),
  };
}

function collectClassAccessors(declaration: ClassDeclaration): MemberInfo[] {
  const accessorMap = new Map<
    string,
    {
      name: string;
      static: boolean;
      getter: GetAccessorDeclaration | undefined;
      setter: SetAccessorDeclaration | undefined;
    }
  >();

  for (const getter of declaration.getGetAccessors()) {
    if (!isPublicApiMember(getter)) continue;
    const key = memberKey(getter.getName(), getter.isStatic());
    const existing = accessorMap.get(key) ?? {
      name: getter.getName(),
      static: getter.isStatic(),
      getter: undefined,
      setter: undefined,
    };
    existing.getter = getter;
    accessorMap.set(key, existing);
  }

  for (const setter of declaration.getSetAccessors()) {
    if (!isPublicApiMember(setter)) continue;
    const key = memberKey(setter.getName(), setter.isStatic());
    const existing = accessorMap.get(key) ?? {
      name: setter.getName(),
      static: setter.isStatic(),
      getter: undefined,
      setter: undefined,
    };
    existing.setter = setter;
    accessorMap.set(key, existing);
  }

  return [...accessorMap.values()].map((accessor) => ({
    name: accessor.name,
    kind: "property" as const,
    optional: false,
    readonly: accessor.getter !== undefined && accessor.setter === undefined,
    static: accessor.static,
    type: accessorTypeText(accessor.getter, accessor.setter),
    signatures: [],
  }));
}

function buildClassHeritage(declaration: ClassDeclaration): HeritageInfo[] {
  const heritage: HeritageInfo[] = [];
  const extended = declaration.getExtends();
  if (extended !== undefined) {
    heritage.push({
      kind: "extends",
      text: normalizeTypeText(extended.getText()),
    });
  }
  for (const implemented of declaration.getImplements()) {
    heritage.push({
      kind: "implements",
      text: normalizeTypeText(implemented.getText()),
    });
  }
  return dedupeHeritage(heritage);
}

function buildEnumMembers(declaration: EnumDeclaration): EnumMemberInfo[] {
  const members: EnumMemberInfo[] = [];
  let nextNumericValue: number | null = 0;

  for (const member of declaration.getMembers()) {
    const constantValue = member.getValue();
    let value: string;

    if (constantValue !== undefined) {
      value = formatEnumValue(constantValue);
      nextNumericValue =
        typeof constantValue === "number" && Number.isFinite(constantValue)
          ? constantValue + 1
          : null;
    } else {
      const initializer = member.getInitializer();
      if (initializer !== undefined) {
        value = normalizeTypeText(initializer.getText());
        nextNumericValue = null;
      } else if (nextNumericValue !== null) {
        value = String(nextNumericValue);
        nextNumericValue += 1;
      } else {
        value = "auto";
      }
    }

    members.push({ name: member.getName(), value });
  }

  return members;
}

function formatEnumValue(value: string | number): string {
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

function signatureFromCallable(node: CallableNode): SignatureInfo {
  const parameters = node.getParameters().map(buildParameter);
  const isConstructor = Node.isConstructorDeclaration(node);
  const returnTypeNode = isConstructor ? undefined : node.getReturnTypeNode();
  const returnType = isConstructor
    ? ""
    : returnTypeNode !== undefined
      ? normalizeTypeText(returnTypeNode.getText())
      : normalizeTypeText(node.getReturnType().getText());

  return {
    parameters,
    returnType,
    typeParameters: buildTypeParameters(callableTypeParameters(node)),
  };
}

function callableTypeParameters(
  node: CallableNode,
): TypeParameterDeclaration[] {
  const candidate = node as CallableNode & {
    getTypeParameters?: () => TypeParameterDeclaration[];
  };
  return typeof candidate.getTypeParameters === "function"
    ? candidate.getTypeParameters()
    : [];
}

function buildParameter(parameter: ParameterDeclaration): ParameterInfo {
  return {
    name: parameter.getName(),
    type: parameterTypeText(parameter),
    optional: parameter.isOptional() || parameter.isRestParameter(),
    rest: parameter.isRestParameter(),
    hasDefault: parameter.hasInitializer(),
  };
}

function buildIndexSignature(
  signature: IndexSignatureDeclaration,
): IndexSignatureInfo {
  const returnTypeNode = signature.getReturnTypeNode();
  return {
    keyName: signature.getKeyName(),
    keyType: normalizeTypeText(signature.getKeyTypeNode().getText()),
    valueType:
      returnTypeNode !== undefined
        ? normalizeTypeText(returnTypeNode.getText())
        : normalizeTypeText(signature.getReturnType().getText()),
    readonly: signature.isReadonly(),
  };
}

function buildTypeParameters(
  parameters: TypeParameterDeclaration[],
): TypeParameterInfo[] {
  return parameters.map((parameter) => ({
    name: parameter.getName(),
    constraint:
      parameter.getConstraint() !== undefined
        ? normalizeTypeText(parameter.getConstraintOrThrow().getText())
        : null,
    default:
      parameter.getDefault() !== undefined
        ? normalizeTypeText(parameter.getDefaultOrThrow().getText())
        : null,
  }));
}

function propertyTypeText(
  property: PropertyDeclaration | PropertySignature,
): string {
  const typeNode = property.getTypeNode();
  return normalizeTypeText(
    typeNode !== undefined ? typeNode.getText() : property.getType().getText(),
  );
}

function parameterTypeText(parameter: ParameterDeclaration): string {
  const typeNode = parameter.getTypeNode();
  return normalizeTypeText(
    typeNode !== undefined ? typeNode.getText() : parameter.getType().getText(),
  );
}

function variableTypeText(variable: VariableDeclaration): string {
  const typeNode = variable.getTypeNode();
  return normalizeTypeText(
    typeNode !== undefined ? typeNode.getText() : variable.getType().getText(),
  );
}

function accessorTypeText(
  getter: GetAccessorDeclaration | undefined,
  setter: SetAccessorDeclaration | undefined,
): string {
  if (getter !== undefined) {
    const returnTypeNode = getter.getReturnTypeNode();
    return normalizeTypeText(
      returnTypeNode !== undefined
        ? returnTypeNode.getText()
        : getter.getReturnType().getText(),
    );
  }
  if (setter !== undefined) {
    const parameter = setter.getParameters()[0];
    if (parameter !== undefined) return parameterTypeText(parameter);
  }
  return "unknown";
}

function propertyMember(
  property: PropertyDeclaration,
  optional: boolean,
  readonly: boolean,
  isStatic: boolean,
  type: string,
): MemberInfo {
  return {
    name: property.getName(),
    kind: "property",
    optional,
    readonly,
    static: isStatic,
    type,
    signatures: [],
  };
}

function upsertMember(
  members: Map<string, MemberInfo>,
  member: MemberInfo,
): void {
  const key = memberKey(member.name, member.static);
  const existing = members.get(key);
  if (existing === undefined) {
    members.set(key, member);
    return;
  }

  if (existing.kind === "method" && member.kind === "method") {
    existing.signatures.push(...member.signatures);
    existing.optional = existing.optional || member.optional;
  }
}

function sortMembers(members: MemberInfo[]): MemberInfo[] {
  return [...members].sort((a, b) => {
    const keyCompare = compareStrings(
      memberKey(a.name, a.static),
      memberKey(b.name, b.static),
    );
    return keyCompare !== 0 ? keyCompare : compareStrings(a.kind, b.kind);
  });
}

function sortIndexSignatures(
  signatures: IndexSignatureInfo[],
): IndexSignatureInfo[] {
  return [...signatures].sort((a, b) => compareStrings(a.keyType, b.keyType));
}

function dedupeHeritage(heritage: HeritageInfo[]): HeritageInfo[] {
  const seen = new Set<string>();
  const result: HeritageInfo[] = [];
  for (const entry of heritage) {
    const key = `${entry.kind}:${entry.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(entry);
  }
  return result.sort((a, b) =>
    compareStrings(`${a.kind}:${a.text}`, `${b.kind}:${b.text}`),
  );
}

function emptyExport(name: string, kind: ApiExportKind): ApiExport {
  return {
    name,
    kind,
    signatures: [],
    callSignatures: [],
    constructSignatures: [],
    members: [],
    indexSignatures: [],
    heritage: [],
    enumMembers: null,
    typeParameters: [],
    abstract: false,
    typeText: null,
  };
}

function finalizeExport(base: ApiExport): ApiExport {
  return base;
}

function pickPrimaryDeclaration(declarations: Node[]): Node | undefined {
  const nonNamespace = declarations.find(
    (declaration) => !Node.isModuleDeclaration(declaration),
  );
  return nonNamespace ?? declarations[0];
}

function kindOfNode(node: Node): ApiExportKind {
  if (Node.isFunctionDeclaration(node)) return "function";
  if (Node.isClassDeclaration(node)) return "class";
  if (Node.isInterfaceDeclaration(node)) return "interface";
  if (Node.isTypeAliasDeclaration(node)) return "type";
  if (Node.isEnumDeclaration(node)) return "enum";
  if (Node.isVariableDeclaration(node)) return "variable";
  if (Node.isModuleDeclaration(node)) return "namespace";
  return "unknown";
}

function unwrapParentheses(typeNode: TypeNode | undefined): TypeNode | undefined {
  let current = typeNode;
  while (current !== undefined && Node.isParenthesizedTypeNode(current)) {
    current = current.getTypeNode();
  }
  return current;
}

function isPublicApiMember(member: {
  getName(): string;
  getScope(): Scope | undefined;
}): boolean {
  if (member.getName().startsWith("#")) return false;
  return isPublicScope(member);
}

function isPublicScope(member: { getScope(): Scope | undefined }): boolean {
  const scope = member.getScope();
  return scope === undefined || scope === Scope.Public;
}

function memberKey(name: string, isStatic: boolean): string {
  return `${isStatic ? "static:" : ""}${name}`;
}

function normalizeTypeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function nodeIdentity(node: Node): string {
  return `${node.getSourceFile().getFilePath()}:${node.getStart()}:${node.getKind()}`;
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
