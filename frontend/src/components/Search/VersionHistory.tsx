import { useState, useEffect, useMemo } from "react";
import { useParams, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import PageContainer from "../Layout/PageContainer";
import AppIcon from "../common/AppIcon";
import { useAccounts } from "../../hooks/useAccounts";
import { useDownloadAction } from "../../hooks/useDownloadAction";
import { storeIdToCountry } from "../../utils/countries";
import { apiGet } from "../../api/client";
import { getErrorMessage } from "../../utils/error";
import { useToastStore } from "../../store/toast";
import type { Software, AppVersion } from "../../types";

export default function VersionHistory() {
  const { appId } = useParams<{ appId: string }>();
  const location = useLocation();
  const { accounts } = useAccounts();
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const { startDownload, toastDownloadError } = useDownloadAction();

  const stateApp = (location.state as { app?: Software; country?: string })
    ?.app;
  const stateCountry = (location.state as { country?: string })?.country;
  const country = stateCountry ?? "US";

  const [app] = useState<Software | null>(stateApp ?? null);
  const [selectedAccount, setSelectedAccount] = useState("");

  const filteredAccounts = useMemo(
    () =>
      accounts.filter(
        (a) => !a.storeFront || storeIdToCountry(a.storeFront) === country,
      ),
    [accounts, country],
  );
  const [versions, setVersions] = useState<AppVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [downloadingVersion, setDownloadingVersion] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (
      filteredAccounts.length > 0 &&
      !filteredAccounts.some((a) => a.accountHash === selectedAccount)
    ) {
      setSelectedAccount(filteredAccounts[0].accountHash);
    }
  }, [filteredAccounts, selectedAccount]);

  const account = filteredAccounts.find(
    (a) => a.accountHash === selectedAccount,
  );

  async function handleLoadVersions() {
    if (!account || !app) return;
    setLoading(true);
    try {
      const result = await apiGet<AppVersion[]>(
        `/api/versions?accountHash=${encodeURIComponent(account.accountHash)}&appId=${app.id}`,
      );
      setVersions(result);
    } catch (e) {
      addToast(getErrorMessage(e, t("search.versions.loadFailed")), "error");
    } finally {
      setLoading(false);
    }
  }

  async function handleDownloadVersion(externalVersionId: string) {
    if (!account || !app) return;
    setDownloadingVersion(externalVersionId);
    try {
      await startDownload(account, app, externalVersionId);
    } catch (e) {
      toastDownloadError(account, app, e);
    } finally {
      setDownloadingVersion(null);
    }
  }

  if (!app) {
    return (
      <PageContainer title={t("search.versions.title")}>
        <p className="text-gray-500 [overflow-wrap:anywhere]">
          {t("search.versions.unavailable")}
        </p>
      </PageContainer>
    );
  }

  return (
    <PageContainer title={t("search.versions.title")}>
      <div className="min-w-0 space-y-6">
        <div className="flex min-w-0 items-center gap-4">
          <div className="shrink-0">
            <AppIcon url={app.artworkUrl} name={app.name} size="md" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="font-medium text-gray-900 [overflow-wrap:anywhere] dark:text-white">
              {app.name}
            </h2>
            <p className="text-sm text-gray-500 [overflow-wrap:anywhere] dark:text-gray-400">
              {app.bundleID}
            </p>
          </div>
        </div>

        {accounts.length > 0 && filteredAccounts.length === 0 ? (
          <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-700 [overflow-wrap:anywhere] dark:border-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">
            {t("search.product.noAccountsForRegion")}
          </div>
        ) : (
          filteredAccounts.length > 0 && (
            <div className="flex min-w-0 flex-col items-stretch gap-3 sm:flex-row sm:items-end">
              <div className="min-w-0 flex-1">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t("search.versions.account")}
                </label>
                <select
                  value={selectedAccount}
                  onChange={(e) => setSelectedAccount(e.target.value)}
                  className="w-full min-w-0 rounded-md border border-gray-300 bg-white px-3 py-2 text-base text-gray-900 transition-colors focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                >
                  {filteredAccounts.map((a) => (
                    <option key={a.accountHash} value={a.accountHash}>
                      {a.name ? `${a.name} (${a.email})` : a.email}
                    </option>
                  ))}
                </select>
              </div>
              <button
                onClick={handleLoadVersions}
                disabled={loading || !account}
                className="w-full shrink-0 whitespace-normal rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50 sm:w-auto sm:whitespace-nowrap"
              >
                {loading
                  ? t("search.versions.loading")
                  : t("search.versions.load")}
              </button>
            </div>
          )
        )}

        {versions.length > 0 && (
          <div className="min-w-0 divide-y divide-gray-200 overflow-hidden rounded-lg border border-gray-200 bg-white dark:divide-gray-800 dark:border-gray-800 dark:bg-gray-900">
            {versions.map((v) => {
              const isDownloading = downloadingVersion === v.externalVersionId;

              return (
                <div
                  key={v.externalVersionId}
                  className="flex min-w-0 items-center justify-between gap-3 p-4"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 [overflow-wrap:anywhere] dark:text-white">
                      v{v.version}
                    </p>
                    {v.releaseDate && (
                      <p className="text-xs text-gray-500 [overflow-wrap:anywhere] dark:text-gray-400">
                        {new Date(v.releaseDate).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => handleDownloadVersion(v.externalVersionId)}
                    disabled={isDownloading || !account}
                    className="shrink-0 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                  >
                    {isDownloading
                      ? t("search.versions.downloading")
                      : t("search.versions.download")}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </PageContainer>
  );
}
