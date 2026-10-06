import { describe, it, expect, beforeEach, vi } from "vitest";
import { useAccountsStore } from "../../src/store/accounts";
import type { Account } from "../../src/types";

const mockAccount: Account = {
  email: "test@example.com",
  accountHash: "abc123hash",
  name: "Test User",
  storeFront: "143441",
};

function mockFetchOnce(body: unknown, ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok,
      json: async () => body,
      text: async () => JSON.stringify(body),
    }),
  );
}

describe("store/accounts", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    useAccountsStore.setState({ accounts: [], loading: false });
  });

  it("should load accounts from the backend API", async () => {
    mockFetchOnce([mockAccount]);
    await useAccountsStore.getState().loadAccounts();
    const accounts = useAccountsStore.getState().accounts;
    expect(accounts).toHaveLength(1);
    expect(accounts[0].email).toBe("test@example.com");
    expect(accounts[0]).not.toHaveProperty("password");
  });

  it("should add an account to the store", async () => {
    mockFetchOnce([mockAccount]);
    await useAccountsStore.getState().loadAccounts();
    useAccountsStore.getState().addAccount({
      ...mockAccount,
      email: "second@example.com",
      accountHash: "def456hash",
    });
    expect(useAccountsStore.getState().accounts).toHaveLength(2);
  });

  it("should not duplicate an account with the same hash", async () => {
    mockFetchOnce([mockAccount]);
    await useAccountsStore.getState().loadAccounts();
    useAccountsStore.getState().addAccount({ ...mockAccount });
    expect(useAccountsStore.getState().accounts).toHaveLength(1);
  });

  it("should remove an account via the API", async () => {
    mockFetchOnce([mockAccount]);
    await useAccountsStore.getState().loadAccounts();
    mockFetchOnce({}, true);
    await useAccountsStore.getState().removeAccount("abc123hash");
    expect(useAccountsStore.getState().accounts).toHaveLength(0);
  });

  it("should handle load failure gracefully", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down")),
    );
    await useAccountsStore.getState().loadAccounts();
    expect(useAccountsStore.getState().accounts).toHaveLength(0);
    expect(useAccountsStore.getState().loading).toBe(false);
  });
});
