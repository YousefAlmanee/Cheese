import type { Category, Source, Unit } from "@/db/schema";

/** One catalog entry as a provider describes it. Matches the columns of the item table. */
export type ItemDraft = {
  category: Category;
  source: Source;
  externalId: string | null;
  title: string;
  creator: string | null;
  year: number | null;
  coverUrl: string | null;
  summary: string | null;
  unit: Unit;
  totalUnits: number | null;
  unitSeconds: number | null;
  genres: string[];
  platforms: string[];
};

export type Ref = { source: Source; externalId: string; category: Category };

export interface Provider {
  source: Source;
  categories: Category[];
  /** False when the API key for this provider is not configured. */
  enabled(): boolean;
  search(query: string, signal: AbortSignal): Promise<ItemDraft[]>;
  /** Trending / popular titles for discovery, shown before anyone types. Optional per source. */
  popular?(signal: AbortSignal): Promise<ItemDraft[]>;
  /** Fetches the full record (length included) for one search hit. */
  details(ref: Ref, signal: AbortSignal): Promise<ItemDraft>;
}

export class ProviderError extends Error {
  constructor(
    public provider: string,
    message: string,
  ) {
    super(`${provider}: ${message}`);
  }
}
