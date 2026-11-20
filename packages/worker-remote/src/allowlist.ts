/**
 * Parses ALLOWED_GITHUB_IDS ("1000001, 1000002") into numeric IDs. Anything
 * that is not a positive integer is dropped, so a typo can only shrink the
 * list, never open it. An empty list lets nobody in.
 */
export function parseAllowlist(raw: string | undefined): Set<number> {
  const ids = new Set<number>();
  for (const part of (raw ?? "").split(",")) {
    const trimmed = part.trim();
    if (/^[1-9][0-9]{0,15}$/.test(trimmed)) ids.add(Number(trimmed));
  }
  return ids;
}

export function isAllowed(raw: string | undefined, githubId: unknown): boolean {
  return typeof githubId === "number" && parseAllowlist(raw).has(githubId);
}
