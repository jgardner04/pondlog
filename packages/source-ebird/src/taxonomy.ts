import { err, ok, type Result, type Taxon } from "@pondlog/core";
import { z } from "zod";
import { ebirdFetch as defaultEbirdFetch, type EbirdFetcher } from "./client.js";
import { normalizeTaxonomyEntry } from "./normalize.js";
import {
  EbirdTaxaLocaleListSchema,
  EbirdTaxonomicGroupListSchema,
  EbirdTaxonomyListSchema,
  EbirdTaxonomyVersionListSchema,
  type EbirdTaxaLocale,
  type EbirdTaxonomicForm,
  type EbirdTaxonomicGroup,
  type EbirdTaxonomyEntry,
  type EbirdTaxonomyVersion,
} from "./schemas.js";

const TaxonomicFormsResponseSchema = z.array(z.string());

export interface TaxonomyParams {
  /** Comma-separated list or array of category codes (species, issf, hybrid, etc.). */
  cat?: string | string[];
  /** Specific species codes to fetch (subset of full taxonomy). */
  species?: string | string[];
  /** ISO locale for common names (default "en"). */
  locale?: string;
  /** Specific taxonomy version. */
  version?: string;
}

function joinList(v: string | string[] | undefined): string | undefined {
  if (!v) return undefined;
  return Array.isArray(v) ? v.join(",") : v;
}





// 5. GET /ref/taxonomy/groups/{speciesGrouping}
export type SpeciesGrouping = "merlin" | "ebird";

export interface TaxonomicGroupsParams {
  /** Locale for group names. */
  groupNameLocale?: string;
}

/**
 * Builds this module's endpoint functions around one fetcher. The
 * `ebirdFetch` parameter shadows the module default, so every endpoint
 * below sends the key that fetcher resolves.
 */
export function createTaxonomyEndpoints(ebirdFetch: EbirdFetcher) {
  // 1. GET /ref/taxonomy/ebird
  async function getTaxonomy(
    params: TaxonomyParams = {},
  ): Promise<Result<EbirdTaxonomyEntry[]>> {
    return ebirdFetch("/ref/taxonomy/ebird", EbirdTaxonomyListSchema, {
      searchParams: {
        fmt: "json",
        cat: joinList(params.cat),
        species: joinList(params.species),
        locale: params.locale,
        version: params.version,
      },
    });
  }

  // 2. GET /ref/taxonomy/forms/{speciesCode}
  // API returns a bare string[]; we wrap it in {speciesCode, forms} for callers.
  async function getTaxonomicForms(
    speciesCode: string,
  ): Promise<Result<EbirdTaxonomicForm>> {
    if (!speciesCode.trim()) {
      return err({ source: "ebird", message: "getTaxonomicForms: speciesCode is empty" });
    }
    const result = await ebirdFetch(
      `/ref/taxonomy/forms/${encodeURIComponent(speciesCode)}`,
      TaxonomicFormsResponseSchema,
    );
    if (!result.ok) return result;
    return ok({ speciesCode, forms: result.data });
  }

  // 3. GET /ref/taxonomy/locales
  async function getTaxaLocales(): Promise<Result<EbirdTaxaLocale[]>> {
    return ebirdFetch("/ref/taxonomy/locales", EbirdTaxaLocaleListSchema);
  }

  // 4. GET /ref/taxonomy/versions
  async function getTaxonomyVersions(): Promise<Result<EbirdTaxonomyVersion[]>> {
    return ebirdFetch("/ref/taxonomy/versions", EbirdTaxonomyVersionListSchema);
  }

  async function getTaxonomicGroups(
    grouping: SpeciesGrouping,
    params: TaxonomicGroupsParams = {},
  ): Promise<Result<EbirdTaxonomicGroup[]>> {
    return ebirdFetch(
      `/ref/sppgroup/${encodeURIComponent(grouping)}`,
      EbirdTaxonomicGroupListSchema,
      { searchParams: { groupNameLocale: params.groupNameLocale } },
    );
  }

  // Convenience: normalized variant
  async function getTaxonomyNormalized(
    params: TaxonomyParams = {},
  ): Promise<Result<Taxon[]>> {
    const result = await getTaxonomy(params);
    if (!result.ok) return result;
    return ok(result.data.map(normalizeTaxonomyEntry));
  }

  return { getTaxonomy, getTaxonomicForms, getTaxaLocales, getTaxonomyVersions, getTaxonomicGroups, getTaxonomyNormalized };
}

export const {
  getTaxonomy,
  getTaxonomicForms,
  getTaxaLocales,
  getTaxonomyVersions,
  getTaxonomicGroups,
  getTaxonomyNormalized,
} = createTaxonomyEndpoints(defaultEbirdFetch);
