/**
 * Centralized AWS configuration for the DB clients. Reads from environment
 * variables (loaded by the engine via dotenv, and provided by Vercel for the
 * web app). Nothing here is exposed to the browser.
 */

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `Missing required env var ${name}. Copy .env.example and fill it in ` +
        `(see infra/README.md for how to obtain the Aurora ARNs).`,
    );
  }
  return v;
}

export const awsConfig = {
  region: process.env.AWS_REGION ?? "us-east-1",
};

export const dynamoConfig = {
  get tableName(): string {
    return process.env.DYNAMODB_TABLE ?? "EntangledPairs";
  },
};

export const auroraConfig = {
  get clusterArn(): string {
    return required("AURORA_CLUSTER_ARN");
  },
  get secretArn(): string {
    return required("AURORA_SECRET_ARN");
  },
  get database(): string {
    return required("AURORA_DATABASE");
  },
};
