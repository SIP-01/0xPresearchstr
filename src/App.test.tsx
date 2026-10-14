import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import App from './App';
import { useAppContext } from '@/hooks/useAppContext';
import { TestApp } from '@/test/TestApp';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.removeItem('test-app-config');
  window.history.replaceState(null, '', '/');
});

test('renders the home page at the configured deployment base', async () => {
  window.history.replaceState(null, '', import.meta.env.BASE_URL);
  render(<App />);
  expect(await screen.findByRole('textbox', { name: 'Search query' })).toBeInTheDocument();
});

test.each(['QuotaExceededError', 'SecurityError'])('keeps session settings and warns when storage fails with %s', async (errorName) => {
  localStorage.removeItem('test-app-config');
  const { result } = renderHook(useAppContext, { wrapper: TestApp });
  await waitFor(() => expect(result.current).not.toBeNull());

  const originalSetItem = Storage.prototype.setItem;
  const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
    if (key === 'test-app-config') throw new DOMException('Storage unavailable', errorName);
    originalSetItem.call(this, key, value);
  });
  vi.spyOn(console, 'warn').mockImplementation(() => {});

  act(() => result.current.updateConfig(() => ({ privacyMode: true })));
  expect(result.current.config.privacyMode).toBe(true);
  expect(localStorage.getItem('test-app-config')).toBeNull();
  expect(screen.getByRole('alert')).toHaveTextContent('Settings could not be saved');
  expect(screen.getByRole('alert')).toHaveTextContent('Changes apply for this session only');

  write.mockRestore();
  act(() => result.current.updateConfig((current) => ({ autoIndex: current.privacyMode })));
  expect(result.current.config.autoIndex).toBe(true);
  expect(JSON.parse(localStorage.getItem('test-app-config')!)).toMatchObject({ privacyMode: true, autoIndex: true });
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
