import { useState } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { BrandEditor, type BrandEditorBrand } from "@iot-os/ui/components/brand-editor"
import { Panel, PanelContent, PanelDescription, PanelHeader, PanelTitle } from "@iot-os/ui/components/panel"

const meta: Meta<typeof BrandEditor> = { title: "Components/BrandEditor", component: BrandEditor }
export default meta

const limits = { image_bytes: 1048576, types: ["image/png", "image/jpeg", "image/webp"], icon_min: 512 }
const empty: BrandEditorBrand = { product_name: null, short_name: null, support_url: null, logo: null, logo_dark: null, icon: null, in_effect: false, revision: 0 }
const image = (file: File) => ({ url: URL.createObjectURL(file), width: 480, height: 120 })

function Editor({ start, disabled = false, fail = false }: { start: BrandEditorBrand; disabled?: boolean; fail?: boolean }) {
  const [brand, setBrand] = useState(start)
  return (
    <Panel className="max-w-4xl">
      <PanelHeader>
        <PanelTitle>Branding</PanelTitle>
        <PanelDescription>
          {disabled ? "Branding is not part of this plan." : "Your name and logo instead of the platform's."}
        </PanelDescription>
      </PanelHeader>
      <PanelContent>
        <BrandEditor
          brand={brand}
          limits={limits}
          platformName="IoT OS"
          disabled={disabled}
          onSave={async (values) => {
            if (fail) throw new Error("conflict")
            return { ...brand, ...values, in_effect: values.product_name !== null, revision: brand.revision + 1 }
          }}
          onImage={async (role, file) => ({ ...brand, [role]: image(file), revision: brand.revision + 1 })}
          onRemoveImage={async (role) => ({ ...brand, [role]: null, revision: brand.revision + 1 })}
          onChange={setBrand}
          onReload={() => setBrand({ ...start })}
          describeError={() => ({ message: "The brand was changed since you opened it.", conflict: true })}
        />
      </PanelContent>
    </Panel>
  )
}

/** A new brand: nothing shows until it has a product name. Picking an image saves it at once. */
export const Empty: StoryObj = { render: () => <Editor start={empty} /> }

/** A saved brand. Change a name to see Save and Discard. */
export const Saved: StoryObj = {
  render: () => <Editor start={{ ...empty, product_name: "Acme Monitor", short_name: "Acme", support_url: "https://support.example.com", in_effect: true, revision: 3 }} />,
}

/** Someone else saved first: Save answers with a conflict and offers to reload. */
export const Conflict: StoryObj = { render: () => <Editor start={{ ...empty, product_name: "Acme Monitor", revision: 3 }} fail /> }

/** Branding is not part of the plan: everything is read-only. */
export const NotInPlan: StoryObj = { render: () => <Editor start={empty} disabled /> }
