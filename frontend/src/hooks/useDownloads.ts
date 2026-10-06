import { useEffect, useRef, useState } from "react";
import { useDownloadsStore } from "../store/downloads";
import { useAccounts } from "./useAccounts";

export function useDownloads() {
  const {
    tasks,
    loading,
    setAccountHashes,
    fetchTasks,
    startDownload,
    deleteDownload,
  } = useDownloadsStore();
  const { accounts } = useAccounts();
  const hashesRef = useRef("");
  const [hashToEmail, setHashToEmail] = useState<Record<string, string>>({});

  useEffect(() => {
    const hashes = accounts.map((a) => a.accountHash);
    const key = hashes.slice().sort().join(",");
    if (key === hashesRef.current) return;
    hashesRef.current = key;

    const map: Record<string, string> = {};
    for (const a of accounts) {
      map[a.accountHash] = a.email;
    }
    setHashToEmail(map);

    setAccountHashes(hashes);
    // Fetch immediately after hashes are set so downloads appear on first visit
    fetchTasks();
  }, [accounts, setAccountHashes, fetchTasks]);

  return {
    tasks,
    loading,
    hashToEmail,
    fetchTasks,
    startDownload,
    deleteDownload,
  };
}
