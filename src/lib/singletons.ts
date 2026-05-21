// ─── Module-level Singletons ──────────────────────────────────────────────
// Shared instances used by tool definitions. The plugin entry point sets
// client/directory on these after initialization.

export const manager = {
  client: undefined as any,
  directory: undefined as string | undefined,
}
