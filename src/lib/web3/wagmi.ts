/**
 * wagmi configuration — deliberately minimal: Base mainnet only, injected
 * (browser-extension / EIP-1193) wallet connector only. No WalletConnect,
 * RainbowKit, or ConnectKit. Reads fall back to the public Base RPC.
 */
import { createConfig, http } from 'wagmi';
import { injected } from 'wagmi/connectors';

import { BASE_MAINNET_RPC_URL, KEYWORD_MARKET_CHAIN } from './contracts';

export const wagmiConfig = createConfig({
  chains: [KEYWORD_MARKET_CHAIN],
  connectors: [injected({ shimDisconnect: true })],
  transports: {
    [KEYWORD_MARKET_CHAIN.id]: http(BASE_MAINNET_RPC_URL),
  },
});
