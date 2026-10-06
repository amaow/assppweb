import { Profiler } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProductDetail from '../../src/components/Search/ProductDetail';
import { useToastStore } from '../../src/store/toast';
import type { Account, Software } from '../../src/types';

const mocks = vi.hoisted(() => ({
  accounts: [] as Account[],
  startDownload: vi.fn(),
  toastDownloadError: vi.fn(),
  lookupApp: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('../../src/hooks/useAccounts', () => ({
  useAccounts: () => ({
    accounts: mocks.accounts,
  }),
}));

vi.mock('../../src/hooks/useDownloadAction', () => ({
  useDownloadAction: () => ({
    startDownload: mocks.startDownload,
    toastDownloadError: mocks.toastDownloadError,
  }),
}));

vi.mock('../../src/api/search', () => ({
  lookupApp: mocks.lookupApp,
}));

const app: Software = {
  id: 123456,
  bundleID: 'com.example.utility',
  name: 'Example Utility',
  version: '3.4.5',
  price: 0,
  artistName: 'Example Developer',
  sellerName: 'Example Developer LLC',
  description: 'A test application.',
  averageUserRating: 4.8,
  userRatingCount: 42,
  artworkUrl: '',
  screenshotUrls: [],
  minimumOsVersion: '16.0',
  fileSizeBytes: '5242880',
  releaseDate: '2026-08-01T00:00:00Z',
  formattedPrice: 'Free',
  primaryGenreName: 'Utilities',
};

const account: Account = {
  email: 'developer@example.test',
  accountHash: 'abc123hash',
  name: 'Example Developer',
  storeFront: '143441',
};

function deferredPromise() {
  let resolve!: () => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = () => resolvePromise();
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

function renderProductDetail(onRender?: () => void) {
  const product = <ProductDetail />;

  return render(
    <MemoryRouter
      initialEntries={[
        {
          pathname: `/search/${app.id}`,
          state: { app, country: 'US' },
        },
      ]}
    >
      <Routes>
        <Route
          path="/search/:appId"
          element={
            onRender ? (
              <Profiler id="product-detail" onRender={onRender}>
                {product}
              </Profiler>
            ) : (
              product
            )
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

function renderProductPreview() {
  return render(
    <MemoryRouter
      initialEntries={['/search/preview?preview=product']}
    >
      <Routes>
        <Route path="/search/:appId" element={<ProductDetail />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ProductDetail download action', () => {
  beforeEach(() => {
    mocks.accounts = [account];
    mocks.startDownload.mockReset();
    mocks.toastDownloadError.mockReset();
    mocks.lookupApp.mockReset();
    mocks.lookupApp.mockResolvedValue(null);
    useToastStore.setState({ toasts: [] });
  });

  afterEach(() => {
    if (vi.isFakeTimers()) {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
    useToastStore.setState({ toasts: [] });
  });

  it('keeps the download button stable until startDownload resolves', async () => {
    const deferred = deferredPromise();
    mocks.startDownload.mockReturnValue(deferred.promise);
    const user = userEvent.setup();

    renderProductDetail();
    const accountSelect = screen.getByRole('combobox');
    await waitFor(() => expect(accountSelect).toHaveValue(account.accountHash));

    const downloadButton = screen.getByRole('button', {
      name: 'search.product.download',
    });
    const iconSlot = downloadButton.querySelector('span[aria-hidden="true"]');

    expect(downloadButton).toHaveClass('w-full', 'min-w-0');
    expect(downloadButton).not.toHaveClass('opacity-50');
    expect(downloadButton).toHaveAttribute('aria-busy', 'false');
    expect(iconSlot).toHaveClass('h-4', 'w-4', 'shrink-0');

    await user.click(downloadButton);

    expect(mocks.startDownload).toHaveBeenCalledOnce();
    expect(mocks.startDownload).toHaveBeenCalledWith(account, app);
    expect(downloadButton).toBeDisabled();
    expect(downloadButton).toHaveAttribute('aria-busy', 'true');

    await act(async () => {
      deferred.resolve();
      await deferred.promise;
    });

    await waitFor(() => expect(downloadButton).toBeEnabled());
    expect(downloadButton).toHaveAttribute('aria-busy', 'false');
    expect(downloadButton.querySelector('.animate-spin')).not.toBeInTheDocument();
    expect(downloadButton.querySelector('span[aria-hidden="true"]')).toBe(
      iconSlot,
    );
  });

  it('is disabled on the initial commit before an account is selected', async () => {
    const disabledByCommit: boolean[] = [];

    renderProductDetail(() => {
      const button = document.querySelector<HTMLButtonElement>(
        'button[aria-busy]',
      );
      if (button) disabledByCommit.push(button.disabled);
    });

    const downloadButton = screen.getByRole('button', {
      name: 'search.product.download',
    });
    expect(disabledByCommit[0]).toBe(true);
    await waitFor(() => expect(downloadButton).toBeEnabled());
  });

  it('keeps download and version actions in one grid row', () => {
    renderProductDetail();

    const downloadButton = screen.getByRole('button', {
      name: 'search.product.download',
    });
    const versionLink = screen.getByRole('link', {
      name: 'search.product.versionHistory',
    });
    const actionRow = downloadButton.parentElement;

    expect(actionRow).toBe(versionLink.parentElement);
    expect(actionRow).toHaveClass('grid', 'grid-flow-col', 'auto-cols-fr');
    expect(Array.from(actionRow?.children ?? [])).toEqual([
      downloadButton,
      versionLink,
    ]);

    for (const action of [downloadButton, versionLink]) {
      expect(action).toHaveClass('w-full', 'min-w-0');
    }
  });

  it('simulates a preview download without calling real services', async () => {
    vi.useFakeTimers();
    mocks.accounts = [];

    renderProductPreview();
    await act(async () => {
      await Promise.resolve();
    });

    expect(
      screen.getByRole('heading', { name: 'Signal Canvas' }),
    ).toBeInTheDocument();
    const accountSelect = screen.getByRole('combobox');
    expect(accountSelect).toHaveValue('preview-hash-1');
    const downloadButton = screen.getByRole('button', {
      name: 'search.product.download',
    });
    expect(downloadButton).toBeEnabled();
    expect(useToastStore.getState().toasts).toHaveLength(0);

    fireEvent.click(downloadButton);

    expect(downloadButton).toBeDisabled();
    expect(downloadButton).toHaveAttribute('aria-busy', 'true');
    expect(downloadButton.querySelector('.animate-spin')).toBeInTheDocument();
    expect(mocks.lookupApp).not.toHaveBeenCalled();
    expect(mocks.startDownload).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(downloadButton).toBeDisabled();
    expect(downloadButton).toHaveAttribute('aria-busy', 'true');
    expect(downloadButton.querySelector('.animate-spin')).toBeInTheDocument();
    expect(useToastStore.getState().toasts).toHaveLength(0);
    expect(mocks.lookupApp).not.toHaveBeenCalled();
    expect(mocks.startDownload).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100);
    });

    expect(downloadButton).toBeEnabled();
    expect(downloadButton).toHaveAttribute('aria-busy', 'false');
    expect(downloadButton.querySelector('.animate-spin')).not.toBeInTheDocument();
    expect(mocks.lookupApp).not.toHaveBeenCalled();
    expect(mocks.startDownload).not.toHaveBeenCalled();
    expect(useToastStore.getState().toasts).toEqual([
      expect.objectContaining({
        message: 'search.product.previewActionComplete',
        title: 'search.product.previewBadge',
        type: 'success',
      }),
    ]);
  });
});
