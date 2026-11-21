// The portal's first script after runtime-config.js (spec 036, research R9). vite.config.ts
// inlines it into index.html, so it runs before the app's code is even fetched. It names
// the tab, sets its icons and draws a loading mark from the brand of the address the page
// was opened on, so the platform's own name is never drawn on a billing account's address.
// Plain ES5 with no imports: brand-bootstrap.test.ts runs this same text.
;(function (window, document) {
  var KEPT = "iot-runtime-config"
  var PLATFORM = "IoT OS"
  var config = window.__IOT_CONFIG__
  var storage = null
  try {
    storage = window.localStorage
  } catch (error) {
    storage = null
  }

  // runtime-config.js could not be fetched (the installed app, offline): an address
  // starts from what it last learned there, never from the platform's built-in values.
  if (!config && storage) {
    try {
      var kept = JSON.parse(storage.getItem(KEPT) || "null")
      if (kept && kept.address && kept.address.host === window.location.hostname) {
        config = kept
        window.__IOT_CONFIG__ = kept
      }
    } catch (error) {
      config = undefined
    }
  }
  var address = (config && config.address) || null
  var brand = (config && config.brand) || null

  if (address && address.state === "moved" && address.to) {
    // The account renamed its address; the old one redirects for 30 days.
    window.__IOT_HALT__ = true
    window.location.replace(address.to + window.location.pathname + window.location.search + window.location.hash)
    return
  }

  var root = document.getElementById("root")
  var manifest = document.querySelector('link[rel="manifest"]')
  if (address && address.state === "not_in_use") {
    window.__IOT_HALT__ = true
    document.title = "This address is not in use"
    if (manifest) manifest.parentNode.removeChild(manifest)
    if (storage) storage.removeItem(KEPT)
    if (root) {
      var message = document.createElement("p")
      message.setAttribute("data-address-not-in-use", "")
      message.setAttribute("style", "margin:0;min-height:100svh;display:grid;place-items:center;padding:16px;text-align:center;font:500 16px/1.5 system-ui,sans-serif")
      message.textContent = "This address is not in use."
      root.appendChild(message)
    }
    return
  }

  if (storage) {
    try {
      if (address) storage.setItem(KEPT, JSON.stringify(config))
      else if (config) storage.removeItem(KEPT)
    } catch (error) {
      // Private browsing: the address simply needs the network next time.
    }
  }

  // An address whose brand has no name yet shows the platform's, as its own address does.
  document.title = brand ? brand.product_name : PLATFORM
  if (!address) return

  // The installed app is named by the build until addresses get their own manifest,
  // so an address offers no install rather than the platform's name.
  if (manifest) manifest.parentNode.removeChild(manifest)
  var touch = document.querySelector('link[rel="apple-touch-icon"]')
  if (touch) {
    if (brand && brand.touch_icon) touch.setAttribute("href", brand.touch_icon)
    else touch.parentNode.removeChild(touch)
  }
  if (!brand) return
  if (brand.icon) {
    var icon = document.createElement("link")
    icon.setAttribute("rel", "icon")
    icon.setAttribute("href", brand.icon)
    document.head.appendChild(icon)
  }
  if (root) {
    // The appearance next-themes will apply: the stored choice, dark by default.
    var theme = "dark"
    try {
      theme = (storage && storage.getItem("theme")) || "dark"
    } catch (error) {
      theme = "dark"
    }
    var dark = theme === "dark" || (theme === "system" && !!window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches)
    var logo = (dark && brand.logo_dark) || brand.logo
    var mark = document.createElement("div")
    mark.setAttribute("data-brand-loading", "")
    mark.setAttribute("style", "min-height:100svh;display:grid;place-items:center;padding:16px;font:600 18px/1.4 system-ui,sans-serif")
    if (logo) {
      var image = document.createElement("img")
      image.setAttribute("src", logo)
      image.setAttribute("alt", brand.product_name)
      image.setAttribute("style", "max-height:48px;max-width:200px")
      mark.appendChild(image)
    } else {
      mark.textContent = brand.product_name
    }
    root.appendChild(mark)
  }
})(window, document)
