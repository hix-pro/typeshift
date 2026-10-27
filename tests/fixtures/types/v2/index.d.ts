export type Mode = "strict" | "loose" | "auto";

export type Options = {
  retries: number;
  verbose?: boolean;
  signal?: AbortSignal;
};

export type Callback = (value: number) => void;

export type KindSwap = {
  value: string;
};

export type Generic<T, U = T> = {
  value: T;
  fallback?: U;
};
