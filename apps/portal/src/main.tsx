import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ThemeProvider } from "next-themes"
import { RouterProvider, createBrowserRouter } from "react-router-dom"
import { Toaster } from "@iot-os/ui/components/sonner"
import { SkinProvider } from "@iot-os/ui/components/skin"
import "@iot-os/ui/globals.css"
import { App } from "./App"
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false, staleTime: 15000 },
    mutations: { retry: false },
  },
})
const router = createBrowserRouter([{ path: "*", element: <App /> }])
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange
    >
      <SkinProvider>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
          <Toaster position="top-center" closeButton duration={2500} />
        </QueryClientProvider>
      </SkinProvider>
    </ThemeProvider>
  </StrictMode>,
)
