export interface Account {
  readonly id: string;
  removable: string;
  name: string;
  nickname: string;
  readonly mutable: string;
  avatar?: string;
  role: "admin" | "user" | "guest";
  getName(): string;
  reset(): void;
  overloaded(value: string): string;
  (value: string, radix?: number): Account;
  [key: string]: string;
}

export interface Extended extends Account {
  extra: number;
  added?: boolean;
}

export interface AddedIface {
  y: number;
}

export type Shape = {
  size: number;
  label?: string;
  draw(): void;
  fill(): void;
};
