export type Mode = "strict" | "loose";

export type Options = {
  retries: number;
  verbose?: boolean;
};

export type Callback = (value: string) => void;

export interface KindSwap {
  value: string;
}

export type Generic<T> = {
  value: T;
};
