export interface User {
  readonly id: string;
  name: string;
  email: string;
  avatar?: string;
  role: "admin" | "member" | "guest";
}

export declare function greet(user: User, punctuation: string): string;

export declare function format(value: string): string;
export declare function format(value: number): number;

export declare class ApiClient {
  constructor(baseUrl: string, timeout?: number, region?: string);
  readonly baseUrl: string;
  request<T>(path: string): Promise<T>;
  static create(baseUrl: string, options?: {}): ApiClient;
  close(): void;
  cancel(): void;
}

export declare enum LogLevel {
  Info = "info",
  Error = "fatal",
  Warn = "warn",
}

export declare const VERSION: string;

export type UserId = string | number | bigint;

export declare function createUser(name: string): User;

export { NewLegacyOptions } from "./next";
