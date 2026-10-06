import { apiGet, apiPost, apiDelete } from "./client";
import type { DownloadTask, Software } from "../types";

export async function fetchDownloads(
  accountHashes: string[],
): Promise<DownloadTask[]> {
  if (accountHashes.length === 0) return [];
  const params = new URLSearchParams({
    accountHashes: accountHashes.join(","),
  });
  return apiGet<DownloadTask[]>(`/api/downloads?${params}`);
}

export async function startDownload(data: {
  software: Software;
  accountHash: string;
  appId: number;
  externalVersionId?: string;
  purchase?: boolean;
}): Promise<DownloadTask> {
  return apiPost<DownloadTask>("/api/downloads", data);
}

export async function deleteDownload(
  id: string,
  accountHash: string,
): Promise<void> {
  const params = new URLSearchParams({ accountHash });
  await apiDelete(`/api/downloads/${id}?${params}`);
}
