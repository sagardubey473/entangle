/**
 * @entangle/db — AWS data-access layer shared by the engine and the web app.
 *
 *  - dynamo.*  : live perishable pair inventory (incl. atomic allocate/release)
 *  - aurora.*  : Aurora PostgreSQL over the RDS Data API
 *
 * Higher-level repository helpers (requests, events, live_links, metrics,
 * routing) are added in later phases on top of these primitives.
 */

export * as dynamo from "./dynamo.js";
export * as aurora from "./aurora.js";
export * as repo from "./repo.js";
export { PairUnavailableError } from "./dynamo.js";
export { dynamoConfig, auroraConfig, awsConfig } from "./env.js";
