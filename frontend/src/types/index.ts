export interface Software {
  id: number;
  bundleID: string;
  name: string;
  version: string;
  price?: number;
  artistName: string;
  sellerName: string;
  description: string;
  averageUserRating: number;
  userRatingCount: number;
  artworkUrl: string;
  screenshotUrls: string[];
  minimumOsVersion: string;
  fileSizeBytes?: string;
  releaseDate: string;
  releaseNotes?: string;
  formattedPrice?: string;
  primaryGenreName: string;
}

export interface Account {
  email: string;
  accountHash: string;
  name?: string;
  storeFront: string;
}

export interface AppVersion {
  externalVersionId: string;
  version: string;
  releaseDate: string;
}

export interface DownloadTask {
  id: string;
  software: Software;
  accountHash: string;
  status: "pending" | "downloading" | "completed" | "failed";
  progress: number;
  speed: string;
  error?: string;
  hasFile?: boolean;
  createdAt: string;
}

export interface PackageInfo {
  id: string;
  software: Software;
  accountHash: string;
  fileSize: number;
  createdAt: string;
}
