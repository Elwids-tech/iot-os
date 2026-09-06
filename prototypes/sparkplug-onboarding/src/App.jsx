import { useState } from "react";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Check,
  CircleHelp,
  CloudCog,
  Gauge,
  Home,
  Lightbulb,
  ListTree,
  Palette,
  RadioTower,
  RefreshCw,
  Settings,
  ShieldCheck,
  Users,
  Wifi,
  Zap,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const steps = ["Discover", "Map parameters", "Verify", "Activate"];
const candidates = [
  { name: "Temperature Sensor 02", node: "env-sensor-01", metrics: 6, icon: Activity },
  { name: "RGB LED 01", node: "led-controller-01", metrics: 4, icon: Palette },
  { name: "Pump 01", node: "pump-controller-01", metrics: 8, icon: Gauge },
];
const colors = ["#00ff00", "#00a8ff", "#a855f7", "#f97316"];

function OnlineBadge() {
  return <Badge className="gap-1.5" variant="secondary"><span className="size-1.5 rounded-full bg-emerald-500" />Online</Badge>;
}

function Stepper({ activeStep }) {
  return <ol aria-label="Onboarding progress" className="grid grid-cols-4 gap-2">
    {steps.map((label, index) => {
      const complete = index < activeStep;
      const current = index === activeStep;
      return <li className="flex min-w-0 items-center gap-2" key={label}>
        <span className={`grid size-7 shrink-0 place-items-center rounded-full border text-xs font-medium ${complete || current ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground"}`}>
          {complete ? <Check /> : index + 1}
        </span>
        <span className="hidden min-w-0 md:grid">
          <strong className="truncate text-sm font-medium">{label}</strong>
          <small className="truncate text-xs text-muted-foreground">{complete ? "Complete" : current ? "In progress" : "Pending"}</small>
        </span>
      </li>;
    })}
  </ol>;
}

function Shell({ children, activeStep, onBack, onNext, nextLabel, nextDisabled }) {
  const nav = [[Home, "Overview"], [RadioTower, "Devices"], [Users, "Groups"], [Activity, "Data"], [ListTree, "Events"], [Settings, "Settings"]];
  return <div className="min-h-screen bg-muted/40 text-foreground">
    <aside className="fixed inset-y-0 left-0 hidden w-60 border-r bg-background md:flex md:flex-col">
      <div className="flex items-center gap-2 px-4 py-5"><span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground"><RadioTower /></span><div><p className="text-sm font-semibold">Sparkplug Portal</p><p className="text-xs text-muted-foreground">ACME Industries</p></div></div>
      <Separator />
      <nav className="grid gap-1 p-2" aria-label="Tenant navigation">{nav.map(([Icon, label]) => <Button className="justify-start" key={label} variant={label === "Devices" ? "secondary" : "ghost"}><Icon data-icon="inline-start" />{label}</Button>)}</nav>
      <div className="mt-auto p-2"><Separator className="mb-2" /><Button className="w-full justify-start" variant="ghost"><CircleHelp data-icon="inline-start" />Help</Button><div className="mt-3 flex items-center gap-2 px-2"><span className="grid size-8 place-items-center rounded-full bg-muted text-xs font-medium">AD</span><div><p className="text-sm font-medium">Alex Davis</p><p className="text-xs text-muted-foreground">Tenant admin</p></div></div></div>
    </aside>
    <main className="md:pl-60"><header className="flex h-14 items-center justify-between border-b bg-background px-5"><Breadcrumb><BreadcrumbList><BreadcrumbItem>Devices</BreadcrumbItem><BreadcrumbSeparator /><BreadcrumbItem><BreadcrumbPage>Add Sparkplug device</BreadcrumbPage></BreadcrumbItem></BreadcrumbList></Breadcrumb><Badge className="hidden gap-1.5 sm:inline-flex" variant="outline"><Wifi />Factory NanoMQ connected</Badge></header>
      <div className="mx-auto max-w-6xl px-5 py-8 pb-28"><Stepper activeStep={activeStep} />{children}</div>
      <footer className="fixed inset-x-0 bottom-0 border-t bg-background/95 px-5 py-4 backdrop-blur md:left-60"><div className="mx-auto flex max-w-6xl justify-between"><Button disabled={activeStep === 0} onClick={onBack} variant="outline"><ArrowLeft data-icon="inline-start" />Back</Button><Button disabled={nextDisabled} onClick={onNext}>{nextLabel}<ArrowRight data-icon="inline-end" /></Button></div></footer>
    </main>
  </div>;
}

function PageHeading({ eyebrow, title, description }) {
  return <div className="mb-6"><p className="mb-2 text-sm text-muted-foreground">{eyebrow}</p><h1 className="text-2xl font-semibold tracking-tight">{title}</h1><p className="mt-2 text-sm text-muted-foreground">{description}</p></div>;
}

function Discover({ selected, onSelect }) {
  return <><PageHeading eyebrow="Sparkplug B onboarding" title="Find a device" description="Choose a device that has announced itself on an approved connection." />
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3"><div><p className="mb-2 text-sm font-medium">Secure connection</p><Button variant="outline"><CloudCog data-icon="inline-start" />Factory NanoMQ</Button></div><div className="flex items-center gap-2 text-sm"><OnlineBadge /><span className="text-muted-foreground">TLS connection verified</span></div></div>
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(260px,.75fr)]"><Card><CardHeader className="border-b"><CardTitle>Discovered devices</CardTitle><CardDescription>3 online</CardDescription><Button className="col-start-2 row-span-2 row-start-1" size="sm" variant="ghost"><RefreshCw data-icon="inline-start" />Rescan</Button></CardHeader><CardContent className="px-0"><Table><TableHeader><TableRow><TableHead>Device</TableHead><TableHead className="hidden sm:table-cell">Edge node</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Metrics</TableHead></TableRow></TableHeader><TableBody>{candidates.map((candidate) => { const Icon = candidate.icon; const chosen = candidate.name === selected; return <TableRow className={chosen ? "bg-muted/70" : ""} key={candidate.name}><TableCell><Button className="h-auto w-full justify-start px-0 py-1 text-left hover:bg-transparent" onClick={() => onSelect(candidate.name)} variant="ghost"><span className="grid size-8 place-items-center rounded-md bg-muted"><Icon /></span><span><span className="block font-medium">{candidate.name}</span><span className="text-xs text-muted-foreground">Sparkplug device</span></span></Button></TableCell><TableCell className="hidden text-muted-foreground sm:table-cell">{candidate.node}</TableCell><TableCell><OnlineBadge /></TableCell><TableCell className="text-right">{candidate.metrics}</TableCell></TableRow>; })}</TableBody></Table></CardContent></Card>
      <Card><CardHeader><div className="flex items-center justify-between"><OnlineBadge /><ShieldCheck className="text-muted-foreground" /></div><CardTitle>{selected}</CardTitle><CardDescription>Source identity from Sparkplug B</CardDescription></CardHeader><CardContent className="grid gap-3 text-sm"><div className="flex justify-between"><span className="text-muted-foreground">Group ID</span><span>customer-devices</span></div><div className="flex justify-between"><span className="text-muted-foreground">Edge node</span><span>led-controller-01</span></div><div className="flex justify-between"><span className="text-muted-foreground">Device ID</span><span>rgb-led-01</span></div><Separator /><p className="font-medium">Discovered metrics</p><div className="flex flex-wrap gap-1"><Badge variant="secondary">power · Boolean</Badge><Badge variant="secondary">color · String</Badge><Badge variant="secondary">mode · String</Badge><Badge variant="secondary">brightness · Int32</Badge></div></CardContent></Card></div>
  </>;
}

function SelectField({ value, onValueChange, children, label }) {
  return <Select onValueChange={onValueChange} value={value}><SelectTrigger aria-label={label} className="w-full"><SelectValue /></SelectTrigger><SelectContent>{children}</SelectContent></Select>;
}

function MapParameters({ definition, setDefinition }) {
  const update = (key, value) => setDefinition((current) => ({ ...current, [key]: value }));
  const updateWrite = (key, value) => setDefinition((current) => ({ ...current, write: { ...current.write, [key]: value } }));
  const rows = [["power", "Boolean", "Power", true], ["color", "String", "Colour", true], ["mode", "String", "Mode", true], ["brightness", "Int32", "Brightness", true]];
  return <><PageHeading eyebrow="RGB LED 01 · Factory NanoMQ" title="Map RGB LED 01" description="Define how this device’s Sparkplug metrics appear and behave in the portal." />
    <Card><CardHeader><CardTitle>Parameter mapping</CardTitle><CardDescription>Protocol details on the left; tenant-facing controls on the right.</CardDescription></CardHeader><CardContent className="px-0"><Table><TableHeader><TableRow><TableHead>Sparkplug source</TableHead><TableHead>Platform parameter</TableHead><TableHead className="text-center">Read</TableHead><TableHead className="text-center">Write</TableHead></TableRow></TableHeader><TableBody>{rows.map(([source, type, label]) => <TableRow key={source}><TableCell><div className="flex items-center gap-2"><span className="grid size-8 place-items-center rounded-md bg-muted"><Zap /></span><span><span className="block font-medium">{source}</span><span className="text-xs text-muted-foreground">{type}</span></span></div></TableCell><TableCell><div className="grid gap-2"><span className="font-medium">{label}</span>{source === "power" && <Switch aria-label="Power value" checked={definition.power} onCheckedChange={(value) => update("power", value)} />}{source === "color" && <div className="flex flex-wrap gap-1">{colors.map((color) => <Button aria-label={`Set colour to ${color}`} className={`size-7 p-0 ${definition.color === color ? "ring-2 ring-ring ring-offset-2" : ""}`} key={color} onClick={() => update("color", color)} style={{ backgroundColor: color }} variant="outline" />)}</div>}{source === "mode" && <SelectField label="Mode" onValueChange={(value) => update("mode", value)} value={definition.mode}><SelectItem value="blink">Blink</SelectItem><SelectItem value="strobe">Strobe</SelectItem><SelectItem value="rainbow">Rainbow</SelectItem></SelectField>}{source === "brightness" && <div className="flex items-center gap-3"><Slider aria-label="Brightness" max={10} min={1} onValueChange={([value]) => update("brightness", value)} value={[definition.brightness]} /><Badge variant="secondary">{definition.brightness}/10</Badge></div>}</div></TableCell><TableCell className="text-center"><Switch aria-label={`${label} read access`} checked /></TableCell><TableCell className="text-center"><Switch aria-label={`${label} write access`} checked={definition.write[source]} onCheckedChange={(value) => updateWrite(source, value)} /></TableCell></TableRow>)}</TableBody></Table></CardContent></Card>
    <Alert className="mt-5"><ShieldCheck /><AlertTitle>Mapping complete</AlertTitle><AlertDescription>All four source metrics are mapped. Business validation rules will be reviewed before activation.</AlertDescription></Alert>
  </>;
}

function Verify({ definition }) {
  const checks = ["Sparkplug birth message is valid", "All four source metrics have compatible types", `Mode '${definition.mode}' is allowed`, `Brightness ${definition.brightness} is within the 1–10 range`, "Command confirmation rules are configured"];
  return <><PageHeading eyebrow="RGB LED 01 · Definition check" title="Verify definition" description="Review the current device data against the rules you approved." /><div className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(260px,.75fr)]"><Card><CardHeader><ShieldCheck className="text-emerald-600" /><CardTitle>Ready to activate</CardTitle><CardDescription>The device is online and the definition is valid.</CardDescription></CardHeader><CardContent className="grid gap-3">{checks.map((check) => <div className="flex items-center gap-2 text-sm" key={check}><Check className="text-emerald-600" />{check}</div>)}</CardContent></Card><Card><CardHeader><div className="flex items-center justify-between"><OnlineBadge /><Lightbulb className="text-muted-foreground" /></div><CardTitle>RGB LED 01</CardTitle><CardDescription>Live values reported by the device</CardDescription></CardHeader><CardContent className="grid gap-3 text-sm"><div className="flex justify-between"><span className="text-muted-foreground">Power</span><span>{definition.power ? "ON" : "OFF"}</span></div><div className="flex justify-between"><span className="text-muted-foreground">Colour</span><span className="flex items-center gap-2"><span className="size-3 rounded-full" style={{ backgroundColor: definition.color }} />{definition.color.toUpperCase()}</span></div><div className="flex justify-between"><span className="text-muted-foreground">Mode</span><span className="capitalize">{definition.mode}</span></div><div className="flex justify-between"><span className="text-muted-foreground">Brightness</span><span>{definition.brightness}/10</span></div></CardContent></Card></div></>;
}

function Activate({ definition, entityPlacement, setEntityPlacement, activated, setActivated }) {
  return <>
    <PageHeading eyebrow="RGB LED 01 · Final review" title={activated ? "RGB LED 01 is active" : "Activate device"} description={activated ? "The tenant can now see live state and send approved controls." : "Confirm the detected entity placement, then make this device available to authorized users."} />
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(260px,.75fr)]">
      <Card>
        <CardHeader><div className="flex items-center gap-3"><span className="size-10 rounded-full border-4 border-muted" style={{ backgroundColor: definition.color }} /><div><OnlineBadge /><CardTitle className="mt-2">RGB LED 01</CardTitle><CardDescription>led-controller-01 · rgb-led-01</CardDescription></div></div></CardHeader>
        <CardContent className="grid gap-6">
          <div className="grid gap-3">
            <div><h2 className="text-sm font-medium">Entity placement</h2><p className="mt-1 text-sm text-muted-foreground">Tenant ownership is inferred from the current tenant. Group ID <code className="rounded bg-muted px-1.5 py-0.5 text-xs">customer-devices</code> suggested this placement.</p></div>
            <SelectField label="Entity hierarchy" onValueChange={setEntityPlacement} value={entityPlacement}>
              <SelectItem value="factory-1-building-1-room-203">Factory 1 / Building 1 / Room 203</SelectItem>
              <SelectItem value="factory-1-building-1-room-204">Factory 1 / Building 1 / Room 204</SelectItem>
              <SelectItem value="factory-1-building-2">Factory 1 / Building 2</SelectItem>
            </SelectField>
          </div>
          <Separator />
          <div className="grid gap-2"><h2 className="text-sm font-medium">Definition review</h2><div className="flex flex-wrap gap-2"><Badge variant="secondary">Power · Toggle</Badge><Badge variant="secondary">Colour · Preset palette</Badge><Badge variant="secondary">Mode · Select</Badge><Badge variant="secondary">Brightness · Slider</Badge></div></div>
          <Alert><ShieldCheck /><AlertTitle>Source identity is read-only</AlertTitle><AlertDescription>Group ID, edge node, and device ID are technical identifiers. Platform ownership and entity placement are managed separately.</AlertDescription></Alert>
        </CardContent>
      </Card>
      <Card><CardHeader><CardTitle>Event timeline</CardTitle><CardDescription>Activation readiness</CardDescription></CardHeader><CardContent className="grid gap-4 text-sm"><div><p className="font-medium">Birth received</p><p className="text-muted-foreground">Sparkplug B device announced</p></div><Separator /><div><p className="font-medium">Definition verified</p><p className="text-muted-foreground">Parameters mapped and valid</p></div><Separator /><div><p className="font-medium">{activated ? "Device activated" : "Ready to activate"}</p><p className="text-muted-foreground">{activated ? "Live ingestion is enabled" : "Awaiting tenant approval"}</p></div><Button onClick={() => setActivated(true)} disabled={activated} className="mt-2">{activated ? <Check data-icon="inline-start" /> : null}{activated ? "Device active" : "Activate device"}</Button></CardContent></Card>
    </div>
  </>;
}

export function App() {
  const [activeStep, setActiveStep] = useState(0);
  const [selected, setSelected] = useState("RGB LED 01");
  const [activated, setActivated] = useState(false);
  const [entityPlacement, setEntityPlacement] = useState("factory-1-building-1-room-203");
  const [definition, setDefinition] = useState({ power: true, color: "#00ff00", mode: "blink", brightness: 7, write: { power: true, color: true, mode: true, brightness: true } });
  const nextLabel = activeStep === 0 ? "Map parameters" : activeStep === 1 ? "Verify definition" : activeStep === 2 ? "Review activation" : "Activate device";
  const next = () => { if (activeStep < 3) setActiveStep((step) => step + 1); else setActivated(true); };
  return <Shell activeStep={activeStep} nextDisabled={activeStep === 3 && activated} nextLabel={nextLabel} onBack={() => setActiveStep((step) => Math.max(0, step - 1))} onNext={next}>{activeStep === 0 && <Discover onSelect={setSelected} selected={selected} />}{activeStep === 1 && <MapParameters definition={definition} setDefinition={setDefinition} />}{activeStep === 2 && <Verify definition={definition} />}{activeStep === 3 && <Activate activated={activated} definition={definition} entityPlacement={entityPlacement} setActivated={setActivated} setEntityPlacement={setEntityPlacement} />}</Shell>;
}
