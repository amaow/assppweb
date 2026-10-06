import { create } from "zustand";
import { apiGet, apiDelete } from "../api/client";
import type { Account } from "../types";

interface AccountsState {
  accounts: Account[];
  loading: boolean;
  loadAccounts: () => Promise<void>;
  addAccount: (account: Account) => void;
  removeAccount: (accountHash: string) => Promise<void>;
}

export const useAccountsStore = create<AccountsState>((set, get) => ({
  accounts: [],
  loading: true,

  loadAccounts: async () => {
    set({ loading: true });
    try {
      const accounts = await apiGet<Account[]>("/api/apple-accounts");
      set({ accounts, loading: false });
    } catch {
      set({ accounts: [], loading: false });
    }
  },

  addAccount: (account: Account) => {
    set({
      accounts: [
        ...get().accounts.filter((a) => a.accountHash !== account.accountHash),
        account,
      ],
    });
  },

  removeAccount: async (accountHash: string) => {
    await apiDelete(
      `/api/apple-accounts/${encodeURIComponent(accountHash)}`,
    );
    set({
      accounts: get().accounts.filter((a) => a.accountHash !== accountHash),
    });
  },
}));

// Auto-load accounts on import
useAccountsStore.getState().loadAccounts();
