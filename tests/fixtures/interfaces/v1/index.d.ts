export interface Account {
  readonly id: string;
  readonly removable: string;
  name: string;
  nickname?: string;
  mutable: string;
  legacy: boolean;
  role: "admin" | "user";
  getName(): string;
  removeMe(): void;
  overloaded(value: string): string;
  overloaded(value: number): string;
  (value: string): Account;
  [key: string]: unknown;
}

export interface Extended extends Account {
  extra: number;
}

export interface RemovedIface {
  x: string;
}

export type Shape = {
  size: number;
  label?: string;
  draw(): void;
};
