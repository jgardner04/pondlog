import { createEbirdFetcher, type EbirdFetcherOptions } from "./client.js";
import { createHotspotEndpoints } from "./hotspots.js";
import { createObservationEndpoints } from "./observations.js";
import { createProductEndpoints } from "./product.js";
import { createRegionEndpoints } from "./regions.js";
import { createTaxonomyEndpoints } from "./taxonomy.js";

/**
 * Every eBird endpoint bound to one key source. Use one client per caller
 * when a process serves several users, so each request sends its own key:
 *
 *   const ebird = createEbirdClient({ getApiKey: () => userKey });
 *   await ebird.getNearbyRecent(48.1, -123.4);
 *
 * The package's top-level functions are the default client, which reads
 * `process.env.EBIRD_API_KEY` on each call.
 */
export function createEbirdClient(options: EbirdFetcherOptions = {}) {
  const fetcher = createEbirdFetcher(options);
  return {
    ...createObservationEndpoints(fetcher),
    ...createProductEndpoints(fetcher),
    ...createHotspotEndpoints(fetcher),
    ...createTaxonomyEndpoints(fetcher),
    ...createRegionEndpoints(fetcher),
  };
}

export type EbirdClient = ReturnType<typeof createEbirdClient>;
