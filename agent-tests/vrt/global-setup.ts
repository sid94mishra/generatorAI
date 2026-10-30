// ────────────────────────────────────────────────────────────────
// VRT globalSetup guard (docs/redesign/09-verification.md §4.4).
//
// Text rasterises differently on every OS, so baselines are produced and
// compared in exactly one place: the pinned Linux image (docker/vrt.Dockerfile
// sets GAI_VRT_CONTAINER=1). Run `pnpm vrt` from any host; it builds and
// enters that container. Running this config directly on a host would write
// or compare host-rendered pixels, which is never meaningful.
// ────────────────────────────────────────────────────────────────

export default function globalSetup(): void {
  if (process.env['GAI_VRT_CONTAINER'] !== '1') {
    throw new Error(
      'VRT runs only inside the pinned container (GAI_VRT_CONTAINER=1). Use `pnpm vrt` (scripts/redesign/vrt.mjs), ' +
        'which builds docker/vrt.Dockerfile and runs this config there.',
    );
  }
}
