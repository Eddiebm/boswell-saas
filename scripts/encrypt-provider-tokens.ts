import { neon } from "@neondatabase/serverless";
import { encryptToken } from "../src/lib/security/token-crypto";

if (process.env.CONFIRM_TOKEN_MIGRATION !== "1") {
  throw new Error("Set CONFIRM_TOKEN_MIGRATION=1 after backing up the database");
}
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
if (!process.env.TOKEN_ENCRYPTION_KEY) throw new Error("TOKEN_ENCRYPTION_KEY is required");

const sql = neon(process.env.DATABASE_URL);
const rows = await sql`
  SELECT provider, provider_account_id, access_token, refresh_token, id_token
  FROM accounts
`;

let migrated = 0;
for (const row of rows) {
  const accessToken = typeof row.access_token === "string" && !row.access_token.startsWith("enc:v1:")
    ? encryptToken(row.access_token)
    : row.access_token;
  const refreshToken = typeof row.refresh_token === "string" && !row.refresh_token.startsWith("enc:v1:")
    ? encryptToken(row.refresh_token)
    : row.refresh_token;
  const idToken = typeof row.id_token === "string" && !row.id_token.startsWith("enc:v1:")
    ? encryptToken(row.id_token)
    : row.id_token;

  if (accessToken === row.access_token && refreshToken === row.refresh_token && idToken === row.id_token) continue;
  await sql`
    UPDATE accounts
    SET access_token = ${accessToken}, refresh_token = ${refreshToken}, id_token = ${idToken}
    WHERE provider = ${row.provider} AND provider_account_id = ${row.provider_account_id}
  `;
  migrated += 1;
}

console.log(`Encrypted provider tokens for ${migrated} account(s).`);
