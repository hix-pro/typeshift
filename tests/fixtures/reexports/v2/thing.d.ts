export interface Thing {
  id: string;
  label?: string;
}

export declare function useThing(thing: Thing): string;
