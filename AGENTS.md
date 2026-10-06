# Agent Instructions for AssppWeb

## TypeScript Code Style

- **Indentation**: 2 spaces
- **Semicolons**: Required
- **Quotes**: Single quotes for strings
- **Naming**: PascalCase for types/interfaces, camelCase for variables/functions

## Project Structure

- `backend/` — Node.js/Express server (TypeScript, ESM)
- `frontend/` — React SPA (TypeScript, Vite, Tailwind CSS)
- `e2e/` — Playwright E2E tests (pnpm)
- `references/ApplePackage/` — Swift reference implementation (source of truth)
- Multi-stage Docker build (single container serves both)

## Architecture — Server-Side Apple Protocol (ipatool)

The server runs `ipatool` as a subprocess for all Apple operations.
There is NO browser-side Apple protocol, NO Wisp proxy, NO SAP WASM.

```
┌─ Browser (Client) ─────────────────────────────────┐
│  React SPA: search UI, account UI, download queue,  │
│  version history, install pages.                    │
│  Talks to the backend via REST only.                │
└──────────────────────┬───────────────────────────────┘
                       │ HTTPS REST
┌─ Server ─────────────┴──────────────────────────────┐
│  Express + ipatool subprocess:                      │
│    1. POST /api/apple-accounts/login → ipatool auth  │
│       login (2FA via --auth-code, 428 to client)     │
│    2. GET /api/versions → list-versions +            │
│       get-version-metadata (cached 24h)              │
│    3. POST /api/downloads → ipatool download         │
│       --external-version-id --purchase               │
│       (SINF injection happens inside ipatool)        │
│                                                      │
│  Per-account isolation: XDG_STATE_HOME per           │
│  accountHash (sha256 of email). All ipatool calls    │
│  for one account are serialized via withAccountLock. │
│  Passwords: AES-256-GCM in accounts.json, key in     │
│  data/.master.key (0600). Auto re-login on           │
│  SESSION_EXPIRED via withSessionRetry.               │
│                                                      │
│  Download progress: poll <output>.ipa.tmp size.      │
│  No pause/resume in v1.                              │
└──────────────────────────────────────────────────────┘
```

**Key invariant**: Apple credentials are handled server-side only.
The password is passed to `ipatool auth login` transiently (never logged);
at rest it is AES-256-GCM encrypted. ipatool's own keychain holds the
session tokens per account.

## Reference: ipatool

Apple protocol is implemented by `majd/ipatool` v2 (Go binary, baked into
the Docker image). Relevant behaviors verified against source:

- `auth login` signals 2FA-required via an **info** log line
  ("2FA code is required...") with exit code 0 — not an error.
- `list-versions` returns only numeric externalVersionIdentifiers;
  `get-version-metadata` maps each to displayVersion + releaseDate.
- `download` writes to `<output>.tmp` then applies patches (SINF) to the
  final path. `--purchase` acquires a license for free apps.
- Error strings mapped in `services/ipatool.ts` (NEED_2FA,
  SESSION_EXPIRED, LICENSE_REQUIRED, AUTH_FAILED, NOT_FOUND, RATE_LIMITED).

## Reference Implementation

The Swift reference at `references/ApplePackage/` is the source of truth for Apple protocol behavior:

- Field mappings (iTunes API → Software type) use Swift `CodingKeys`
- Authentication flow, bag endpoint, pod routing, error codes
- Always consult the reference when making protocol changes

### iTunes API Field Mapping

The backend (`backend/src/routes/search.ts`) maps raw iTunes API fields to our `Software` type, matching the Swift CodingKeys in `references/ApplePackage/Sources/ApplePackage/Models/Software.swift`:

| iTunes Field                | Software Field |
| --------------------------- | -------------- |
| `trackId`                   | `id`           |
| `bundleId`                  | `bundleID`     |
| `trackName`                 | `name`         |
| `artworkUrl512`             | `artworkUrl`   |
| `currentVersionReleaseDate` | `releaseDate`  |

All other fields (`version`, `price`, `artistName`, `sellerName`, `description`, `averageUserRating`, `userRatingCount`, `screenshotUrls`, `minimumOsVersion`, `fileSizeBytes`, `releaseNotes`, `formattedPrice`, `primaryGenreName`) keep their original names.

The backend also extracts the `results` array from the iTunes wrapper `{ resultCount, results }` before sending to the frontend.

## Per-Account Isolation

- `accountHash` = sha256(lowercase(trim(email))) — the public account identifier,
  computed backend-side. The frontend no longer computes it.
- Each account gets an isolated ipatool state dir:
  `<dataDir>/ipatool-state/<accountHash>` (XDG_STATE_HOME + XDG_DATA_HOME).
- All ipatool invocations for one account are serialized via `withAccountLock`
  (shared keychain/cookie store is not concurrency-safe).




## Backend

- Express for HTTP API
- ESM modules (`"type": "module"` in package.json)
- `tsx` for development, `tsc` for production build

### Backend Shared Utilities

- `backend/src/utils/route.ts` — shared Express route helpers (`getIdParam`, `requireAccountHash`, `verifyTaskOwnership`)
- `backend/src/config.ts` — centralized constants (`MAX_DOWNLOAD_SIZE`, `DOWNLOAD_TIMEOUT_MS`, `BAG_TIMEOUT_MS`, `BAG_MAX_BYTES`, `MIN_ACCOUNT_HASH_LENGTH`) and env-var config (`disableHttpsRedirect` via `UNSAFE_DANGEROUSLY_DISABLE_HTTPS_REDIRECT`)

## Frontend

- React 19, React Router 7, Zustand for state
- Tailwind CSS 4 for styling
- Vite for build tooling
- IndexedDB for credential storage (via `idb`)
- No Apple protocol code in the browser — all Apple operations go through the backend REST API.
- Account state lives server-side; the frontend only holds `{ email, accountHash, name, storeFront }`.

### Frontend Shared Components (`components/common/`)

- **Alert** — `<Alert type="error|success|warning">` for status messages (replaces inline alert divs)
- **Modal** — `<Modal open={bool} onClose={fn} title={string}>` for dialog overlays
- **Spinner** — inline SVG loading spinner for buttons
- **CountrySelect** — optgroup-based country dropdown with "Available Regions" + "All Regions"
- **AppIcon** — 3 sizes (40/56/80px), rounded corners, letter fallback
- **Badge** — color-coded status pill
- **ProgressBar** — gray track, blue fill, percentage label
- **icons** — shared SVG icon components (`HomeIcon`, `AccountsIcon`, `SearchIcon`, `DownloadsIcon`, `SettingsIcon`, `SunIcon`, `MoonIcon`, `SystemIcon`) used by Sidebar, MobileNav, and MobileHeader

### Frontend Shared Utilities (`utils/`)

- `utils/error.ts` — `getErrorMessage(e, fallback)` for standardized catch-block error extraction
- `utils/crypto.ts` — AES-GCM encrypt/decrypt for account export/import
- `utils/account.ts` — `accountHash()`, `accountStoreCountry()`, `firstAccountCountry()`

### Import Ordering Convention

1. React / library imports (`useState`, `useNavigate`, `useTranslation`)
2. Layout components (`PageContainer`)
3. Common components (`AppIcon`, `Alert`, `Spinner`, `Modal`, `CountrySelect`)
4. Sibling components within the same feature folder (e.g., `DownloadItem` inside `Download/`)
5. Hooks / stores (`useAccounts`, `useSettingsStore`)
6. API modules (`apiPost`, `apiGet`)
7. Utilities (`accountHash`, `getErrorMessage`)
8. Config (`countryCodeMap`, `storeIdToCountry`)
9. Types (`type Software`)

**Enforcement**: Every PR must verify import ordering. Common mistakes:

- Putting hooks/stores before layout/common components
- Putting config before utilities
- Putting type imports in the middle instead of last

## Security Model

### Account Hash Is Public

`accountHash` is a SHA-256 of the account email. It is treated as **public, non-secret data** — it identifies which account owns a download but does not grant any privileged access. No authentication is bound to it. This is by design: the server is a blind proxy and does not manage user sessions.

### Trusted Sources

- **Apple API responses** (bag XML, iTunes search results, `customerMessage` fields) are treated as trusted content. No additional sanitization is applied beyond what React's text rendering provides (no `dangerouslySetInnerHTML`).
- **Apple CDN redirects** during IPA download are trusted. The initial URL is validated against `*.apple.com`, and redirect targets from Apple's CDN infrastructure (e.g., Akamai) are followed. The response body is saved to disk — it is never reflected back to the requester.

### Server-Side Credential Storage

Apple ID passwords are AES-256-GCM encrypted in `data/accounts.json`
(key: `data/.master.key`, 0600). The password is passed to `ipatool auth login`
transiently and never written to logs. ipatool's own keychain (per-account
state dir) holds the Apple session tokens. This instance is single-user /
self-hosted by design.

### Backend Does Not Reflect Request Headers

The settings endpoint (`/api/settings`) must never reflect request headers (`x-forwarded-host`, `host`, etc.) in its response body. Use server-side values only (`config.*`, `process.uptime()`).

## Error Handling

- Early returns to reduce nesting
- `try/catch` for async operations
- Express error middleware for centralized handling
- Type-safe error responses

### ipatool Error Codes (mapped in `services/ipatool.ts`)

- `NEED_2FA`: Apple requires a 2FA code — client shows the code input
- `SESSION_EXPIRED`: auto re-login with stored password via `withSessionRetry`
- `LICENSE_REQUIRED`: app needs a license first (download uses `--purchase`)
- `AUTH_FAILED` / `NOT_FOUND` / `RATE_LIMITED` / `UNKNOWN`

## Testing

### Unit Tests

```bash
cd backend && npx vitest run    # Node environment
cd frontend && npx vitest run   # jsdom environment with fake-indexeddb
```

### E2E Tests (Playwright)

```bash
cd e2e && pnpm test                            # Local (requires Docker on port 8080)
docker compose --profile test run --rm playwright  # Docker-based
bash e2e/docker-test.sh                        # Full: build + test
```

E2E tests import from `./fixtures` instead of `@playwright/test`.

WebSocket proxy tests use `location.host` to derive URLs dynamically, so they work both locally (`localhost:8080`) and in Docker (`asspp:8080`).

Real-account verification: login → search → version list → download → install.

E2E tests cover:

- Add account flow (device ID field, randomize button, auth)
- Account detail (device ID, pod display)
- Settings page (no global device ID section)
- Search/lookup by bundle ID (verifies iTunes field mapping)
- Downloads API (iTunesMetadata support, backward compatibility)

### Test Account

Test credentials are stored in environment variables (`TEST_EMAIL`, `TEST_PASSWORD`, `TEST_DEVICE_ID`, `TEST_BUNDLE_ID`) and must never be committed to the repository.

## Deployment

```bash
docker compose up --build -d   # Builds and runs on port 8080
```

Single container serves both the Express backend and the Vite-built React SPA. SPA routes are handled by serving `index.html` for all non-API paths.

### Docker E2E Testing

The `compose.yml` includes a `playwright` service under the `test` profile:

```bash
docker compose --profile test run --rm playwright
```

This runs Playwright inside the official `mcr.microsoft.com/playwright` image, connecting to the app container via Docker internal DNS (`http://asspp:8080`). The `asspp` service has a healthcheck so the test container waits until the app is ready.

The `e2e/docker-test.sh` script automates the full flow: build + test.

## Interface Design System

### Intent

**Who**: Developers and power users managing Apple app downloads outside the App Store — sideloading IPAs, managing multiple Apple IDs, tracking licenses. Technical audience, likely running this alongside terminals or Xcode.

**Task**: Authenticate Apple accounts → search apps → acquire licenses → download/compile IPAs → install.

**Feel**: A sharp utility. Precise like a package manager, clear like Apple's developer tools. Confident, quiet, functional. Not playful, not corporate.

### Design Tokens

- **Primary accent**: `blue-600` / `blue-700` (hover) — trust + system authority, echoes Apple dev tooling
- **Backgrounds**: `gray-50` (app), `white` (cards/surfaces)
- **Text**: `gray-900` (primary), `gray-600` (secondary), `gray-400` (tertiary)
- **Borders**: `gray-200` (default), `gray-300` (hover) — use sparingly, prefer background tinting for containment
- **Status badges**: Muted tones — `green` (completed), `blue` (downloading), `yellow` (paused), `purple` (injecting), `red` (failed), `gray` (pending)
- **Alerts**: `red-50`/`red-700` (error), `amber-50`/`amber-700` (warning), `green-50`/`green-700` (success)

### Typography

- System font stack (Inter / SF Pro fallback)
- Weight scale: `500` (medium, workhorse), `600` (semibold, page titles and key labels only). Avoid `700` in body.
- Size scale: `xs` (12px), `sm` (14px), `base` (16px), `lg` (18px), `xl` (20px), `2xl` (24px)

### Spacing

- Base unit: `4px`
- Consistent vertical rhythm: `space-y-4` within sections, `space-y-6` between sections
- Page padding: `px-4 sm:px-6`, `py-6`
- Container: `max-w-5xl` (1024px)

### Depth & Surfaces

- Single elevation: white cards on `gray-50` background
- No shadows. Borders only where they serve function (form inputs, dividers, interactive boundaries)
- Rounded corners: `rounded-lg` (8px) for cards, `rounded-md` (6px) for inputs/buttons, `rounded-full` for badges
- Prefer background tinting (`gray-50` → `gray-100`) over borders for visual containment

### Layout

- Desktop: fixed sidebar (240px / `w-60`) + scrollable main content
- Mobile: bottom tab bar with safe-area padding
- Breakpoint: `md:` (768px) for sidebar ↔ bottom nav switch
- Page structure: `PageContainer` with title + optional action button, then content

### Component Patterns

- **Buttons**: Primary (`bg-blue-600 text-white`), Secondary (`border border-gray-300 text-gray-700`), Danger (`text-red-600 border-red-300`)
- **Inputs**: `rounded-md border-gray-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500`
- **Cards**: White background, `border border-gray-200 rounded-lg`, no shadow
- **Badge**: Color-coded pill (`rounded-full px-2 py-0.5 text-xs font-medium`)
- **ProgressBar**: Gray track, blue fill, percentage label
- **AppIcon**: 3 sizes (40/56/80px), rounded corners, letter fallback
- **Nav active state**: `bg-blue-50 text-blue-700` (sidebar), `text-blue-600` (mobile)

## Frontend Cleanup Rules

These rules prevent the codebase from becoming messy after merging PRs. Enforce them on every change.

### `transition-colors` Usage Policy

**Problem**: `transition-colors` on static containers (cards, sections, alerts, badges) causes visible color flashing when the page loads in dark mode — the element briefly renders in light colors then transitions to dark.

**Rule**: Only use `transition-colors` on **interactive elements** that change color on user interaction:

- Buttons (hover state)
- Links (hover state)
- Form inputs and selects (focus state)
- Nav items (hover/active state)

**Never use `transition-colors` on**:

- Card containers (`bg-white dark:bg-gray-900 rounded-lg border ...`)
- Section wrappers (`<section>` with background)
- Alert/warning banners (use the `<Alert>` component)
- Badge pills
- ProgressBar tracks
- Modal containers
- AppIcon fallback containers
- Empty state placeholder containers

**Exception**: Layout chrome (Sidebar, MobileNav, MobileHeader, PageContainer) may keep `transition-colors duration-200` for smooth theme toggle animation, since these persist across navigations.

### Shared Icons

All navigation and theme icons live in `components/common/icons.tsx`. When Sidebar, MobileNav, or MobileHeader need icons, import from there. Never duplicate icon SVG components inline.

### Import Ordering Verification

Before merging any frontend PR, verify imports follow the convention in every changed file:

```
1. React / library imports
2. Layout components
3. Common components
4. Sibling components (same feature folder)
5. Hooks / stores
6. API modules
7. Utilities
8. Config
9. Types (always last)
```

### Empty State Containers

Empty states (shown when a list has no items) use a consistent pattern:

- `border-2 border-dashed` (not solid border)
- `bg-gray-50 dark:bg-gray-900/30` background
- No `transition-colors` (removed to prevent dark mode flashing)
- Centered icon in a white circle, title, description, optional CTA button

### Dark Mode Color Pairings

Always pair light and dark variants consistently:

- **Primary text**: `text-gray-900 dark:text-white`
- **Secondary text**: `text-gray-600 dark:text-gray-400` or `text-gray-500 dark:text-gray-400`
- **Tertiary text**: `text-gray-400 dark:text-gray-500`
- **Card background**: `bg-white dark:bg-gray-900`
- **Page background**: `bg-gray-50 dark:bg-gray-950`
- **Card border**: `border-gray-200 dark:border-gray-800`
- **Input border**: `border-gray-300 dark:border-gray-700`

### Code Duplication Prevention

When the same UI pattern appears in 3+ components, extract it to `components/common/`. Current shared components:

- `Alert`, `Modal`, `Spinner`, `CountrySelect`, `AppIcon`, `Badge`, `ProgressBar`, `icons`

When adding new common components, update this AGENTS.md file accordingly.

### Authenticated API Downloads

**Problem**: Plain `<a href="/api/...">` tags and `window.open("/api/...")` make regular browser navigations that cannot carry custom HTTP headers. When `ACCESS_PASSWORD` is set, the `accessAuth` middleware requires an `X-Access-Token` header, so these requests fail with 401.

**Rule**: Never use `<a href>` or `window.open` for `/api/` endpoints that require authentication. Instead, use `fetch()` with `authHeaders()` from `api/client.ts`, then trigger a download via blob URL:

```tsx
const res = await fetch(url, { headers: authHeaders() });
const blob = await res.blob();
const blobUrl = URL.createObjectURL(blob);
const a = document.createElement("a");
a.href = blobUrl;
a.download = filename;
a.click();
URL.revokeObjectURL(blobUrl);
```

**Exceptions**: Routes that the backend explicitly skips auth for (`/auth/*`, `/install/*`) may use plain links — e.g., `itms-services://` install URLs are fine since `/install/*` is public.
