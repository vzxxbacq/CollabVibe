/**
 * Naming convention for merge resolver threads.
 * Used by both L2 (merge use-case) and L1 (interrupt handler) to
 * derive branchName from threadName and vice versa.
 */

const MERGE_RESOLVER_PREFIX = "merge-";

/**
 * Extract the branch name from a merge resolver thread name.
 * Returns `null` if the thread name is not a merge resolver.
 *
 * @example parseMergeResolverName("merge-feature-x") → "feature-x"
 * @example parseMergeResolverName("default")         → null
 */
export function parseMergeResolverName(threadName: string): string | null {
  if (threadName.startsWith(MERGE_RESOLVER_PREFIX) && threadName.length > MERGE_RESOLVER_PREFIX.length) {
    return threadName.slice(MERGE_RESOLVER_PREFIX.length);
  }
  return null;
}

/**
 * Build a merge resolver thread name from a branch name.
 *
 * @example mergeResolverThreadName("feature-x") → "merge-feature-x"
 */
export function mergeResolverThreadName(branchName: string): string {
  return `${MERGE_RESOLVER_PREFIX}${branchName}`;
}
