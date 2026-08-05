/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Gateway endpoint URL helpers.
 *
 * The public OpenAI-compatible API is rooted at `/v1`, while gateway admin
 * routes such as `/user/info` live at the gateway root. Users may configure
 * either form, so normalize at the call site instead of requiring one exact
 * input shape.
 *
 * The only recognized suffix is the public OpenAI-compatible `/v1` path.
 * Deployment-specific suffixes are not interpreted by the public client.
 */

const V1_SUFFIX_PATTERN = /\/v1$/i;

function trimTrailingSlashes(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

function stripKnownGatewaySuffixes(baseUrl: string): string {
  return trimTrailingSlashes(baseUrl).replace(V1_SUFFIX_PATTERN, "");
}

export function toGatewayOpenAiBaseUrl(baseUrl: string): string {
  const root = toGatewayRootBaseUrl(baseUrl);
  return root ? `${root}/v1` : "";
}

export function toGatewayRootBaseUrl(baseUrl: string): string {
  return stripKnownGatewaySuffixes(baseUrl);
}
