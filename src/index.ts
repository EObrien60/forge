// Programmatic surface of @obh/forge. The CLI (src/cli.ts) is the primary entry;
// these exports let scripts and Claude skills drive Forge in-process.

export { FORGE_VERSION } from "./version"
export * from "./types"

export { Plan } from "./project/plan"
export { ProjectContext } from "./project/context"
export { loadManifest, saveManifest, newManifest, mergeManifest } from "./project/manifest"

export { CAPABILITIES, getCapability, isImplemented, resolveOrder, missingPrerequisites } from "./capabilities"
export type { Capability } from "./capabilities"

export { RECIPES, getRecipe } from "./recipes"
export { addLwdManifests, computeSecrets } from "./generators/lwd"
