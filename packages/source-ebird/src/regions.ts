import { err, type Result } from "@pondlog/core";
import { ebirdFetch as defaultEbirdFetch, type EbirdFetcher } from "./client.js";
import {
  EbirdAdjacentRegionListSchema,
  EbirdRegionInfoSchema,
  EbirdSubRegionListSchema,
  type EbirdAdjacentRegion,
  type EbirdRegionInfo,
  type EbirdSubRegion,
} from "./schemas.js";

export type RegionType = "country" | "subnational1" | "subnational2";

/**
 * Builds this module's endpoint functions around one fetcher. The
 * `ebirdFetch` parameter shadows the module default, so every endpoint
 * below sends the key that fetcher resolves.
 */
export function createRegionEndpoints(ebirdFetch: EbirdFetcher) {
  // 1. GET /ref/region/info/{regionCode}
  async function getRegionInfo(
    regionCode: string,
    params: { regionNameFormat?: "detailed" | "detailednoqual" | "full" | "namequal" | "nameonly" | "revdetailed" } = {},
  ): Promise<Result<EbirdRegionInfo>> {
    if (!regionCode.trim()) {
      return err({ source: "ebird", message: "getRegionInfo: regionCode is empty" });
    }
    return ebirdFetch(
      `/ref/region/info/${encodeURIComponent(regionCode)}`,
      EbirdRegionInfoSchema,
      { searchParams: { regionNameFormat: params.regionNameFormat } },
    );
  }

  // 2. GET /ref/region/list/{regionType}/{parentRegionCode}
  async function getSubRegions(
    regionType: RegionType,
    parentRegionCode: string,
  ): Promise<Result<EbirdSubRegion[]>> {
    if (!parentRegionCode.trim()) {
      return err({ source: "ebird", message: "getSubRegions: parentRegionCode is empty" });
    }
    return ebirdFetch(
      `/ref/region/list/${encodeURIComponent(regionType)}/${encodeURIComponent(parentRegionCode)}`,
      EbirdSubRegionListSchema,
      { searchParams: { fmt: "json" } },
    );
  }

  // 3. GET /ref/adjacent/{regionCode}
  // Note: eBird's documented path for adjacent regions is /ref/adjacent/{regionCode}.
  // Only available for subnational2 region codes.
  async function getAdjacentRegions(
    regionCode: string,
  ): Promise<Result<EbirdAdjacentRegion[]>> {
    if (!regionCode.trim()) {
      return err({ source: "ebird", message: "getAdjacentRegions: regionCode is empty" });
    }
    return ebirdFetch(
      `/ref/adjacent/${encodeURIComponent(regionCode)}`,
      EbirdAdjacentRegionListSchema,
    );
  }

  return { getRegionInfo, getSubRegions, getAdjacentRegions };
}

export const {
  getRegionInfo,
  getSubRegions,
  getAdjacentRegions,
} = createRegionEndpoints(defaultEbirdFetch);
