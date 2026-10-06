import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import PageContainer from "../Layout/PageContainer";
import { useAccounts } from "../../hooks/useAccounts";
import { useToastStore } from "../../store/toast";
import { storeIdToCountry } from "../../utils/countries";

export default function AccountDetail() {
  const { email } = useParams<{ email: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const {
    accounts,
    loading: storeLoading,
    loadAccounts,
    removeAccount,
  } = useAccounts();
  const addToast = useToastStore((s) => s.addToast);

  const [showDelete, setShowDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  const decodedEmail = email ? decodeURIComponent(email) : "";
  const account = accounts.find((a) => a.email === decodedEmail);

  if (storeLoading) {
    return (
      <PageContainer title={t("accounts.title")}>
        <div className="text-center text-gray-500 py-12">{t("loading")}</div>
      </PageContainer>
    );
  }

  if (!account) {
    return (
      <PageContainer title={t("accounts.title")}>
        <div className="text-center py-12">
          <p className="text-gray-500 mb-4">{t("accounts.detail.notFound")}</p>
          <button
            onClick={() => navigate("/accounts")}
            className="text-blue-600 hover:text-blue-700 font-medium"
          >
            {t("accounts.detail.back")}
          </button>
        </div>
      </PageContainer>
    );
  }

  async function handleDelete() {
    if (!account) return;
    setDeleting(true);
    try {
      await removeAccount(account.accountHash);
      addToast(t("accounts.detail.deleteSuccess"), "success");
      navigate("/accounts");
    } catch {
      addToast(t("accounts.detail.deleteFailed", "删除失败"), "error");
    } finally {
      setDeleting(false);
    }
  }

  const countryCode = storeIdToCountry(account.storeFront);
  const displayRegion = countryCode
    ? `${t(`countries.${countryCode}`, countryCode)} (${account.storeFront})`
    : account.storeFront || "--";

  return (
    <PageContainer title={t("accounts.detail.title")}>
      <div className="max-w-2xl space-y-6">
        <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5 dark:bg-gray-900 dark:ring-white/10 sm:p-6">
          <dl className="divide-y divide-gray-100 dark:divide-gray-800">
            <DetailRow
              label={t("accounts.detail.name")}
              value={account.name || "--"}
            />
            <DetailRow
              label={t("accounts.detail.email")}
              value={account.email}
            />
            <DetailRow
              label={t("accounts.detail.storeRegion")}
              value={displayRegion}
            />
          </dl>
        </section>

        <p className="text-xs text-gray-500 dark:text-gray-400">
          {t(
            "accounts.detail.sessionHint",
            "登录会话由服务端自动维护，过期会自动续期；如更改了 Apple ID 密码，请删除后重新添加。",
          )}
        </p>

        <div className="flex flex-wrap items-center gap-3">
          {!showDelete ? (
            <button
              onClick={() => setShowDelete(true)}
              className="min-h-11 rounded-full bg-red-50 px-5 py-2 text-sm font-semibold text-red-600 transition-colors hover:bg-red-100 dark:bg-red-950/40 dark:text-red-400 dark:hover:bg-red-950/70"
            >
              {t("accounts.detail.delete")}
            </button>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-gray-600 dark:text-gray-400">
                {t("accounts.detail.areYouSure")}
              </span>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="min-h-11 rounded-full bg-red-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-50"
              >
                {t("accounts.detail.confirmDelete")}
              </button>
              <button
                onClick={() => setShowDelete(false)}
                className="min-h-11 rounded-full bg-gray-200 px-5 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-300 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                {t("accounts.detail.cancel")}
              </button>
            </div>
          )}
        </div>

        <button
          onClick={() => navigate("/accounts")}
          className="mt-2 inline-block min-h-11 rounded-full bg-gray-200 px-5 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-300 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          {t("accounts.detail.back")}
        </button>
      </div>
    </PageContainer>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="py-3 first:pt-0 last:pb-0">
      <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-gray-900 dark:text-white break-all">
        {value || "--"}
      </dd>
    </div>
  );
}
