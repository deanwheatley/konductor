/**
 * Baton Dashboard — URL Builder
 *
 * Constructs the repo page URL from server host, port, and repo identifier.
 * The URL uses only the repo name (not the owner) for simplicity — all users
 * across branches share the same page.
 */

/**
 * Extract the repo name portion from an "owner/repo" string.
 * If the string has no slash, returns it as-is.
 */
export function extractRepoName(repo: string): string {
  const slash = repo.lastIndexOf("/");
  return slash === -1 ? repo : repo.slice(slash + 1);
}

/**
 * Build the repo page URL for a given repository.
 *
 * @param host  Server hostname (e.g. "localhost", "my-server.local")
 * @param port  Server port number
 * @param repo  Repository in "owner/repo" format
 * @returns     URL matching `http://<host>:<port>/repo/<repoName>`
 */
export function buildRepoPageUrl(host: string, port: number, repo: string): string {
  const repoName = extractRepoName(repo);
  return `http://${host}:${port}/repo/${repoName}`;
}
