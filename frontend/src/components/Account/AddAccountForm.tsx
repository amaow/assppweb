import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import PageContainer from "../Layout/PageContainer";
import Spinner from "../common/Spinner";
import { useAccounts } from "../../hooks/useAccounts";
import { useToastStore } from "../../store/toast";
import { apiPostRaw } from "../../api/client";
import { getErrorMessage } from "../../utils/error";
import type { Account } from "../../types";

interface LoginResponse {
  account?: Account;
  need2FA?: boolean;
  accountHash?: string;
  email?: string;
  message?: string;
  error?: string;
}

export default function AddAccountForm() {
  const navigate = useNavigate();
  const { addAccount } = useAccounts();
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [needsCode, setNeedsCode] = useState(false);
  const [pendingHash, setPendingHash] = useState("");
  const [loading, setLoading] = useState(false);
  const inputClassName =
    "block min-h-11 w-full min-w-0 max-w-full rounded-xl border-0 bg-gray-100 px-3 py-2 text-base text-gray-900 focus:ring-2 focus:ring-blue-500/40 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-gray-800 dark:text-white";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    try {
      if (needsCode) {
        const { status, body } = await apiPostRaw<LoginResponse>(
          "/api/apple-accounts/verify-2fa",
          { accountHash: pendingHash, code },
        );
        if (status === 200 && body.account) {
          await addAccount(body.account);
          addToast(t("accounts.addForm.addSuccess"), "success");
          navigate("/accounts");
        } else {
          addToast(
            body.error || t("accounts.addForm.authFailed"),
            "error",
          );
        }
        return;
      }

      const { status, body } = await apiPostRaw<LoginResponse>(
        "/api/apple-accounts/login",
        { email, password },
      );
      if (status === 200 && body.account) {
        await addAccount(body.account);
        addToast(t("accounts.addForm.addSuccess"), "success");
        navigate("/accounts");
      } else if (status === 428 && body.need2FA && body.accountHash) {
        setNeedsCode(true);
        setPendingHash(body.accountHash);
        addToast(
          body.message || t("accounts.addForm.codeHelp"),
          "info",
        );
      } else {
        addToast(body.error || t("accounts.addForm.authFailed"), "error");
      }
    } catch (err) {
      addToast(getErrorMessage(err, t("accounts.addForm.authFailed")), "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <PageContainer title={t("accounts.addForm.title")}>
      <div className="max-w-2xl">
        <form onSubmit={handleSubmit} className="space-y-6">
          <section className="space-y-5 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5 dark:bg-gray-900 dark:ring-white/10 sm:p-6">
            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
              >
                {t("accounts.addForm.email")}
              </label>
              <input
                id="email"
                type="text"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading || needsCode}
                placeholder={t("accounts.addForm.emailPlaceholder")}
                className={inputClassName}
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
              >
                {t("accounts.addForm.password")}
              </label>
              <input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading || needsCode}
                className={inputClassName}
              />
            </div>

            {needsCode && (
              <div>
                <label
                  htmlFor="code"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                >
                  {t("accounts.addForm.code")}
                </label>
                <input
                  id="code"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  disabled={loading}
                  placeholder={t("accounts.addForm.codePlaceholder")}
                  className={inputClassName}
                  autoFocus
                />
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {t("accounts.addForm.codeHelp")}
                </p>
              </div>
            )}
          </section>

          <div className="grid grid-cols-1 gap-3 sm:flex sm:flex-wrap sm:items-center">
            <button
              type="submit"
              disabled={loading}
              className="flex min-h-11 items-center justify-center gap-2 rounded-full bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading && <Spinner />}
              {needsCode
                ? t("accounts.addForm.verify")
                : t("accounts.addForm.signIn")}
            </button>
            <button
              type="button"
              onClick={() => navigate("/accounts")}
              disabled={loading}
              className="min-h-11 rounded-full bg-gray-200 px-6 py-2.5 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-300 disabled:opacity-50 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              {t("accounts.addForm.cancel")}
            </button>
          </div>
        </form>
      </div>
    </PageContainer>
  );
}
