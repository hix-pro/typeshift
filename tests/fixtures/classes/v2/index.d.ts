declare class Base {
  base: string;
}

declare class Other {
  other: string;
}

export declare class Service extends Other {
  constructor(baseUrl: string, timeout?: number, region?: string);
  readonly baseUrl: string;
  name: string;
  static DEFAULT_TIMEOUT: string;
  static create(baseUrl: string, options?: {}): Service;
  start(): void;
  stop(force: boolean): void;
  parse(value: string): string;
  cancel(): void;
  get status(): string;
  set status(value: string);
  private secret: number;
  protected internal: number;
  #hidden: number;
}

export declare class Lifetime {
  name: string;
}

export declare class EmptyConstructor {
  value: string;
}

export declare class CtorRequired {
  constructor(id: string);
}

export declare class AddedClass {
  value: number;
}

export declare class KindChange {
  value: number;
}

export declare const KindSwap: string;

export declare abstract class Abstracted {
  value: string;
}

export declare class ConcreteAgain {
  value: string;
}
