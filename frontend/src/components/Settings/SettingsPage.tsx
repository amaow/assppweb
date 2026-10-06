import { useState, useEffect, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import PageContainer from "../Layout/PageContainer";
import Modal from "../common/Modal";
import { useToastStore } from "../../store/toast";
import { apiGet } from "../../api/client";
import { countryCodeMap } from "../../utils/countries";

interface ServerInfo {
  uptime?: number;
  buildCommit?: string;
  buildDate?: string;
  port?: number;
  dataDir?: string;
  publicBaseUrl?: string;
  disableHttpsRedirect?: boolean;
  autoCleanupDays?: number;
  autoCleanupMaxMB?: number;
  maxDownloadMB?: number;
  downloadThreads?: number;
}

const entityTypes = [
  { value: "software", label: "iPhone" },
  { value: "iPadSoftware", label: "iPad" },
];

export default function SettingsPage() {
  const { t, i18n } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);

  const [country, setCountry] = useState(
    () => localStorage.getItem("asspp-default-country") || "US",
  );
  const [entity, setEntity] = useState(
    () => localStorage.getItem("asspp-default-entity") || "software",
  );
  const [serverInfo, setServerInfo] = useState<ServerInfo | null>(null);


  useEffect(() => {
    localStorage.setItem("asspp-default-country", country);
  }, [country]);

  useEffect(() => {
    localStorage.setItem("asspp-default-entity", entity);
  }, [entity]);

  useEffect(() => {
    apiGet<ServerInfo>("/api/settings")
      .then(setServerInfo)
      .catch(() => setServerInfo(null));
  }, []);

  const sortedCountries = Object.keys(countryCodeMap).sort((a, b) =>
    t(`countries.${a}`, a).localeCompare(t(`countries.${b}`, b)),
  );

  return (
    <PageContainer title={t("settings.title")}>
      <div className="min-w-0 space-y-6">
        <section className="min-w-0 rounded-lg border border-gray-200 bg-white p-4 sm:p-6 dark:border-gray-800 dark:bg-gray-900">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            {t("settings.language.title")}
          </h2>
          <div className="space-y-4">
            <div>
              <label
                htmlFor="language"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
              >
                {t("settings.language.label")}
              </label>
              <select
                id="language"
                value={i18n.resolvedLanguage || "en-US"}
                onChange={async (e) => {
                  const newLang = e.target.value;
                  await i18n.changeLanguage(newLang);
                  addToast(t("settings.language.changed"), "success");
                }}
                className="block min-w-0 max-w-full w-full truncate rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-base text-gray-900 dark:text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
              >
                <option value="en-US">English (US)</option>
                <option value="zh-CN">简体中文</option>
                <option value="zh-TW">繁體中文</option>
                <option value="ja">日本語</option>
                <option value="ko">한국어</option>
                <option value="ru">Русский</option>
              </select>
            </div>
          </div>
        </section>

        <section className="min-w-0 rounded-lg border border-gray-200 bg-white p-4 sm:p-6 dark:border-gray-800 dark:bg-gray-900">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            {t("settings.defaults.title")}
          </h2>
          <div className="space-y-4">
            <div>
              <label
                htmlFor="country"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
              >
                {t("settings.defaults.country")}
              </label>
              <select
                id="country"
                value={country}
                onChange={(e) => {
                  setCountry(e.target.value);
                  addToast(t("settings.defaults.countryChanged"), "success");
                }}
                className="block min-w-0 max-w-full w-full truncate rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-base text-gray-900 dark:text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
              >
                {sortedCountries.map((code) => (
                  <option key={code} value={code}>
                    {t(`countries.${code}`, code)} ({code})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                htmlFor="entity"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
              >
                {t("settings.defaults.entity")}
              </label>
              <select
                id="entity"
                value={entity}
                onChange={(e) => {
                  setEntity(e.target.value);
                  addToast(t("settings.defaults.entityChanged"), "success");
                }}
                className="block min-w-0 max-w-full w-full truncate rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-base text-gray-900 dark:text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
              >
                {entityTypes.map((et) => (
                  <option key={et.value} value={et.value}>
                    {et.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>

        <section className="min-w-0 rounded-lg border border-gray-200 bg-white p-4 sm:p-6 dark:border-gray-800 dark:bg-gray-900">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            {t("settings.server.title")}
          </h2>
          {serverInfo ? (
            <div className="min-w-0 space-y-6">
              <dl className="min-w-0 divide-y divide-gray-100 dark:divide-gray-800">
                {serverInfo.uptime != null && (
                  <SettingsInfoRow label={t("settings.server.uptime")}>
                    {formatUptime(serverInfo.uptime)}
                  </SettingsInfoRow>
                )}
              </dl>

              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
                  {t("settings.server.configuration")}
                </h3>
                <dl className="min-w-0 divide-y divide-gray-100 border-y border-gray-100 dark:divide-gray-800 dark:border-gray-800">
                  <SettingsInfoRow label="PORT" mono>
                    {serverInfo.port}
                  </SettingsInfoRow>
                  <SettingsInfoRow
                    label="DATA_DIR"
                    mono
                    valueTitle={serverInfo.dataDir}
                  >
                    {serverInfo.dataDir}
                  </SettingsInfoRow>
                  <SettingsInfoRow
                    label="PUBLIC_BASE_URL"
                    mono
                    valueTitle={serverInfo.publicBaseUrl || undefined}
                  >
                    {serverInfo.publicBaseUrl || (
                      <span className="italic text-gray-400 dark:text-gray-500">
                        {t("settings.server.notSet")}
                      </span>
                    )}
                  </SettingsInfoRow>
                  <SettingsInfoRow
                    label="UNSAFE_DANGEROUSLY_DISABLE_HTTPS_REDIRECT"
                    mono
                  >
                    {serverInfo.disableHttpsRedirect
                      ? t("settings.server.enabled")
                      : t("settings.server.disabled")}
                  </SettingsInfoRow>
                  <SettingsInfoRow label="AUTO_CLEANUP_DAYS" mono>
                    {serverInfo.autoCleanupDays ||
                      t("settings.server.disabled")}
                  </SettingsInfoRow>
                  <SettingsInfoRow label="AUTO_CLEANUP_MAX_MB" mono>
                    {serverInfo.autoCleanupMaxMB ||
                      t("settings.server.disabled")}
                  </SettingsInfoRow>
                  <SettingsInfoRow label="MAX_DOWNLOAD_MB" mono>
                    {serverInfo.maxDownloadMB ||
                      t("settings.server.disabled")}
                  </SettingsInfoRow>
                  <SettingsInfoRow label="DOWNLOAD_THREADS" mono>
                    {serverInfo.downloadThreads ?? 8}
                  </SettingsInfoRow>
                </dl>
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {t("settings.server.offline")}
            </p>
          )}
        </section>

        <section className="min-w-0 rounded-lg border border-gray-200 bg-white p-4 sm:p-6 dark:border-gray-800 dark:bg-gray-900">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            {t("settings.data.title")}
          </h2>
          <p className="mb-4 max-w-full whitespace-nowrap text-[clamp(0.5625rem,2.8vw,0.875rem)] leading-relaxed tracking-[-0.015em] text-gray-600 dark:text-gray-400">
            {t("settings.data.description")}
          </p>

          <button
            onClick={() => {
              if (!confirm(t("settings.data.confirm"))) return;
              localStorage.clear();
              indexedDB.deleteDatabase("asspp-accounts");
              addToast(t("settings.data.cleared"), "success");
              setTimeout(() => {
                window.location.href = "/";
              }, 1000);
            }}
            className="min-h-11 w-full min-w-0 whitespace-normal break-words rounded-lg border border-red-300 px-4 py-2 text-center text-sm font-medium text-red-600 transition-colors hover:bg-red-50 sm:w-auto dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/30"
          >
            {t("settings.data.button")}
          </button>
        </section>

        <section className="min-w-0 rounded-lg border border-gray-200 bg-white p-4 sm:p-6 dark:border-gray-800 dark:bg-gray-900">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            {t("settings.about.title")}
          </h2>
          <p className="max-w-full whitespace-nowrap text-[clamp(0.5625rem,2.8vw,0.875rem)] leading-relaxed tracking-[-0.015em] text-gray-600 dark:text-gray-400">
            {t("settings.about.description")}
          </p>
          {serverInfo && (
            <dl className="mt-3 min-w-0 divide-y divide-gray-100 dark:divide-gray-800">
              {serverInfo.buildCommit &&
                serverInfo.buildCommit !== "unknown" && (
                  <SettingsInfoRow
                    label={t("settings.about.buildCommit")}
                    mono
                    compact
                    valueTitle={serverInfo.buildCommit}
                  >
                    {serverInfo.buildCommit}
                  </SettingsInfoRow>
                )}
              {serverInfo.buildDate && serverInfo.buildDate !== "unknown" && (
                <SettingsInfoRow
                  label={t("settings.about.buildDate")}
                  compact
                  valueTitle={serverInfo.buildDate}
                >
                    {new Date(serverInfo.buildDate).toLocaleString()}
                </SettingsInfoRow>
              )}
            </dl>
          )}
        </section>
      </div>

    </PageContainer>
  );
}

function SettingsInfoRow({
  label,
  children,
  mono = false,
  compact = false,
  valueTitle,
}: {
  label: string;
  children: ReactNode;
  mono?: boolean;
  compact?: boolean;
  valueTitle?: string;
}) {
  const labelSize = compact ? "text-xs" : "text-sm";
  const valueSize = compact ? "text-xs" : "text-sm";

  return (
    <div className="grid min-w-0 grid-cols-1 gap-1 py-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] sm:items-start sm:gap-6">
      <dt
        className={`${labelSize} min-w-0 break-all font-medium text-gray-500 dark:text-gray-400`}
      >
        {label}
      </dt>
      <dd
        title={valueTitle}
        className={`${valueSize} min-w-0 max-w-full whitespace-pre-wrap break-all text-gray-900 sm:text-right dark:text-gray-200 ${
          mono ? "font-mono" : ""
        }`}
      >
        {children}
      </dd>
    </div>
  );
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(" ");
}
