import type { Platform } from "./product";

/** A claimed row is stronger than a general run: JOIN/lease acquisition guarantees these fields. */
export interface ClaimedRun {
  id: string;
  kind: string;
  listing_id: string;
  observation_id: string | null;
  canonical_url: string;
  platform: Platform;
  lease_token: string;
  attempt: number;
  input: {
    hint?: string;
    automatic?: boolean;
    automaticKey?: string;
    logisticsId?: string | null;
  };
}
