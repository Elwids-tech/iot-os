import { expect, type Page } from "@playwright/test"

/**
 * The page fits a phone: no sideways scrolling (FR-002), every visible button, input,
 * select and textarea offers a target of at least 44 × 44 px (FR-004), and text fields
 * use 16 px text so iOS does not zoom in on focus. A control's hit
 * area includes an absolutely positioned `::before` or `::after` (checkboxes and switches
 * grow theirs on phones). Inline link buttons and copyable text are exempt, as WCAG 2.5.8
 * exempts targets in a line of text.
 */
export async function expectPhoneFit(page: Page) {
  // The overflow, or the outermost elements that stick out past the right edge.
  await expect
    .poll(() =>
      page.evaluate(() => {
        if (document.scrollingElement!.scrollWidth <= innerWidth) return []
        // Content inside a box that clips or scrolls sideways within the screen is fine.
        const contained = (element: HTMLElement) => {
          for (let box = element.parentElement; box && box !== document.body; box = box.parentElement)
            if (getComputedStyle(box).overflowX !== "visible") return box.getBoundingClientRect().right <= innerWidth + 0.5
          return false
        }
        const wide = [...document.body.querySelectorAll<HTMLElement>("*")].filter(
          (element) => element.getBoundingClientRect().right > innerWidth + 0.5 && !contained(element),
        )
        return wide
          .filter((element) => !wide.includes(element.parentElement!))
          .slice(0, 5)
          .map(
            (element) =>
              `${element.tagName.toLowerCase()}.${String(element.className).slice(0, 50)} "${(element.textContent ?? "").trim().slice(0, 30)}" → ${Math.round(element.getBoundingClientRect().right)} px`,
          )
      }),
    { message: "the page scrolls sideways" })
    .toEqual([])
  // Sheets and popovers zoom and slide in; measure once they have settled.
  await page.waitForFunction(() =>
    document.getAnimations().every((animation) => animation.playState !== "running" || animation.effect?.getTiming().iterations === Infinity),
  )
  const small = await page.evaluate(() => {
    const px = (value: string) => (value.endsWith("px") ? parseFloat(value) : 0)
    const offenders: string[] = []
    for (const element of document.querySelectorAll<HTMLElement>(
      "button, [role=button], input:not([type=hidden]), select, textarea",
    )) {
      if (element.closest("[aria-hidden=true], [inert]")) continue
      if (!element.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue
      const box = element.getBoundingClientRect()
      // Visually hidden controls (sr-only, Radix's native select) are 1 px or less.
      if (box.width <= 1 || box.height <= 1) continue
      // Text targets inside a line: link buttons and copyable codes.
      if (element.dataset.variant === "link" || element.dataset.slot === "copy-text") continue
      let width = box.width
      let height = box.height
      for (const pseudo of ["::before", "::after"]) {
        const style = getComputedStyle(element, pseudo)
        if (style.content === "none" || style.position !== "absolute") continue
        width = Math.max(width, box.width - px(style.left) - px(style.right))
        height = Math.max(height, box.height - px(style.top) - px(style.bottom))
      }
      const name = (element.getAttribute("aria-label") ?? element.getAttribute("placeholder") ?? element.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40)
      // Text fields need 16 px text, or iOS zooms the page when they take focus.
      const typed = element.matches("textarea, input:not([type=checkbox], [type=radio], [type=range], [type=file])")
      if (typed && parseFloat(getComputedStyle(element).fontSize) < 16) offenders.push(`${element.tagName.toLowerCase()} "${name}" text ${getComputedStyle(element).fontSize}`)
      if (width >= 43.5 && height >= 43.5) continue
      offenders.push(`${element.tagName.toLowerCase()}[${element.getAttribute("role") ?? element.getAttribute("type") ?? ""}] "${name}" ${Math.round(width)}×${Math.round(height)}`)
    }
    return offenders
  })
  expect(small, "controls under 44 × 44 px").toEqual([])
}
