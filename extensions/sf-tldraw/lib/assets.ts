/* SPDX-License-Identifier: Apache-2.0 */
/** SLDS icon loading and source-gated product-mark metadata. */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import type {
  CanvasAssetPayload,
  DiagramIcon,
  EndpointCardinality,
  ObjectFamily,
  ProductMarkKey,
  SalesforceDiagramSpec,
} from "./types.ts";

const require = createRequire(import.meta.url);
const ICON_PACKAGE_ROOT = path.join(
  path.dirname(require.resolve("@salesforce-ux/design-system/package.json")),
  "assets",
  "icons",
);

export const PRODUCT_MARK_REGISTRY: Record<
  ProductMarkKey,
  { label: string; sourceUrl: string; assetPath?: string }
> = {
  salesforce_platform: {
    label: "Salesforce Platform",
    sourceUrl: "https://www.salesforce.com/news/stories/salesforce-brand-central/",
  },
  sales_cloud: {
    label: "Sales Cloud",
    sourceUrl: "https://www.salesforce.com/news/stories/salesforce-brand-central/",
  },
  service_cloud: {
    label: "Service Cloud",
    sourceUrl: "https://www.salesforce.com/news/stories/salesforce-brand-central/",
  },
  experience_cloud: {
    label: "Experience Cloud",
    sourceUrl: "https://www.salesforce.com/news/stories/salesforce-brand-central/",
  },
  marketing_cloud: {
    label: "Marketing Cloud",
    sourceUrl: "https://www.salesforce.com/news/stories/salesforce-brand-central/",
  },
  commerce_cloud: {
    label: "Commerce Cloud",
    sourceUrl: "https://www.salesforce.com/news/stories/salesforce-brand-central/",
  },
  data_360: {
    label: "Data 360",
    sourceUrl: "https://www.salesforce.com/news/stories/salesforce-brand-central/",
  },
  agentforce: {
    label: "Agentforce",
    sourceUrl: "https://www.salesforce.com/news/stories/salesforce-brand-central/",
  },
  mulesoft: { label: "MuleSoft", sourceUrl: "https://www.mulesoft.com/brand" },
  tableau: { label: "Tableau", sourceUrl: "https://www.tableau.com/about/media-download-center" },
  slack: { label: "Slack", sourceUrl: "https://slack.com/media-kit" },
};

const FAMILY_COLORS: Record<ObjectFamily, string> = {
  standard: "#5867E8",
  custom: "#06A59A",
  external: "#7E8A97",
  special: "#8E6CEF",
};

const FALLBACK_ICONS: Record<ObjectFamily, DiagramIcon> = {
  standard: { category: "standard", name: "record", color: FAMILY_COLORS.standard },
  custom: { category: "custom", name: "custom18", color: FAMILY_COLORS.custom },
  external: { category: "utility", name: "world", color: FAMILY_COLORS.external },
  special: { category: "standard", name: "record", color: FAMILY_COLORS.special },
};

const SYSTEM_FALLBACKS: Record<string, DiagramIcon> = {
  salesforce: { category: "utility", name: "apps", color: "#0176D3" },
  external: { category: "utility", name: "world", color: "#7E8A97" },
  user: { category: "utility", name: "user", color: "#9050E9" },
  data_store: { category: "utility", name: "database", color: "#0B827C" },
  integration: { category: "utility", name: "connected_apps", color: "#FE9339" },
};

export interface ResolvedVisualAssets {
  assets: CanvasAssetPayload[];
  nodeAssets: Map<string, { iconAssetId: string; tileAssetId: string }>;
  markerAssets: Map<EndpointCardinality, string>;
  warnings: string[];
}

export function resolveVisualAssets(
  spec: SalesforceDiagramSpec,
  cardinalityDetail: "simplified" | "full",
): ResolvedVisualAssets {
  const assets = new Map<string, CanvasAssetPayload>();
  const nodeAssets = new Map<string, { iconAssetId: string; tileAssetId: string }>();
  const warnings: string[] = [];
  const nodes =
    spec.family === "data_model"
      ? spec.objects
      : spec.family === "architecture"
        ? spec.systems
        : spec.participants;

  for (const node of nodes) {
    const visualNode = node as typeof node & { family?: ObjectFamily; kind?: string };
    const family: ObjectFamily =
      spec.family === "data_model"
        ? (visualNode.family ?? "special")
        : visualNode.kind === "salesforce"
          ? "standard"
          : visualNode.kind === "external"
            ? "external"
            : "special";
    const systemFallback =
      SYSTEM_FALLBACKS[visualNode.kind ?? "external"] ?? SYSTEM_FALLBACKS.external;
    let icon =
      node.icon ?? (spec.family === "data_model" ? FALLBACK_ICONS[family] : systemFallback);
    if ("product_mark" in node && node.product_mark) {
      const registry = PRODUCT_MARK_REGISTRY[node.product_mark];
      if (!registry?.assetPath)
        warnings.push(
          `${registry?.label ?? node.product_mark}: approved product-mark asset is not bundled; using the explicit semantic SLDS icon fallback.`,
        );
    }
    let resolved = readIcon(icon);
    if (!resolved) {
      const fallback = spec.family === "data_model" ? FALLBACK_ICONS[family] : systemFallback;
      warnings.push(
        `SLDS ${icon.category}/${icon.name} was not found; using ${fallback.category}/${fallback.name}.`,
      );
      icon = fallback;
      resolved = readIcon(icon);
    }
    if (!resolved)
      throw new Error(
        `Required fallback icon ${icon.category}/${icon.name} is missing from @salesforce-ux/design-system.`,
      );
    const iconId = stableAssetId(`icon-${icon.category}-${icon.name}`);
    const tileColor = icon.color ?? FAMILY_COLORS[family];
    const tileId = stableAssetId(`tile-${tileColor}`);
    assets.set(iconId, {
      id: iconId,
      name: path.basename(resolved.filePath),
      src: dataUrl(resolved.bytes, resolved.mimeType),
      mimeType: resolved.mimeType,
      width: 120,
      height: 120,
      attribution: {
        source: "https://www.npmjs.com/package/@salesforce-ux/design-system",
        license: "BSD-3-Clause",
        package: "@salesforce-ux/design-system",
        version: "2.264.0",
      },
    });
    if (!assets.has(tileId)) {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120"><rect width="120" height="120" rx="12" fill="${tileColor}"/></svg>`;
      assets.set(tileId, svgAsset(tileId, `tile-${tileColor}.svg`, svg, 120, 120));
    }
    nodeAssets.set(node.id, { iconAssetId: iconId, tileAssetId: tileId });
  }

  const markerAssets = new Map<EndpointCardinality, string>();
  const markerKinds: EndpointCardinality[] =
    cardinalityDetail === "full" ? ["one", "many", "zero_or_one", "zero_or_many"] : ["one", "many"];
  for (const kind of markerKinds) {
    const marker = markerDefinition(kind);
    const id = stableAssetId(`cardinality-${kind}`);
    assets.set(
      id,
      svgAsset(
        id,
        `cardinality-${kind}.svg`,
        marker.svg,
        marker.width,
        marker.height,
        marker.anchor,
      ),
    );
    markerAssets.set(kind, id);
  }
  if (cardinalityDetail === "simplified") {
    const one = markerAssets.get("one");
    const many = markerAssets.get("many");
    if (!one || !many) throw new Error("Simplified cardinality assets were not created.");
    markerAssets.set("zero_or_one", one);
    markerAssets.set("zero_or_many", many);
  }

  return { assets: [...assets.values()], nodeAssets, markerAssets, warnings };
}

function readIcon(icon: DiagramIcon): { filePath: string; bytes: Buffer; mimeType: string } | null {
  const dir = path.join(ICON_PACKAGE_ROOT, icon.category);
  const candidates = [`${icon.name}_120.png`, `${icon.name}.svg`, `${icon.name}_60.png`];
  for (const name of candidates) {
    const filePath = path.join(dir, name);
    if (!filePath.startsWith(`${dir}${path.sep}`) || !existsSync(filePath)) continue;
    return {
      filePath,
      bytes: readFileSync(filePath),
      mimeType: name.endsWith(".svg") ? "image/svg+xml" : "image/png",
    };
  }
  return null;
}

function markerDefinition(kind: EndpointCardinality): {
  svg: string;
  width: number;
  height: number;
  anchor: { x: number; y: number };
} {
  const style = `fill="none" stroke="#444" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"`;
  if (kind === "one")
    return {
      width: 32,
      height: 32,
      anchor: { x: 30, y: 16 },
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><path d="M30 3V29" ${style}/></svg>`,
    };
  if (kind === "many")
    return {
      width: 32,
      height: 32,
      anchor: { x: 32, y: 16 },
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><path d="M8 16L32 4M8 16H32M8 16L32 28" ${style}/></svg>`,
    };
  if (kind === "zero_or_one")
    return {
      width: 48,
      height: 32,
      anchor: { x: 46, y: 16 },
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="32" viewBox="0 0 48 32"><circle cx="14" cy="16" r="7" fill="#fff" stroke="#444" stroke-width="2.5"/><path d="M46 3V29" ${style}/></svg>`,
    };
  return {
    width: 48,
    height: 32,
    anchor: { x: 48, y: 16 },
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="32" viewBox="0 0 48 32"><circle cx="10" cy="16" r="7" fill="#fff" stroke="#444" stroke-width="2.5"/><path d="M24 16L48 4M24 16H48M24 16L48 28" ${style}/></svg>`,
  };
}

function stableAssetId(value: string): string {
  return `sf-tldraw-${createHash("sha256").update(value).digest("hex").slice(0, 20)}`;
}

function dataUrl(bytes: Buffer, mimeType: string): string {
  return `data:${mimeType};base64,${bytes.toString("base64")}`;
}

function svgAsset(
  id: string,
  name: string,
  svg: string,
  width: number,
  height: number,
  anchor?: { x: number; y: number },
): CanvasAssetPayload {
  return {
    id,
    name,
    src: dataUrl(Buffer.from(svg), "image/svg+xml"),
    mimeType: "image/svg+xml",
    width,
    height,
    anchor,
  };
}
