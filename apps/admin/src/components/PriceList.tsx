import type { PriceSummary } from "@iot-os/api-client"
import { formatDay } from "@iot-os/ui/lib/invoices"
import { formatMoney } from "@iot-os/ui/lib/money"
import { priceKinds, priceText } from "../lib/invoices"

/**
 * This month's prices, each with the change waiting for next month (spec 029 FR-028).
 * The data point price names its block size.
 */
export function PriceList({ prices }: { prices: PriceSummary }) {
  const { current, next, currency } = prices
  const block = (size: number) => `per ${size.toLocaleString()} data points`
  const changes = (kind: (typeof priceKinds)[number]) =>
    next !== null &&
    (next[kind] !== current[kind] || (kind === "data_point_overage_price" && next.data_point_block_size !== current.data_point_block_size))

  return (
    <dl className="grid grid-cols-[minmax(0,14rem)_minmax(0,1fr)] gap-x-4 gap-y-2">
      {priceKinds.map((kind) => (
        <div key={kind} className="contents">
          <dt className="text-muted-foreground">{priceText[kind].label}</dt>
          <dd className="min-w-0">
            <span className="tabular-nums">{formatMoney(current[kind], currency)}</span>
            {kind === "data_point_overage_price" ? (
              <span className="text-muted-foreground"> {block(current.data_point_block_size)}</span>
            ) : null}
            {next && changes(kind) ? (
              <span className="block text-meta text-muted-foreground">
                {formatMoney(next[kind], currency)}
                {kind === "data_point_overage_price" ? ` ${block(next.data_point_block_size)}` : ""} from{" "}
                {formatDay(next.effective_from)}
              </span>
            ) : null}
          </dd>
        </div>
      ))}
    </dl>
  )
}
