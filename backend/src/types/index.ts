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

export interface Sinf {
  id: number;
  sinf: string; // base64 encoded
}

export interface DownloadTask {
  id: string;
  software: Software;
  accountHash: string;
  /** iTunes app id used for the ipatool download. */
  appId: number;
  /** Apple external version id (undefined = latest). */
  externalVersionId?: string;
  status: 'pending' | 'downloading' | 'completed' | 'failed';
  progress: number;
  speed: string;
  /** Expected total bytes (from iTunes metadata), if known. */
  totalBytes?: number;
  error?: string;
  filePath?: string;
  createdAt: string;
}

export interface PackageInfo {
  id: string;
  software: Software;
  accountHash: string;
  filePath: string;
  fileSize: number;
  createdAt: string;
}
