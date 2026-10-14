import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';

import App from './App';

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

test('renders the home page at the configured deployment base', async () => {
  window.history.replaceState(null, '', import.meta.env.BASE_URL);
  render(<App />);
  expect(await screen.findByRole('textbox', { name: 'Search query' })).toBeInTheDocument();
});
