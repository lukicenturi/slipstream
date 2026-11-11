import { Badge } from "@/components/ui/badge";
import { networkLabel, type Network } from "@/lib/trading/config";

/**
 * The network of a trading view: "MAINNET" or "TESTNET" in an amber
 * outline. Mainnet uses the same amber as testnet on purpose: it is the
 * network where orders use real funds, so it must not look muted.
 */
export function NetworkBadge({ network, className }: { network: Network; className?: string }) {
  return (
    <Badge
      variant="outline"
      data-testid="network-badge"
      data-network={network}
      className={className ?? "border-brand/60 text-brand"}
    >
      {networkLabel(network)}
    </Badge>
  );
}
