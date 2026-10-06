import type { TFunction } from "i18next";
import { storeIdToCountry } from "./countries";
import type { Account } from "../types";

export interface AccountContext {
  userName: string;
  appleId: string;
  country: string;
}

/**
 * Extract display-friendly account context for toast notifications.
 * Centralises the repeated pattern of building userName / appleId / country.
 */
export function getAccountContext(
  account: Account | undefined,
  t: TFunction,
): AccountContext {
  if (!account) {
    return { userName: "Unknown", appleId: "Unknown", country: "Unknown" };
  }
  const userName = account.name || account.email;
  const appleId = account.email;
  const rawCountryCode = storeIdToCountry(account.storeFront) || "";
  const country = rawCountryCode
    ? t(`countries.${rawCountryCode}`, rawCountryCode)
    : account.storeFront;
  return { userName, appleId, country };
}
