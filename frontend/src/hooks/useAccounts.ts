import { useAccountsStore } from "../store/accounts";

export function useAccounts() {
  const { accounts, loading, loadAccounts, addAccount, removeAccount } =
    useAccountsStore();

  function getAccount(accountHash: string) {
    return accounts.find((a) => a.accountHash === accountHash);
  }

  return {
    accounts,
    loading,
    loadAccounts,
    addAccount,
    removeAccount,
    getAccount,
  };
}
