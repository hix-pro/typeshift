export interface Stable {
  id: string;
  value?: number;
  run(input: string): string;
}

export declare function stable(value: string): string;

export declare const STABLE: boolean;

export declare enum StableState {
  Ready = "ready",
  Done = "done",
}
