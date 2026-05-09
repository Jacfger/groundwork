// ─── Module-level Singletons ──────────────────────────────────────────────
// Shared instances used by tool definitions. The plugin entry point sets
// client/directory on these after initialization.

import { BackgroundManager } from './background-manager.js'
import { PersistenceLayer } from './persistence.js'

export const manager = new BackgroundManager()
export const persistence = new PersistenceLayer()
