declare class Base {
  base: string;
}

declare class Other {
  other: string;
}

export declare class Service extends Base implements Disposable {
  constructor(baseUrl: string, timeout?: number);
  readonly baseUrl: string;
  name: string;
  static readonly DEFAULT_TIMEOUT: number;
  static create(baseUrl: string): Service;
  start(): void;
  stop(force?: boolean): void;
  parse(value: string): string;
  parse(value: number): string;
  disconnect(): void;
  get status(): string;
  set status(value: string);
  private secret;
  protected internal: string;
  #hidden: string;
}

export declare class Lifetime {
  constructor(name: string);
  name: string;
}

export declare class EmptyConstructor {
  constructor();
  value: string;
}

export declare class CtorRequired {
  constructor();
}

export declare class RemovedClass {
  value: string;
}

export declare class KindChange {
  value: string;
}

export declare class KindSwap {
  value: string;
}

export declare class Abstracted {
  value: string;
}

export declare abstract class ConcreteAgain {
  value: string;
}
