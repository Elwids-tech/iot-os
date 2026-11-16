import type { Meta, StoryObj } from "@storybook/react-vite"
import { BookOpenIcon, LinkIcon, MonitorIcon, PencilIcon, SparklesIcon } from "lucide-react"
import { Button } from "@iot-os/ui/components/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@iot-os/ui/components/dialog"
import { NotificationBell } from "@iot-os/ui/components/notification-bell"
import { PageHeader } from "@iot-os/ui/components/page-header"
import { PageHelpContext } from "@iot-os/ui/components/page-help"
import { SidebarProvider } from "@iot-os/ui/components/sidebar"

const meta: Meta = { title: "Components/PageHeader", parameters: { layout: "fullscreen" } }
export default meta

/** The portal's help slot: the bell, Assistant and Help, which stay visible at every width. */
const help = {
  trigger: (
    <>
      <NotificationBell count={2} open={false} onOpenChange={() => {}} items={[]} />
      <Button variant="ghost" size="sm">
        <SparklesIcon data-icon="inline-start" />
        <span className="max-sm:sr-only">Assistant</span>
      </Button>
      <Button variant="ghost" size="sm">
        <BookOpenIcon data-icon="inline-start" />
        <span className="max-sm:sr-only">Help</span>
      </Button>
    </>
  ),
  onContextChange: () => {},
}

function Header() {
  return (
    <SidebarProvider className="-m-6 block min-h-svh">
      <PageHelpContext.Provider value={help}>
        <PageHeader
          title="Plant room energy"
          back={{ to: "#dashboards", label: "Dashboards" }}
          meta="3 panels"
          actions={
            <>
              <Button variant="outline">
                <LinkIcon data-icon="inline-start" />
                <span className="max-sm:sr-only">Copy link</span>
              </Button>
              <Button variant="outline">
                <MonitorIcon data-icon="inline-start" />
                <span className="max-sm:sr-only">Kiosk</span>
              </Button>
              {/* An action that opens a dialog keeps working from the phone's More actions list. */}
              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="outline">Rename</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Rename dashboard</DialogTitle>
                    <DialogDescription>Opened from the header's actions.</DialogDescription>
                  </DialogHeader>
                </DialogContent>
              </Dialog>
              <Button>
                <PencilIcon data-icon="inline-start" />
                Edit
              </Button>
            </>
          }
        />
      </PageHelpContext.Provider>
    </SidebarProvider>
  )
}

/** From 768 px every action sits in the title row, before the bell, Assistant and Help. */
export const Computer: StoryObj = {
  globals: { viewport: { value: "computer", isRotated: false } },
  render: () => <Header />,
}

/**
 * Phones (under 768 px): the menu button and the primary action (Edit) stay; the rest go
 * behind More actions, where Rename still opens its dialog. The bell, Assistant and Help
 * never move.
 */
export const Phone: StoryObj = {
  globals: { viewport: { value: "phone", isRotated: false } },
  render: () => <Header />,
}
