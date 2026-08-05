/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Gateway model resolution helpers.
 *
 * This module is the narrow seam where SF Pi delegates generic provider/model
 * parsing to Pi's native resolver while retaining discovered-catalog selection
 * rules. Keep scoped-model
 * enable/disable behavior in `pi-settings.ts`; that is SF Pi product logic,
 * not generic model parsing.
 */
import type { Api, Model } from "@earendil-works/pi-ai";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import { findMatchingModelId, resolvePreferredModelId } from "./models.ts";

export interface GatewayDefaultModelResolution {
  provider: string;
  modelId: string;
  source: "pi" | "discovered";
  model?: Model<Api>;
  warning?: string;
}

export interface ResolveGatewayDefaultModelOptions {
  modelRegistry: ModelRegistry;
  providerName: string;
  availableModelIds: string[];
  preferredModelIds: Array<string | undefined>;
}

export function resolveGatewayDefaultModelWithPi(
  options: ResolveGatewayDefaultModelOptions,
): GatewayDefaultModelResolution | undefined {
  const { modelRegistry, providerName, availableModelIds, preferredModelIds } = options;

  for (const preferredId of preferredModelIds) {
    const candidateId = findMatchingModelId(preferredId, availableModelIds);
    if (!candidateId) continue;

    const resolvedModel = modelRegistry.find(providerName, candidateId);

    if (
      resolvedModel &&
      resolvedModel.provider === providerName &&
      isRegisteredGatewayModel(modelRegistry, providerName, resolvedModel.id)
    ) {
      return {
        provider: providerName,
        modelId: resolvedModel.id,
        model: resolvedModel,
        source: "pi",
      };
    }
  }

  const discoveredModelId = resolvePreferredModelId(availableModelIds, preferredModelIds);
  if (!discoveredModelId) return undefined;

  return {
    provider: providerName,
    modelId: discoveredModelId,
    model: modelRegistry.find(providerName, discoveredModelId),
    source: "discovered",
  };
}

function isRegisteredGatewayModel(
  modelRegistry: ModelRegistry,
  providerName: string,
  modelId: string,
): boolean {
  return modelRegistry
    .getAll()
    .some((model) => model.provider === providerName && model.id === modelId);
}
