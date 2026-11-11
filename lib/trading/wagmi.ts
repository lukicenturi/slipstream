import { createConfig, http } from "wagmi";
import { arbitrum, arbitrumSepolia, mainnet } from "wagmi/chains";
import { injected } from "wagmi/connectors/injected";
import { walletConnect } from "wagmi/connectors/walletConnect";

/*
 * Wallet connection for every build. On mainnet no action ever signs: the
 * app only reads the connected address, and no code path there requests a
 * signature or creates an exchange client. In the testnet build the wallet
 * also signs approveAgent once.
 * The chains are the wallet's EVM chains. They are used only for the
 * EIP-712 signature domain of approveAgent (testnet build). Hyperliquid
 * itself is not an EVM chain here. "mainnet" is Ethereum mainnet, where many
 * wallets start; it does not enable any Hyperliquid mainnet action.
 */

const walletConnectProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

export function createWagmiConfig() {
  return createConfig({
    chains: [arbitrum, arbitrumSepolia, mainnet],
    connectors: [
      injected(),
      // Needs a Reown project id and the optional @walletconnect/ethereum-provider package.
      ...(walletConnectProjectId ? [walletConnect({ projectId: walletConnectProjectId })] : []),
    ],
    transports: {
      [arbitrum.id]: http(),
      [arbitrumSepolia.id]: http(),
      [mainnet.id]: http(),
    },
    ssr: true,
  });
}

export type WagmiConfig = ReturnType<typeof createWagmiConfig>;

declare module "wagmi" {
  interface Register {
    config: WagmiConfig;
  }
}
