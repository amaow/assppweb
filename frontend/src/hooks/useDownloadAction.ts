import { useTranslation } from "react-i18next";
import { useToastStore } from "../store/toast";
import { useDownloadsStore } from "../store/downloads";
import { apiGet, apiPost } from "../api/client";
import { getErrorMessage } from "../utils/error";
import { getAccountContext } from "../utils/toast";
import type { Account, Software } from "../types";

/**
 * Shared hook for download actions.
 * The server runs ipatool for the whole Apple flow; the client only
 * passes the app id (+ optional external version id for old versions).
 */
export function useDownloadAction() {
  const addToast = useToastStore((s) => s.addToast);
  const fetchTasks = useDownloadsStore((s) => s.fetchTasks);
  const { t } = useTranslation();

  async function startDownload(
    account: Account,
    app: Software,
    externalVersionId?: string,
  ) {
    const ctx = getAccountContext(account, t);
    const appName = app.name;

    try {
      const settings = await apiGet<{ maxDownloadMB: number }>("/api/settings");
      if (settings.maxDownloadMB > 0 && app.fileSizeBytes) {
        const sizeMB = parseInt(app.fileSizeBytes, 10) / (1024 * 1024);
        if (sizeMB > settings.maxDownloadMB) {
          addToast(
            t("toast.downloadLimit.message", {
              appName,
              size: sizeMB.toFixed(2),
              limit: settings.maxDownloadMB,
            }),
            "error",
            t("toast.title.downloadLimit"),
          );
          return;
        }
      }
    } catch {
      // Settings fetch failed — backend will still enforce the limit
    }

    try {
      await apiPost("/api/downloads", {
        software: app,
        accountHash: account.accountHash,
        appId: app.id,
        externalVersionId,
        purchase: true,
      });

      fetchTasks();

      addToast(
        t("toast.msg", { appName, ...ctx }),
        "info",
        t("toast.title.downloadStarted"),
      );
    } catch (err) {
      toastDownloadError(account, app, err);
    }
  }

  function toastDownloadError(account: Account, app: Software, error: unknown) {
    const ctx = getAccountContext(account, t);
    addToast(
      t("toast.msgFailed", {
        appName: app.name,
        ...ctx,
        error: getErrorMessage(error, t("toast.title.downloadFailed")),
      }),
      "error",
      t("toast.title.downloadFailed"),
    );
  }

  return {
    startDownload,
    toastDownloadError,
  };
}
