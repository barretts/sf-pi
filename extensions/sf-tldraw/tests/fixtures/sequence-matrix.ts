/* SPDX-License-Identifier: Apache-2.0 */
import type {
  SequenceActivation,
  SequenceInteraction,
  SequenceParticipant,
  SequenceSpec,
} from "../../lib/types.ts";

type ParticipantDef = [id: string, label: string, kind: SequenceParticipant["kind"]];
type InteractionDef = [from: string, to: string, label: string, kind: SequenceInteraction["kind"]];
type ActivationDef = [id: string, participant: string, startStep: number, endStep: number];

interface FlowDef {
  slug: string;
  category: "oauth" | "sso" | "integration";
  title: string;
  sourceLabel: string;
  sourceUrl: string;
  participants: ParticipantDef[];
  interactions: InteractionDef[];
  activations?: ActivationDef[];
}

export interface SequenceMatrixCase {
  slug: string;
  category: FlowDef["category"];
  spec: SequenceSpec;
}

const OAUTH_WEB =
  "https://developer.salesforce.com/docs/platform/mobile-sdk/guide/oauth-web-server-flow.html";
const OAUTH_PKCE =
  "https://developer.salesforce.com/docs/analytics/sdk/guide/sdk-setup-tn-auth.html";
const OAUTH_REFRESH =
  "https://developer.salesforce.com/docs/platform/mobile-sdk/guide/oauth-refresh-token-flow.html";
const OAUTH_JWT =
  "https://developer.salesforce.com/docs/analytics/sdk/guide/sdk-setup-auth-extended.html";
const OAUTH_CLIENT_CREDENTIALS =
  "https://developer.salesforce.com/docs/industries/loyalty/guide/authorization.html";
const OAUTH_USER_AGENT =
  "https://developer.salesforce.com/docs/platform/mobile-sdk/guide/oauth-useragent-flow.html";
const OAUTH_REVOKE =
  "https://developer.salesforce.com/docs/platform/mobile-sdk/guide/oauth-revoking-tokens.html";
const OAUTH_IDENTITY =
  "https://developer.salesforce.com/docs/platform/mobile-sdk/guide/oauth-intro-flow.html";
const SSO_AUTH_PROVIDER =
  "https://developer.salesforce.com/docs/platform/mobile-sdk/guide/sso-authentication-providers.html";
const SSO_OIDC =
  "https://developer.salesforce.com/docs/platform/mobile-sdk/guide/sso-provider-openid-connect.html";
const SSO_SALESFORCE_PROVIDER =
  "https://developer.salesforce.com/docs/platform/mobile-sdk/guide/sso-provider-sfdc.html";
const SSO_IDENTITY =
  "https://developer.salesforce.com/docs/platform/mobile-sdk/guide/auth-identity-arch-flow-general.html";
const SSO_CANVAS =
  "https://developer.salesforce.com/docs/atlas.en-us.platform_connect.meta/platform_connect/canvas_app_saml_sso_intro.htm";
const SSO_HEADLESS =
  "https://developer.salesforce.com/docs/atlas.en-us.headless_identity.meta/headless_identity/headless_identity_single_sign_on.htm";
const INTEGRATION_PATTERNS =
  "https://architect.salesforce.com/docs/architect/fundamentals/guide/integration-patterns";
const EVENT_DRIVEN =
  "https://architect.salesforce.com/docs/architect/decision-guides/guide/event-driven";
const DATA_INTEGRATION =
  "https://architect.salesforce.com/docs/architect/decision-guides/guide/data-integration";
const PUB_SUB =
  "https://developer.salesforce.com/docs/platform/pub-sub-api/guide/event-message-durability.html";
const COMPOSITE =
  "https://developer.salesforce.com/docs/platform/mobile-sdk/guide/android-rest-apis-batch-composite.html";
const BATCH =
  "https://developer.salesforce.com/docs/platform/mobile-sdk/guide/ref-rest-apis-batch-request.html";

const FLOW_DEFS: FlowDef[] = [
  {
    slug: "oauth-authorization-code-pkce",
    category: "oauth",
    title: "OAuth authorization code with PKCE",
    sourceLabel: "External client app PKCE setup",
    sourceUrl: OAUTH_PKCE,
    participants: [
      ["browser", "User Browser", "external"],
      ["client", "Web App / Backend-for-Frontend", "integration"],
      ["oauth", "Salesforce Authorization Server", "salesforce"],
      ["api", "Salesforce REST APIs", "salesforce"],
    ],
    interactions: [
      ["browser", "client", "Request a protected route", "request"],
      ["client", "browser", "Redirect with state and PKCE challenge", "response"],
      ["browser", "oauth", "Request authorization and user consent", "request"],
      ["oauth", "browser", "Redirect to the approved callback with a code", "response"],
      ["browser", "client", "Deliver the authorization callback", "request"],
      ["client", "oauth", "Exchange the code and PKCE verifier", "request"],
      ["oauth", "client", "Return access and refresh tokens", "response"],
      ["client", "api", "Call the API with the access token", "request"],
      ["api", "client", "Return the authorized resource", "response"],
    ],
    activations: [
      ["client-login", "client", 1, 2],
      ["authorization", "oauth", 3, 4],
      ["token-exchange", "oauth", 6, 7],
      ["api-work", "api", 8, 9],
    ],
  },
  {
    slug: "oauth-web-server-secret",
    category: "oauth",
    title: "OAuth web server flow with client authentication",
    sourceLabel: "OAuth web server flow",
    sourceUrl: OAUTH_WEB,
    participants: [
      ["user", "End User", "user"],
      ["browser", "User Browser", "external"],
      ["server", "Confidential Web Server", "integration"],
      ["oauth", "Salesforce Authorization Server", "salesforce"],
      ["api", "Salesforce APIs", "salesforce"],
    ],
    interactions: [
      ["user", "browser", "Open the application", "request"],
      ["browser", "server", "Request sign-in", "request"],
      ["server", "browser", "Redirect to Salesforce authorization", "response"],
      ["browser", "oauth", "Authenticate and approve access", "request"],
      ["oauth", "browser", "Return an authorization code", "response"],
      ["browser", "server", "Deliver the callback code", "request"],
      ["server", "oauth", "Exchange code with client authentication", "request"],
      ["oauth", "server", "Return OAuth tokens", "response"],
      ["server", "api", "Call a protected resource", "request"],
      ["api", "server", "Return API data", "response"],
    ],
  },
  {
    slug: "oauth-refresh-token",
    category: "oauth",
    title: "OAuth refresh token renewal",
    sourceLabel: "OAuth refresh token flow",
    sourceUrl: OAUTH_REFRESH,
    participants: [
      ["app", "Client Application", "integration"],
      ["vault", "Secure Token Store", "data_store"],
      ["oauth", "Salesforce Authorization Server", "salesforce"],
      ["api", "Salesforce APIs", "salesforce"],
    ],
    interactions: [
      ["app", "vault", "Read the stored refresh token", "request"],
      ["vault", "app", "Return the refresh token", "response"],
      ["app", "oauth", "Request a new access token", "request"],
      ["oauth", "app", "Return a new access token", "response"],
      ["app", "vault", "Update the OAuth session metadata", "request"],
      ["app", "api", "Retry the protected API request", "request"],
      ["api", "app", "Return the requested data", "response"],
    ],
    activations: [
      ["token-renewal", "oauth", 3, 4],
      ["api-work", "api", 6, 7],
    ],
  },
  {
    slug: "oauth-jwt-bearer",
    category: "oauth",
    title: "OAuth JWT bearer server-to-server flow",
    sourceLabel: "JWT bearer flow",
    sourceUrl: OAUTH_JWT,
    participants: [
      ["scheduler", "Job Scheduler", "external"],
      ["service", "Integration Service", "integration"],
      ["keys", "Signing Key Store", "data_store"],
      ["oauth", "Salesforce Authorization Server", "salesforce"],
      ["api", "Salesforce APIs", "salesforce"],
    ],
    interactions: [
      ["scheduler", "service", "Start the scheduled integration", "event"],
      ["service", "keys", "Read the signing key", "request"],
      ["keys", "service", "Return key material handle", "response"],
      ["service", "oauth", "Submit the signed JWT bearer assertion", "request"],
      ["oauth", "service", "Return an access token", "response"],
      ["service", "api", "Invoke the Salesforce API", "request"],
      ["api", "service", "Return the integration response", "response"],
      ["service", "scheduler", "Report job completion", "async"],
    ],
  },
  {
    slug: "oauth-client-credentials",
    category: "oauth",
    title: "OAuth client credentials service flow",
    sourceLabel: "External client app client credentials flow",
    sourceUrl: OAUTH_CLIENT_CREDENTIALS,
    participants: [
      ["caller", "Backend Service", "integration"],
      ["vault", "Credential Vault", "data_store"],
      ["policy", "External Client App Policy", "salesforce"],
      ["oauth", "Salesforce Authorization Server", "salesforce"],
      ["api", "Salesforce APIs", "salesforce"],
    ],
    interactions: [
      ["caller", "vault", "Read the client credential", "request"],
      ["vault", "caller", "Return the credential handle", "response"],
      ["caller", "oauth", "Request an access token", "request"],
      ["oauth", "policy", "Evaluate the configured run-as policy", "request"],
      ["policy", "oauth", "Approve the client policy", "response"],
      ["oauth", "caller", "Return an access token", "response"],
      ["caller", "api", "Invoke the service API", "request"],
      ["api", "caller", "Return the service response", "response"],
    ],
  },
  {
    slug: "oauth-device-authorization",
    category: "oauth",
    title: "OAuth device authorization interaction",
    sourceLabel: "OAuth authentication flow",
    sourceUrl: OAUTH_IDENTITY,
    participants: [
      ["user", "End User", "user"],
      ["device", "Limited-Input Device", "external"],
      ["browser", "Verification Browser", "external"],
      ["oauth", "Salesforce Authorization Server", "salesforce"],
      ["api", "Salesforce APIs", "salesforce"],
    ],
    interactions: [
      ["device", "oauth", "Request a device verification code", "request"],
      ["oauth", "device", "Return verification URI and user code", "response"],
      ["device", "user", "Display the verification instructions", "event"],
      ["user", "browser", "Open the verification URI", "request"],
      ["browser", "oauth", "Authenticate and approve the device", "request"],
      ["oauth", "browser", "Confirm device authorization", "response"],
      ["device", "oauth", "Poll for authorization completion", "request"],
      ["oauth", "device", "Return an access token", "response"],
      ["device", "api", "Call the Salesforce API", "request"],
      ["api", "device", "Return the protected resource", "response"],
    ],
  },
  {
    slug: "oauth-user-agent",
    category: "oauth",
    title: "OAuth user-agent browser flow",
    sourceLabel: "OAuth user-agent flow",
    sourceUrl: OAUTH_USER_AGENT,
    participants: [
      ["user", "End User", "user"],
      ["spa", "Browser Application", "external"],
      ["oauth", "Salesforce Authorization Server", "salesforce"],
      ["api", "Salesforce APIs", "salesforce"],
    ],
    interactions: [
      ["user", "spa", "Choose to sign in", "request"],
      ["spa", "oauth", "Open the authorization request", "request"],
      ["oauth", "user", "Authenticate and request approval", "request"],
      ["user", "oauth", "Approve requested access", "response"],
      ["oauth", "spa", "Return the authorization result", "response"],
      ["spa", "api", "Call the API with the access token", "request"],
      ["api", "spa", "Return the protected resource", "response"],
    ],
  },
  {
    slug: "oauth-token-revocation",
    category: "oauth",
    title: "OAuth logout and token revocation",
    sourceLabel: "Revoking OAuth tokens",
    sourceUrl: OAUTH_REVOKE,
    participants: [
      ["user", "End User", "user"],
      ["app", "Client Application", "integration"],
      ["vault", "Secure Token Store", "data_store"],
      ["oauth", "Salesforce Authorization Server", "salesforce"],
      ["api", "Salesforce APIs", "salesforce"],
    ],
    interactions: [
      ["user", "app", "Sign out of the application", "request"],
      ["app", "vault", "Read the refresh token handle", "request"],
      ["vault", "app", "Return the token handle", "response"],
      ["app", "oauth", "Revoke the refresh token", "request"],
      ["oauth", "app", "Confirm token revocation", "response"],
      ["app", "vault", "Delete local OAuth session state", "request"],
      ["app", "api", "Attempt a later API request", "request"],
      ["api", "app", "Reject the invalid session", "response"],
      ["app", "user", "Require a new sign-in", "event"],
    ],
  },
  {
    slug: "oauth-token-exchange",
    category: "oauth",
    title: "OAuth external identity token exchange",
    sourceLabel: "Salesforce OAuth authentication",
    sourceUrl: OAUTH_IDENTITY,
    participants: [
      ["user", "End User", "user"],
      ["client", "Client Application", "integration"],
      ["idp", "External Identity Provider", "external"],
      ["oauth", "Salesforce Authorization Server", "salesforce"],
      ["api", "Salesforce APIs", "salesforce"],
    ],
    interactions: [
      ["user", "idp", "Authenticate with the external identity provider", "request"],
      ["idp", "client", "Return the external identity token", "response"],
      ["client", "oauth", "Submit the token exchange request", "request"],
      ["oauth", "idp", "Validate external token context", "request"],
      ["idp", "oauth", "Return validation result", "response"],
      ["oauth", "client", "Return a Salesforce access token", "response"],
      ["client", "api", "Call the Salesforce API", "request"],
      ["api", "client", "Return authorized data", "response"],
    ],
  },
  {
    slug: "sso-saml-sp-initiated",
    category: "sso",
    title: "SAML service-provider-initiated SSO",
    sourceLabel: "Salesforce identity provider architecture",
    sourceUrl: SSO_IDENTITY,
    participants: [
      ["user", "End User", "user"],
      ["browser", "User Browser", "external"],
      ["salesforce", "Salesforce Service Provider", "salesforce"],
      ["idp", "Enterprise Identity Provider", "external"],
    ],
    interactions: [
      ["user", "browser", "Open a protected Salesforce URL", "request"],
      ["browser", "salesforce", "Request the protected resource", "request"],
      ["salesforce", "browser", "Redirect with a SAML authentication request", "response"],
      ["browser", "idp", "Deliver the authentication request", "request"],
      ["idp", "user", "Authenticate the user", "request"],
      ["user", "idp", "Complete identity verification", "response"],
      ["idp", "browser", "Post the signed SAML response", "response"],
      ["browser", "salesforce", "Deliver the assertion to the ACS endpoint", "request"],
      ["salesforce", "browser", "Create the Salesforce session", "response"],
    ],
  },
  {
    slug: "sso-saml-idp-initiated",
    category: "sso",
    title: "SAML identity-provider-initiated SSO",
    sourceLabel: "Salesforce identity provider architecture",
    sourceUrl: SSO_IDENTITY,
    participants: [
      ["user", "End User", "user"],
      ["browser", "User Browser", "external"],
      ["idp", "Enterprise Identity Provider", "external"],
      ["salesforce", "Salesforce Service Provider", "salesforce"],
    ],
    interactions: [
      ["user", "browser", "Open the identity provider portal", "request"],
      ["browser", "idp", "Request the Salesforce application", "request"],
      ["idp", "user", "Authenticate the user when required", "request"],
      ["user", "idp", "Complete authentication", "response"],
      ["idp", "browser", "Post a signed SAML response", "response"],
      ["browser", "salesforce", "Deliver the assertion to Salesforce", "request"],
      ["salesforce", "browser", "Create the session and open the start URL", "response"],
    ],
  },
  {
    slug: "sso-salesforce-as-saml-idp",
    category: "sso",
    title: "Salesforce as a SAML identity provider",
    sourceLabel: "Salesforce identity provider architecture",
    sourceUrl: SSO_IDENTITY,
    participants: [
      ["user", "End User", "user"],
      ["browser", "User Browser", "external"],
      ["salesforce", "Salesforce Identity Provider", "salesforce"],
      ["service", "External Service Provider", "external"],
    ],
    interactions: [
      ["user", "browser", "Choose the external application", "request"],
      ["browser", "salesforce", "Request identity-provider sign-on", "request"],
      ["salesforce", "user", "Verify the Salesforce session", "request"],
      ["user", "salesforce", "Complete authentication when required", "response"],
      ["salesforce", "browser", "Post the signed SAML assertion", "response"],
      ["browser", "service", "Deliver the assertion to the ACS endpoint", "request"],
      ["service", "browser", "Create the external application session", "response"],
    ],
  },
  {
    slug: "sso-oidc-auth-provider",
    category: "sso",
    title: "OpenID Connect authentication provider SSO",
    sourceLabel: "OpenID Connect authentication provider",
    sourceUrl: SSO_OIDC,
    participants: [
      ["user", "End User", "user"],
      ["browser", "User Browser", "external"],
      ["salesforce", "Salesforce Relying Party", "salesforce"],
      ["provider", "OpenID Connect Provider", "external"],
      ["userinfo", "UserInfo Endpoint", "external"],
    ],
    interactions: [
      ["user", "browser", "Choose federated sign-in", "request"],
      ["browser", "salesforce", "Start authentication-provider login", "request"],
      ["salesforce", "browser", "Redirect to the OpenID provider", "response"],
      ["browser", "provider", "Request authentication and consent", "request"],
      ["provider", "browser", "Return the authorization response", "response"],
      ["browser", "salesforce", "Deliver the authorization callback", "request"],
      ["salesforce", "provider", "Exchange the code for tokens", "request"],
      ["provider", "salesforce", "Return ID and access tokens", "response"],
      ["salesforce", "userinfo", "Request additional identity claims", "request"],
      ["userinfo", "salesforce", "Return user claims", "response"],
      ["salesforce", "browser", "Create the Salesforce session", "response"],
    ],
  },
  {
    slug: "sso-salesforce-auth-provider",
    category: "sso",
    title: "External application sign-in with Salesforce identity",
    sourceLabel: "Salesforce authentication provider",
    sourceUrl: SSO_SALESFORCE_PROVIDER,
    participants: [
      ["user", "End User", "user"],
      ["browser", "User Browser", "external"],
      ["app", "External Relying Application", "integration"],
      ["salesforce", "Salesforce Identity Provider", "salesforce"],
    ],
    interactions: [
      ["user", "browser", "Open the external application", "request"],
      ["browser", "app", "Choose sign in with Salesforce", "request"],
      ["app", "browser", "Redirect to Salesforce authorization", "response"],
      ["browser", "salesforce", "Authenticate and approve identity access", "request"],
      ["salesforce", "browser", "Return the authorization response", "response"],
      ["browser", "app", "Deliver the callback", "request"],
      ["app", "salesforce", "Exchange the authorization code", "request"],
      ["salesforce", "app", "Return identity and access tokens", "response"],
      ["app", "browser", "Create the external application session", "response"],
    ],
  },
  {
    slug: "sso-headless-native",
    category: "sso",
    title: "Headless native single sign-on",
    sourceLabel: "Headless identity native SSO",
    sourceUrl: SSO_HEADLESS,
    participants: [
      ["user", "Mobile User", "user"],
      ["app", "Native Application", "external"],
      ["browser", "System Browser", "external"],
      ["salesforce", "Salesforce Identity Service", "salesforce"],
      ["idp", "Federated Identity Provider", "external"],
    ],
    interactions: [
      ["user", "app", "Start native sign-in", "request"],
      ["app", "browser", "Open the Salesforce authorization URL", "request"],
      ["browser", "salesforce", "Request the configured login option", "request"],
      ["salesforce", "browser", "Redirect to the federated provider", "response"],
      ["browser", "idp", "Authenticate the user", "request"],
      ["idp", "browser", "Return the federated assertion", "response"],
      ["browser", "salesforce", "Complete Salesforce authorization", "request"],
      ["salesforce", "browser", "Redirect to the native callback", "response"],
      ["browser", "app", "Deliver the authorization result", "request"],
      ["app", "user", "Open the authenticated experience", "response"],
    ],
  },
  {
    slug: "sso-canvas-saml",
    category: "sso",
    title: "Canvas application SAML single sign-on",
    sourceLabel: "SAML SSO for Canvas apps",
    sourceUrl: SSO_CANVAS,
    participants: [
      ["user", "Salesforce User", "user"],
      ["salesforce", "Salesforce Canvas Host", "salesforce"],
      ["idp", "SAML Identity Provider", "external"],
      ["canvas", "External Canvas Application", "integration"],
    ],
    interactions: [
      ["user", "salesforce", "Open the canvas application", "request"],
      ["salesforce", "idp", "Request a SAML assertion", "request"],
      ["idp", "salesforce", "Return the signed SAML response", "response"],
      ["salesforce", "canvas", "Launch the canvas application with SSO context", "request"],
      ["canvas", "salesforce", "Validate the signed request context", "response"],
      ["canvas", "user", "Render the authenticated application", "response"],
    ],
  },
  {
    slug: "sso-auth-provider-routing",
    category: "sso",
    title: "Authentication provider routing and registration",
    sourceLabel: "Authentication provider SSO",
    sourceUrl: SSO_AUTH_PROVIDER,
    participants: [
      ["user", "End User", "user"],
      ["site", "Experience Cloud Site", "salesforce"],
      ["router", "Login Discovery Handler", "integration"],
      ["provider", "External Authentication Provider", "external"],
      ["registration", "Registration Handler", "integration"],
      ["directory", "Salesforce User Directory", "data_store"],
    ],
    interactions: [
      ["user", "site", "Submit the sign-in identifier", "request"],
      ["site", "router", "Resolve the configured identity provider", "request"],
      ["router", "site", "Return the provider route", "response"],
      ["site", "provider", "Redirect for authentication", "request"],
      ["provider", "site", "Return the federated identity", "response"],
      ["site", "registration", "Invoke identity registration mapping", "request"],
      ["registration", "directory", "Find or create the Salesforce user", "request"],
      ["directory", "registration", "Return the user record", "response"],
      ["registration", "site", "Return the authenticated user", "response"],
      ["site", "user", "Open the authenticated site", "response"],
    ],
  },
  {
    slug: "integration-request-reply",
    category: "integration",
    title: "Remote process invocation request and reply",
    sourceLabel: "Salesforce integration patterns",
    sourceUrl: INTEGRATION_PATTERNS,
    participants: [
      ["user", "Salesforce User", "user"],
      ["salesforce", "Salesforce Application", "salesforce"],
      ["gateway", "Integration Gateway", "integration"],
      ["erp", "Remote Business System", "external"],
    ],
    interactions: [
      ["user", "salesforce", "Submit the business operation", "request"],
      ["salesforce", "gateway", "Invoke the remote process", "request"],
      ["gateway", "erp", "Call the remote business service", "request"],
      ["erp", "gateway", "Return the business result", "response"],
      ["gateway", "salesforce", "Return the normalized response", "response"],
      ["salesforce", "user", "Display the completed result", "response"],
    ],
  },
  {
    slug: "integration-fire-forget",
    category: "integration",
    title: "Remote process invocation fire and forget",
    sourceLabel: "Salesforce integration patterns",
    sourceUrl: INTEGRATION_PATTERNS,
    participants: [
      ["salesforce", "Salesforce Automation", "salesforce"],
      ["gateway", "Integration Gateway", "integration"],
      ["queue", "Durable Work Queue", "data_store"],
      ["remote", "Remote Processing Service", "external"],
    ],
    interactions: [
      ["salesforce", "gateway", "Submit the outbound operation", "async"],
      ["gateway", "queue", "Persist the work item", "request"],
      ["queue", "gateway", "Acknowledge durable storage", "response"],
      ["gateway", "salesforce", "Acknowledge accepted processing", "response"],
      ["queue", "remote", "Dispatch the queued work", "async"],
      ["remote", "queue", "Record processing completion", "event"],
    ],
  },
  {
    slug: "integration-batch-sync",
    category: "integration",
    title: "Scheduled batch data synchronization",
    sourceLabel: "Salesforce data integration guide",
    sourceUrl: DATA_INTEGRATION,
    participants: [
      ["scheduler", "Batch Scheduler", "external"],
      ["source", "Source Data Store", "data_store"],
      ["etl", "ETL Integration Service", "integration"],
      ["salesforce", "Salesforce Bulk Interface", "salesforce"],
      ["errors", "Error and Replay Store", "data_store"],
    ],
    interactions: [
      ["scheduler", "etl", "Start the scheduled synchronization", "event"],
      ["etl", "source", "Read the changed source records", "request"],
      ["source", "etl", "Return the batch data", "response"],
      ["etl", "salesforce", "Submit the normalized bulk job", "request"],
      ["salesforce", "etl", "Return the bulk job identifier", "response"],
      ["etl", "salesforce", "Poll the job status", "request"],
      ["salesforce", "etl", "Return success and failure results", "response"],
      ["etl", "errors", "Persist failed rows for replay", "async"],
      ["etl", "scheduler", "Report the batch summary", "async"],
    ],
  },
  {
    slug: "integration-platform-event-fanout",
    category: "integration",
    title: "Platform event publish and fan-out",
    sourceLabel: "Salesforce event-driven architecture",
    sourceUrl: EVENT_DRIVEN,
    participants: [
      ["publisher", "Salesforce Publisher", "salesforce"],
      ["bus", "Salesforce Event Bus", "salesforce"],
      ["consumerA", "Order Consumer", "integration"],
      ["consumerB", "Analytics Consumer", "integration"],
      ["erp", "External ERP", "external"],
      ["lake", "Analytics Data Store", "data_store"],
    ],
    interactions: [
      ["publisher", "bus", "Publish the business event", "event"],
      ["bus", "publisher", "Confirm accepted publication", "response"],
      ["bus", "consumerA", "Deliver the event to the order consumer", "async"],
      ["bus", "consumerB", "Deliver the event to the analytics consumer", "async"],
      ["consumerA", "erp", "Apply the order update", "request"],
      ["erp", "consumerA", "Return the processing result", "response"],
      ["consumerB", "lake", "Append the analytics event", "async"],
    ],
  },
  {
    slug: "integration-change-data-capture",
    category: "integration",
    title: "Change Data Capture subscriber flow",
    sourceLabel: "Pub/Sub API event durability",
    sourceUrl: PUB_SUB,
    participants: [
      ["user", "Salesforce User", "user"],
      ["salesforce", "Salesforce Transaction", "salesforce"],
      ["bus", "Change Event Bus", "salesforce"],
      ["subscriber", "External CDC Subscriber", "integration"],
      ["store", "Downstream Data Store", "data_store"],
      ["replay", "Replay Cursor Store", "data_store"],
    ],
    interactions: [
      ["user", "salesforce", "Commit the record change", "request"],
      ["salesforce", "bus", "Publish the change event", "event"],
      ["bus", "subscriber", "Deliver the change event", "async"],
      ["subscriber", "store", "Apply the downstream change", "request"],
      ["store", "subscriber", "Confirm durable update", "response"],
      ["subscriber", "replay", "Persist the replay identifier", "request"],
      ["subscriber", "bus", "Resume after a disconnect", "request"],
      ["bus", "subscriber", "Replay retained change events", "async"],
    ],
  },
  {
    slug: "integration-outbound-message",
    category: "integration",
    title: "Outbound message delivery and retry",
    sourceLabel: "Salesforce integration patterns",
    sourceUrl: INTEGRATION_PATTERNS,
    participants: [
      ["automation", "Salesforce Automation", "salesforce"],
      ["outbound", "Outbound Messaging Service", "salesforce"],
      ["endpoint", "External SOAP Endpoint", "external"],
      ["retry", "Salesforce Retry Queue", "data_store"],
      ["ops", "Operations Monitor", "user"],
    ],
    interactions: [
      ["automation", "outbound", "Create the outbound notification", "event"],
      ["outbound", "endpoint", "Deliver the SOAP message", "async"],
      ["endpoint", "outbound", "Return an unsuccessful acknowledgement", "response"],
      ["outbound", "retry", "Schedule the message for retry", "async"],
      ["retry", "outbound", "Release the message for redelivery", "event"],
      ["outbound", "endpoint", "Redeliver the SOAP message", "async"],
      ["endpoint", "outbound", "Return a successful acknowledgement", "response"],
      ["outbound", "ops", "Publish delivery status", "event"],
    ],
  },
  {
    slug: "integration-composite-api",
    category: "integration",
    title: "Composite API transactional orchestration",
    sourceLabel: "Salesforce batch and composite requests",
    sourceUrl: COMPOSITE,
    participants: [
      ["client", "External Client", "external"],
      ["gateway", "API Gateway", "integration"],
      ["composite", "Salesforce Composite API", "salesforce"],
      ["accounts", "Account Resource", "salesforce"],
      ["contacts", "Contact Resource", "salesforce"],
      ["cases", "Case Resource", "salesforce"],
    ],
    interactions: [
      ["client", "gateway", "Submit the composite request", "request"],
      ["gateway", "composite", "Forward the validated request", "request"],
      ["composite", "accounts", "Create the account subrequest", "request"],
      ["accounts", "composite", "Return the account reference", "response"],
      ["composite", "contacts", "Create the related contact", "request"],
      ["contacts", "composite", "Return the contact result", "response"],
      ["composite", "cases", "Create the related case", "request"],
      ["cases", "composite", "Return the case result", "response"],
      ["composite", "gateway", "Return the composite response", "response"],
      ["gateway", "client", "Return the normalized result", "response"],
    ],
  },
  {
    slug: "integration-webhook-callback",
    category: "integration",
    title: "Asynchronous request with webhook callback",
    sourceLabel: "Salesforce integration patterns",
    sourceUrl: INTEGRATION_PATTERNS,
    participants: [
      ["salesforce", "Salesforce Application", "salesforce"],
      ["gateway", "Integration Gateway", "integration"],
      ["remote", "External Processing Service", "external"],
      ["callback", "Salesforce Callback Endpoint", "salesforce"],
      ["status", "Integration Status Store", "data_store"],
    ],
    interactions: [
      ["salesforce", "gateway", "Submit the long-running request", "async"],
      ["gateway", "remote", "Start external processing", "async"],
      ["remote", "gateway", "Acknowledge accepted processing", "response"],
      ["gateway", "status", "Persist the correlation identifier", "request"],
      ["remote", "callback", "Post the completed callback", "event"],
      ["callback", "status", "Resolve the correlation state", "request"],
      ["status", "callback", "Return the pending Salesforce work", "response"],
      ["callback", "salesforce", "Apply the completed result", "async"],
    ],
  },
  {
    slug: "integration-retry-dead-letter",
    category: "integration",
    title: "Integration retry and dead-letter handling",
    sourceLabel: "Salesforce event-driven architecture",
    sourceUrl: EVENT_DRIVEN,
    participants: [
      ["salesforce", "Salesforce Publisher", "salesforce"],
      ["worker", "Integration Worker", "integration"],
      ["remote", "Remote API", "external"],
      ["retry", "Retry Queue", "data_store"],
      ["deadletter", "Dead-Letter Queue", "data_store"],
      ["ops", "Operations Team", "user"],
    ],
    interactions: [
      ["salesforce", "worker", "Publish the integration work item", "async"],
      ["worker", "remote", "Invoke the remote API", "request"],
      ["remote", "worker", "Return a transient failure", "response"],
      ["worker", "retry", "Schedule a bounded retry", "async"],
      ["retry", "worker", "Release the work item", "event"],
      ["worker", "remote", "Retry the remote API", "request"],
      ["remote", "worker", "Return a terminal failure", "response"],
      ["worker", "deadletter", "Persist the failed work item", "async"],
      ["deadletter", "ops", "Notify operations for remediation", "event"],
      ["ops", "worker", "Request an approved replay", "request"],
    ],
  },
  {
    slug: "integration-external-object",
    category: "integration",
    title: "External object data virtualization",
    sourceLabel: "Salesforce data integration guide",
    sourceUrl: DATA_INTEGRATION,
    participants: [
      ["user", "Salesforce User", "user"],
      ["salesforce", "Salesforce External Object", "salesforce"],
      ["adapter", "External Data Adapter", "integration"],
      ["service", "OData Service", "external"],
      ["database", "External Database", "data_store"],
    ],
    interactions: [
      ["user", "salesforce", "Open the external record list", "request"],
      ["salesforce", "adapter", "Request the external data page", "request"],
      ["adapter", "service", "Translate and send the OData query", "request"],
      ["service", "database", "Execute the source query", "request"],
      ["database", "service", "Return source rows", "response"],
      ["service", "adapter", "Return the OData response", "response"],
      ["adapter", "salesforce", "Return normalized external records", "response"],
      ["salesforce", "user", "Render the virtualized records", "response"],
    ],
  },
  {
    slug: "integration-mulesoft-orchestration",
    category: "integration",
    title: "MuleSoft multi-system orchestration",
    sourceLabel: "Salesforce integration patterns",
    sourceUrl: INTEGRATION_PATTERNS,
    participants: [
      ["client", "Digital Channel", "external"],
      ["mule", "MuleSoft Process API", "integration"],
      ["salesforce", "Salesforce CRM", "salesforce"],
      ["erp", "Enterprise Resource Planning", "external"],
      ["payment", "Payment Service", "external"],
      ["audit", "Audit Event Store", "data_store"],
    ],
    interactions: [
      ["client", "mule", "Submit the order request", "request"],
      ["mule", "salesforce", "Validate the customer and opportunity", "request"],
      ["salesforce", "mule", "Return CRM context", "response"],
      ["mule", "erp", "Reserve inventory", "request"],
      ["erp", "mule", "Return the reservation result", "response"],
      ["mule", "payment", "Authorize the payment", "request"],
      ["payment", "mule", "Return payment authorization", "response"],
      ["mule", "salesforce", "Create the confirmed order", "request"],
      ["salesforce", "mule", "Return the order reference", "response"],
      ["mule", "audit", "Append the orchestration audit event", "async"],
      ["mule", "client", "Return the confirmed order", "response"],
    ],
  },
  {
    slug: "integration-bulk-api-ingest",
    category: "integration",
    title: "Bulk API ingestion with failed-row replay",
    sourceLabel: "Salesforce batch request guidance",
    sourceUrl: BATCH,
    participants: [
      ["source", "Source System", "external"],
      ["extract", "Extraction Job", "integration"],
      ["staging", "Staging Data Store", "data_store"],
      ["bulk", "Salesforce Bulk API", "salesforce"],
      ["salesforce", "Salesforce Data Store", "salesforce"],
      ["errors", "Failed Row Store", "data_store"],
      ["ops", "Data Operations", "user"],
    ],
    interactions: [
      ["source", "extract", "Provide the changed source records", "async"],
      ["extract", "staging", "Write normalized staging rows", "request"],
      ["staging", "extract", "Confirm the staged batch", "response"],
      ["extract", "bulk", "Create the ingestion job", "request"],
      ["bulk", "extract", "Return the job identifier", "response"],
      ["extract", "bulk", "Upload the staged records", "request"],
      ["bulk", "salesforce", "Process records in the org", "async"],
      ["salesforce", "bulk", "Return row-level outcomes", "response"],
      ["bulk", "extract", "Publish job completion", "event"],
      ["extract", "errors", "Persist failed rows", "async"],
      ["errors", "ops", "Notify data operations", "event"],
      ["ops", "extract", "Approve failed-row replay", "request"],
    ],
  },
  {
    slug: "integration-eight-lane-stress",
    category: "integration",
    title: "Eight-lane order integration stress flow",
    sourceLabel: "Salesforce integration patterns",
    sourceUrl: INTEGRATION_PATTERNS,
    participants: [
      ["user", "Channel User", "user"],
      ["channel", "Digital Commerce Channel", "external"],
      ["gateway", "API Gateway", "integration"],
      ["mule", "Integration Orchestrator", "integration"],
      ["salesforce", "Salesforce Order Service", "salesforce"],
      ["erp", "Inventory System", "external"],
      ["payment", "Payment Provider", "external"],
      ["audit", "Audit and Replay Store", "data_store"],
    ],
    interactions: [
      ["user", "channel", "Submit the order", "request"],
      ["channel", "gateway", "Send the validated channel request", "request"],
      ["gateway", "mule", "Forward the authenticated operation", "request"],
      ["mule", "salesforce", "Create the pending order", "request"],
      ["salesforce", "mule", "Return the pending order reference", "response"],
      ["mule", "erp", "Reserve the requested inventory", "request"],
      ["erp", "mule", "Return the reservation result", "response"],
      ["mule", "payment", "Authorize the payment", "request"],
      ["payment", "mule", "Return payment authorization", "response"],
      ["mule", "salesforce", "Confirm the completed order", "request"],
      ["salesforce", "mule", "Return the confirmed order", "response"],
      ["mule", "audit", "Persist the orchestration trace", "async"],
      ["mule", "gateway", "Return the order result", "response"],
      ["gateway", "channel", "Return the channel response", "response"],
      ["channel", "user", "Display the order confirmation", "response"],
    ],
  },
];

export const SEQUENCE_MATRIX: SequenceMatrixCase[] = FLOW_DEFS.map((flow) => {
  const sourceId = `${flow.category}-source`;
  const evidence = [sourceId];
  const participants: SequenceParticipant[] = flow.participants.map(([id, label, kind]) => ({
    id,
    label,
    kind,
    evidence,
  }));
  const interactions: SequenceInteraction[] = flow.interactions.map(
    ([from, to, label, kind], index) => ({
      id: `step-${index + 1}`,
      step: index + 1,
      from,
      to,
      label,
      kind,
      evidence,
    }),
  );
  const activations: SequenceActivation[] | undefined = flow.activations?.map(
    ([id, participant, start_step, end_step]) => ({
      id,
      participant,
      start_step,
      end_step,
      evidence,
    }),
  );
  return {
    slug: flow.slug,
    category: flow.category,
    spec: {
      spec_version: "2.0",
      family: "sequence",
      title: flow.title,
      scope: `Reference-grounded ${flow.category.toUpperCase()} interactions used to verify the deterministic sequence profile.`,
      grounding: {
        mode: "reference",
        as_of: "2026-07-25",
        sources: [
          {
            id: sourceId,
            label: flow.sourceLabel,
            url: flow.sourceUrl,
            kind: "official_doc",
          },
        ],
      },
      participants,
      interactions,
      ...(activations ? { activations } : {}),
    },
  };
});
