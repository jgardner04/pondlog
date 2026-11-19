export {
  assertEbirdApiKey,
  createEbirdFetcher,
  ebirdFetch,
  type EbirdFetcher,
  type EbirdFetcherOptions,
  type EbirdFetchOptions,
} from "./client.js";

export { createEbirdClient, type EbirdClient } from "./ebird-client.js";

export {
  normalizeHotspot,
  normalizeHotspotInfo,
  normalizeObservation,
  normalizeTaxonomyEntry,
} from "./normalize.js";

export * from "./schemas.js";

export {
  createObservationEndpoints,
  getHistoricOnDate,
  getNearbyNotable,
  getNearbyNotableNormalized,
  getNearbyOfSpecies,
  getNearbyRecent,
  getNearbyRecentNormalized,
  getRecentNotable,
  getRecentObservations,
  getRecentOfSpecies,
  type HistoricObservationsParams,
  type NearbyNotableParams,
  type NearbyObservationsParams,
  type NearbyOfSpeciesParams,
  type NotableObservationsParams,
  type RecentObservationsParams,
} from "./observations.js";

export {
  createProductEndpoints,
  getChecklist,
  getRecentChecklists,
  getTop100,
  type RecentChecklistsParams,
  type Top100Params,
} from "./product.js";

export {
  createHotspotEndpoints,
  getHotspotInfo,
  getHotspotInfoNormalized,
  getHotspotsInRegion,
  getHotspotsInRegionNormalized,
  getNearbyHotspots,
  getNearbyHotspotsNormalized,
  type HotspotsInRegionParams,
  type NearbyHotspotsParams,
} from "./hotspots.js";

export {
  createTaxonomyEndpoints,
  getTaxaLocales,
  getTaxonomicForms,
  getTaxonomicGroups,
  getTaxonomy,
  getTaxonomyNormalized,
  getTaxonomyVersions,
  type SpeciesGrouping,
  type TaxonomicGroupsParams,
  type TaxonomyParams,
} from "./taxonomy.js";

export {
  createRegionEndpoints,
  getAdjacentRegions,
  getRegionInfo,
  getSubRegions,
  type RegionType,
} from "./regions.js";
