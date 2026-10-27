export declare function greet(name: string, punctuation?: string): string;

export interface Options {
  verbose?: boolean;
  color?: string;
}

export declare enum Level {
  Info = "info",
  Debug = "debug",
}

export declare const VERSION: string;

export declare function farewell(name: string): string;
