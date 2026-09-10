import type { Adapter, AdapterAccount } from "next-auth/adapters";
import { decryptToken, encryptToken } from "@/lib/security/token-crypto";

function encryptNullable(value: string | null | undefined) {
  return value ? encryptToken(value) : value;
}

function decryptNullable(value: string | null | undefined) {
  return value ? decryptToken(value) : value;
}

function encryptAccount<T extends AdapterAccount>(account: T): T {
  return {
    ...account,
    access_token: encryptNullable(account.access_token),
    refresh_token: encryptNullable(account.refresh_token),
    id_token: encryptNullable(account.id_token),
  };
}

function decryptAccount<T extends AdapterAccount>(account: T): T {
  return {
    ...account,
    access_token: decryptNullable(account.access_token),
    refresh_token: decryptNullable(account.refresh_token),
    id_token: decryptNullable(account.id_token),
  };
}

export function withEncryptedProviderTokens(base: Adapter): Adapter {
  return {
    ...base,
    linkAccount(account) {
      if (!base.linkAccount) throw new Error("Auth adapter does not support linkAccount");
      return base.linkAccount(encryptAccount(account));
    },
    async getAccount(providerAccountId, provider) {
      if (!base.getAccount) return null;
      const account = await base.getAccount(providerAccountId, provider);
      return account ? decryptAccount(account) : null;
    },
  };
}
