/* SPDX-License-Identifier: Apache-2.0 */
/** SLDS icon loading and deterministic cardinality-marker assets. */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import type {
  CanvasAssetPayload,
  DataModelObject,
  DiagramIcon,
  IconCategory,
  EndpointCardinality,
  ObjectFamily,
  SalesforceDiagramSpec,
} from "./types.ts";

const require = createRequire(import.meta.url);
const DESIGN_SYSTEM_ROOT = path.dirname(
  require.resolve("@salesforce-ux/design-system/package.json"),
);
const ICON_PACKAGE_ROOT = path.join(DESIGN_SYSTEM_ROOT, "assets", "icons");
const ICON_CSS_PATH = path.join(DESIGN_SYSTEM_ROOT, "css", "icons", "base", "index.css");

/**
 * SLDS ships each icon's authentic tile color as the fallback of the
 * `--slds-c-icon-color-background` custom property. Reading it keeps every object card's
 * icon chip in its real Salesforce color instead of collapsing a whole diagram to one
 * hue per object family.
 */
let sldsIconColors: Map<string, string> | undefined;

function iconColorKey(category: IconCategory, name: string): string {
  const slug = category === "custom" ? name.replace(/^custom/, "") : name.replace(/_/g, "-");
  return `${category}/${slug}`;
}

function loadSldsIconColors(): Map<string, string> {
  if (sldsIconColors) return sldsIconColors;
  const colors = new Map<string, string>();
  try {
    const css = readFileSync(ICON_CSS_PATH, "utf8");
    const rule =
      /\.slds-icon-(standard|custom|action|doctype)-([a-z0-9-]+)\s*\{\s*background-color:[^;]*?rgb\((\d+),\s*(\d+),\s*(\d+)\)/g;
    for (let match = rule.exec(css); match; match = rule.exec(css)) {
      const [, category, slug, r, g, b] = match;
      if (!category || !slug || !r || !g || !b) continue;
      const hex = [r, g, b]
        .map((channel) => Number(channel).toString(16).padStart(2, "0"))
        .join("");
      colors.set(`${category}/${slug}`, `#${hex}`);
    }
  } catch {
    // A missing or restructured stylesheet only costs authentic colors, never a render.
  }
  sldsIconColors = colors;
  return colors;
}

/** Last-resort tile colors when SLDS has no icon-specific color for a visual. */
const FAMILY_COLORS: Record<ObjectFamily, string> = {
  standard: "#5867E8",
  custom: "#E8792B",
  external: "#2E844A",
  special: "#D4508A",
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

const STANDARD_ICON_ALIASES: Record<string, string> = {
  currencytype: "currency",
  emailmessage: "email",
  event: "event",
  opportunitylineitem: "opportunity",
  orderitem: "orders",
  pricebook2: "pricebook",
  pricebookentry: "pricebook_entry",
  product2: "product",
  quote: "quotes",
  quotelineitem: "quotes",
  task: "task",
};

/** Infer a verified SLDS object icon when a zero-shot spec omits presentation metadata. */
function inferredDataModelIcon(node: DataModelObject): DiagramIcon | undefined {
  if (node.family !== "standard") return undefined;
  const withoutSuffix = node.api_name?.replace(/__(?:c|x|mdt)$/i, "") ?? "";
  const rawApi = withoutSuffix.split("__").at(-1) ?? "";
  const sources = [rawApi, node.api_name ?? "", node.label];
  const candidates = new Set<string>();
  for (const source of sources) {
    const compact = source.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
    if (STANDARD_ICON_ALIASES[compact]) candidates.add(STANDARD_ICON_ALIASES[compact]);
    const snake = source
      .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
      .replace(/[^A-Za-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .toLowerCase();
    if (snake) candidates.add(snake.replace(/_+2$/, ""));
  }
  for (const name of candidates) {
    const icon: DiagramIcon = { category: "standard", name };
    if (readIcon(icon)) return icon;
  }
  return undefined;
}

/** Cardinality markers are drawn in the tone of the relationship they terminate. */
export type MarkerTone = "neutral" | "master_detail";

const MARKER_TONE_STROKES: Record<MarkerTone, string> = {
  neutral: "#444444",
  // Matches the tldraw 'red' arrow stroke so a master-detail line and its
  // terminals read as one continuous mark.
  master_detail: "#E03131",
};

export function markerAssetKey(kind: EndpointCardinality, tone: MarkerTone): string {
  return `${kind}|${tone}`;
}

export interface ResolvedVisualAssets {
  assets: CanvasAssetPayload[];
  nodeAssets: Map<string, { iconAssetId: string; tileAssetId: string }>;
  /** Keyed by markerAssetKey(cardinality, tone). */
  markerAssets: Map<string, string>;
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
      node.icon ??
      (spec.family === "data_model"
        ? (inferredDataModelIcon(node as DataModelObject) ?? FALLBACK_ICONS[family])
        : systemFallback);
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
    const tileColor =
      icon.color ??
      loadSldsIconColors().get(iconColorKey(icon.category, icon.name)) ??
      FAMILY_COLORS[family];
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

  const markerAssets = new Map<string, string>();
  const markerKinds: EndpointCardinality[] =
    cardinalityDetail === "full" ? ["one", "many", "zero_or_one", "zero_or_many"] : ["one", "many"];
  const tones: MarkerTone[] = ["neutral", "master_detail"];
  for (const tone of tones) {
    for (const kind of markerKinds) {
      const marker = markerDefinition(kind, MARKER_TONE_STROKES[tone]);
      const id = stableAssetId(`cardinality-${kind}-${tone}`);
      assets.set(
        id,
        svgAsset(
          id,
          `cardinality-${kind}-${tone}.svg`,
          marker.svg,
          marker.width,
          marker.height,
          marker.anchor,
        ),
      );
      markerAssets.set(markerAssetKey(kind, tone), id);
    }
    if (cardinalityDetail === "simplified") {
      const one = markerAssets.get(markerAssetKey("one", tone));
      const many = markerAssets.get(markerAssetKey("many", tone));
      if (!one || !many) throw new Error("Simplified cardinality assets were not created.");
      markerAssets.set(markerAssetKey("zero_or_one", tone), one);
      markerAssets.set(markerAssetKey("zero_or_many", tone), many);
    }
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

function markerDefinition(
  kind: EndpointCardinality,
  stroke: string,
): {
  svg: string;
  width: number;
  height: number;
  anchor: { x: number; y: number };
} {
  const style = `fill="none" stroke="${stroke}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"`;
  if (kind === "one")
    return {
      width: 32,
      height: 32,
      anchor: { x: 30, y: 16 },
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><path d="M30 2V30" ${style}/></svg>`,
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
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="32" viewBox="0 0 48 32"><circle cx="14" cy="16" r="7" fill="#fff" stroke="${stroke}" stroke-width="3.2"/><path d="M46 2V30" ${style}/></svg>`,
    };
  return {
    width: 48,
    height: 32,
    anchor: { x: 48, y: 16 },
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="32" viewBox="0 0 48 32"><circle cx="10" cy="16" r="7" fill="#fff" stroke="${stroke}" stroke-width="3.2"/><path d="M24 16L48 4M24 16H48M24 16L48 28" ${style}/></svg>`,
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
