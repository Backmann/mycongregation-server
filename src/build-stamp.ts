/**
 * Which commit this server was built from (26 September).
 *
 * null in the repository and on any development machine. The deploy workflow
 * overwrites this file with the pushed commit just before it packs the
 * source, so the image built on the server carries it, and /api/health says
 * it. That is how «did the deploy land?» is answered by the server itself,
 * not by the Actions page, which twice that day showed a stale list.
 *
 * Kept a .ts file on purpose: the production Dockerfile lives on the server,
 * not here, and whatever it copies, it copies the compiled code.
 */
export const BUILD_COMMIT: string | null = null;
