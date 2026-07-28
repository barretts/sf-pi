# Asset credits

## Salesforce Lightning Design System icons

`sf-tldraw` reads unchanged icon assets at runtime from the pinned npm package:

- Package: [`@salesforce-ux/design-system`](https://www.npmjs.com/package/@salesforce-ux/design-system)
- Version: `2.264.0`
- License: `BSD-3-Clause` (declared by the published package metadata)
- Runtime asset root: `node_modules/@salesforce-ux/design-system/assets/icons/`

Only icons actually used by a diagram are embedded in that tldraw document. Each embedded icon asset carries source, package, version, and license metadata for portability. The glyphs are not recolored or modified; colored tiles are separate background assets.

## Layout

Graph layout uses [`@dagrejs/dagre`](https://github.com/dagrejs/dagre) `3.0.0`, licensed under MIT.
