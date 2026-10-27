export interface User {
  id: string;
  name: string;
  email?: string;
  role: "admin" | "member";
}

export declare function greet(user: User, punctuation?: string): string;

export declare function format(value: string): string;
export declare function format(value: number): string;

export declare class ApiClient {
  constructor(baseUrl: string, timeout?: number);
  readonly baseUrl: string;
  request<T>(path: string): Promise<T>;
  static create(baseUrl: string): ApiClient;
  close(): void;
}

export declare enum LogLevel {
  Debug = "debug",
  Info = "info",
  Error = "error",
}

export declare const VERSION: string;

export type UserId = string | number;

export { LegacyOptions } from "./legacy";
