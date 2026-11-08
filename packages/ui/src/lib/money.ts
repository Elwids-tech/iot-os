/**
 * Money on invoices and prices (spec 029): amounts travel as integers in the currency's
 * minor units, so 2273 USD is 22.73. Format and parse here; never divide by 100 in a page.
 */

/** Decimal places of a currency's minor unit: 2 for USD, 0 for JPY. */
export function currencyDigits(currency: string): number {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2
  } catch {
    return 2
  }
}

/** An amount in minor units as the reader's locale writes the currency: 2273 USD → "$22.73". */
export function formatMoney(amount: number, currency: string): string {
  const digits = currencyDigits(currency)
  const value = amount / 10 ** digits
  try {
    return value.toLocaleString(undefined, {
      style: "currency",
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    })
  } catch {
    return `${value.toFixed(digits)} ${currency}`
  }
}

/** Minor units as an input's plain value: 2273 USD → "22.73". */
export function moneyInput(amount: number, currency: string): string {
  const digits = currencyDigits(currency)
  return (amount / 10 ** digits).toFixed(digits)
}

/**
 * What someone typed, in major units, as minor units: "22.73" → 2273, "1,250" → 125000.
 * Null unless it is a number with at most the currency's decimals; a minus sign only
 * with `signed`.
 */
export function parseMoney(text: string, currency: string, { signed = false }: { signed?: boolean } = {}): number | null {
  const digits = currencyDigits(currency)
  const cleaned = text.trim().replaceAll(",", "")
  const pattern = digits > 0 ? new RegExp(`^(-?)(\\d+)(?:\\.(\\d{0,${digits}}))?$`) : /^(-?)(\d+)$/
  const match = pattern.exec(cleaned)
  if (!match || (match[1] && !signed)) return null
  const minor = Number(match[2]) * 10 ** digits + Number((match[3] ?? "").padEnd(digits, "0") || "0")
  if (!Number.isSafeInteger(minor)) return null
  return match[1] && minor !== 0 ? -minor : minor
}

/** A tax rate in basis points as a percentage: 1500 → "15%", 825 → "8.25%". */
export function formatBasisPoints(basisPoints: number): string {
  return `${(basisPoints / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`
}

/** A typed percentage as basis points: "15" → 1500, "8.25" → 825; null past two decimals or 100%. */
export function parseBasisPoints(text: string): number | null {
  const match = /^(\d{1,3})(?:\.(\d{0,2}))?$/.exec(text.trim())
  if (!match) return null
  const basisPoints = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"))
  return basisPoints <= 10_000 ? basisPoints : null
}
