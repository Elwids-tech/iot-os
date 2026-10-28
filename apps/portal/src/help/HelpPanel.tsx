import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { usePanel, type PanelTab } from "../panel/context";
import { AssistantHome } from "../assistant/AssistantHome";
import { assistantSuggestions, type Suggestion } from "../assistant/suggestions";
import type {
  DeviceDetail,
  HelpArticle,
  HelpArticleSummary,
  HelpDetail,
} from "@iot-os/api-client";
import { Button } from "@iot-os/ui/components/button";
import { Badge } from "@iot-os/ui/components/badge";
import {
  Alert,
  AlertTitle,
  AlertDescription,
} from "@iot-os/ui/components/alert";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@iot-os/ui/components/tabs";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@iot-os/ui/components/sheet";
import { keepToastsLeftOf } from "@iot-os/ui/components/sonner";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@iot-os/ui/components/card";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from "@iot-os/ui/components/empty";
import { Skeleton } from "@iot-os/ui/components/skeleton";
import { Field, FieldLabel } from "@iot-os/ui/components/field";
import { Input } from "@iot-os/ui/components/input";
import {
  InputGroup,
  InputGroupTextarea,
  InputGroupAddon,
} from "@iot-os/ui/components/input-group";
import { SearchableSelect } from "@iot-os/ui/components/searchable-select";
import {
  Message,
  MessageContent,
  MessageHeader,
} from "@iot-os/ui/components/message";
import { Bubble, BubbleContent } from "@iot-os/ui/components/bubble";
import { Marker, MarkerContent } from "@iot-os/ui/components/marker";
import { Markdown } from "@iot-os/ui/components/markdown";
import { Thinking } from "@iot-os/ui/components/thinking";
import {
  MessageScrollerProvider,
  MessageScroller,
  MessageScrollerViewport,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerButton,
} from "@iot-os/ui/components/message-scroller";
import {
  ArrowLeftIcon,
  BookOpenIcon,
  SendIcon,
  SparklesIcon,
  SquareIcon,
  PlusIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { api } from "../lib/api";
import { newTicketPath, supportPath } from "../support/model";
import { Confirm, RequestError } from "../components/forms";


type ArticleTarget = { slug: string; heading?: string };
const activeRun = (detail?: HelpDetail) =>
  detail?.runs.find(
    (run) => run.status === "queued" || run.status === "running",
  );

function ArticleReader({
  article,
  heading,
  onOpen,
}: {
  article: HelpArticle;
  heading?: string;
  onOpen: (target: ArticleTarget) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!heading) {
      root.current?.scrollTo({ top: 0 });
      return;
    }
    const section = root.current?.querySelector(
      `[data-heading="${CSS.escape(heading)}"]`,
    );
    section?.scrollIntoView({ block: "start" });
  }, [article.slug, heading]);
  return (
    <div
      ref={root}
      className="min-h-0 flex-1 overflow-y-auto p-4"
      onClick={(event) => {
        const link = (event.target as HTMLElement).closest("a");
        if (!link) return;
        event.preventDefault();
        const match = /^\/help\/([a-z][a-z0-9-]*)(?:#([a-z0-9-]+))?$/.exec(
          link.getAttribute("href") ?? "",
        );
        if (match) onOpen({ slug: match[1], heading: match[2] });
      }}
    >
      <div className="mb-5 flex flex-col gap-2">
        <Badge variant="secondary">{article.section}</Badge>
        <h3 className="text-lg font-semibold">{article.title}</h3>
        <span className="text-xs text-muted-foreground">
          Guide revision {article.revision}
        </span>
      </div>
      <div className="flex flex-col gap-5">
        {article.chunks.map((chunk) => (
          <section
            key={chunk.id}
            data-heading={chunk.id}
            className="scroll-mt-4"
          >
            <h4 className="mb-2 font-medium">{chunk.title}</h4>
            {/* API renders only reviewed Markdown with raw HTML and unsafe links disabled. */}
            <div
              className="text-sm leading-relaxed [&_p]:mb-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5 [&_li]:mb-2 [&_a]:text-primary [&_a]:underline [&_code]:font-mono"
              dangerouslySetInnerHTML={{ __html: chunk.html }}
            />
          </section>
        ))}
      </div>
    </div>
  );
}

function GuideList({
  articles,
  onOpen,
}: {
  articles: HelpArticleSummary[];
  onOpen: (target: ArticleTarget) => void;
}) {
  const groups = new Map<string, HelpArticleSummary[]>();
  for (const article of articles)
    groups.set(article.section, [
      ...(groups.get(article.section) ?? []),
      article,
    ]);
  return (
    <div className="flex flex-col gap-5">
      {[...groups].map(([section, guides]) => (
        <section key={section}>
          <h3 className="mb-2 text-sm font-medium">{section}</h3>
          <div className="flex flex-col gap-2">
            {guides.map((article) => (
              <Button
                key={article.slug}
                variant="outline"
                className="h-auto w-full justify-start whitespace-normal py-3 text-left"
                onClick={() => onOpen({ slug: article.slug })}
              >
                <BookOpenIcon data-icon="inline-start" />
                <span className="min-w-0">
                  <span className="block">{article.title}</span>
                  <span className="mt-1 block text-xs font-normal text-muted-foreground">
                    {article.summary}
                  </span>
                </span>
              </Button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/**
 * The workspace panel: one docked rail (a sheet below xl) with an Ask tab for
 * the assistant and two tabs of guides. Ask follows the page: pages that own an
 * assistant portal it in through the panel slot, profile pages open the profile
 * assistant, Add device and device adapter pages open the onboarding assistant,
 * and every other page opens on suggestions for the work the assistant can do
 * there. The profile and onboarding assistants and usage help are one choice
 * away from any page; an automation suggestion opens a new automation's editor.
 */
export default function HelpPanel({
  org,
  organizationName,
  context,
  profileAssistant,
  profilePage,
  onboardingAssistant,
  onboardingPage,
  viewedProfile,
  can,
}: {
  org: string;
  organizationName: string;
  context: string;
  /** The device-profile authoring body; shown when Ask is on the profile assistant. */
  profileAssistant: ReactNode;
  /** Profile pages open Ask on the profile assistant. */
  profilePage: boolean;
  /** The device onboarding conversation; shown when Ask is on onboarding. */
  onboardingAssistant: ReactNode;
  /** Add device and device adapter pages open Ask on the onboarding assistant. */
  onboardingPage: boolean;
  viewedProfile?: string;
  can: { profiles: boolean; adapters: boolean };
}) {
  const cache = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const workspace = usePanel();
  const { open, tab, setTab, slot, setSlotTarget, askMode, setAskMode, handoff, startTask, takeHandoff } = workspace;
  const onClose = workspace.closePanel;
  // What Ask shows: "auto" follows the page; an automation suggestion waits for its editor to open.
  const ask =
    askMode === "auto"
      ? slot
        ? "context"
        : handoff?.to === "automation"
          ? "opening"
          : profilePage
            ? "profile"
            : onboardingPage
              ? "onboarding"
              : "home"
      : askMode === "context" && !slot
        ? "home"
        : askMode;
  const askHelp = tab === "ask" && ask === "help";
  const [article, setArticle] = useState<ArticleTarget | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [conversationSearch, setConversationSearch] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  // The question being sent, shown at once until its run appears in the conversation.
  const [sending, setSending] = useState<{ prompt: string; runs: number } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [mobile, setMobile] = useState(
    () => !window.matchMedia("(min-width: 1280px)").matches,
  );
  const panel = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const pending = useRef<{ id: string; text: string; context: string } | null>(
    null,
  );
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const draftKey = selected ?? "new";
  const draft = drafts[draftKey] ?? "";

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1280px)");
    const change = () => setMobile(!media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  // Docked beside the page, toasts stack to the panel's left.
  useEffect(() => keepToastsLeftOf(panel.current), [mobile]);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 250);
    return () => window.clearTimeout(timer);
  }, [search]);
  // A question chosen from the suggestions starts a new Help conversation with it ready to send.
  useEffect(() => {
    if (handoff?.to !== "help") return;
    takeHandoff();
    setSelected(null);
    pending.current = null;
    setError(null);
    setArticle(null);
    const text = handoff.text;
    setDrafts((current) => ({ ...current, new: text }));
  }, [handoff, takeHandoff]);
  useEffect(() => {
    if (!open) return;
    trigger.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    if (!mobile) panel.current?.focus();
    const escape = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        !event.defaultPrevented &&
        !mobile &&
        !(event.target as HTMLElement)?.closest('[role="dialog"]')
      ) {
        onCloseRef.current();
      }
    };
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("keydown", escape);
      trigger.current?.focus();
    };
  }, [open, mobile]);

  const page = useQuery({
    queryKey: ["help", org, "page", context],
    queryFn: () => api.helpPage(org, context),
    enabled: open,
    staleTime: 60000,
  });
  const settings = useQuery({
    queryKey: ["help", org, "settings"],
    queryFn: () => api.helpSettings(org),
    enabled: open,
  });
  const articles = useQuery({
    queryKey: ["help", org, "articles", debouncedSearch],
    queryFn: () => api.helpArticles(org, debouncedSearch),
    enabled: open && tab === "guides",
    staleTime: 60000,
  });
  const overview = useQuery({
    queryKey: ["help", org, "article", page.data?.overview],
    queryFn: () => api.helpArticle(org, page.data!.overview),
    enabled: open && tab === "page" && !article && Boolean(page.data),
    staleTime: 60000,
  });
  const articleQuery = useQuery({
    queryKey: ["help", org, "article", article?.slug],
    queryFn: () => api.helpArticle(org, article!.slug),
    enabled: open && Boolean(article),
    staleTime: 60000,
  });
  const conversations = useQuery({
    queryKey: ["help", org, "conversations"],
    queryFn: () => api.helpConversations(org),
    enabled: open && askHelp,
  });
  const detail = useQuery({
    queryKey: ["help", org, "conversation", selected],
    queryFn: () => api.helpConversation(org, selected!),
    enabled: open && Boolean(selected),
    refetchInterval: (query) => (activeRun(query.state.data) ? 1000 : false),
  });
  // On a device's page, the device the page already loaded names the profile to improve.
  const [, , , section, resource] = location.pathname.split("/");
  const device = useQuery<DeviceDetail>({
    queryKey: ["device", org, resource],
    queryFn: skipToken,
    enabled: section === "devices" && Boolean(resource),
  });
  const active = activeRun(detail.data);
  const available = settings.data?.enabled === true;
  const openArticle = (target: ArticleTarget) => {
    setArticle(target);
    setError(null);
  };
  async function refresh() {
    await Promise.all([
      cache.invalidateQueries({
        queryKey: ["help", org, "conversation", selected],
      }),
      cache.invalidateQueries({ queryKey: ["help", org, "conversations"] }),
    ]);
  }
  async function send() {
    const text = draft.trim();
    if (!text || busy || active || !available || !page.data) return;
    setBusy(true);
    setError(null);
    setSending({ prompt: text, runs: detail.data?.runs.length ?? 0 });
    setDrafts((current) => ({ ...current, [draftKey]: "" }));
    let id = selected;
    try {
      if (!id) {
        const conversation = await api.createHelpConversation(org);
        id = conversation.id;
        setSelected(id);
      }
      const retry = pending.current;
      const request =
        retry && retry.text === text && retry.context === context
          ? retry
          : { id: crypto.randomUUID(), text, context };
      pending.current = request;
      await api.helpMessage(org, id, {
        request_id: request.id,
        text,
        page_context: request.context,
      });
      pending.current = null;
      setDrafts((current) => ({ ...current, [id!]: "" }));
      await Promise.all([
        cache.invalidateQueries({
          queryKey: ["help", org, "conversation", id],
        }),
        cache.invalidateQueries({ queryKey: ["help", org, "conversations"] }),
      ]);
    } catch (reason) {
      setError(reason);
      // Give the unsent question back so it can be retried or edited.
      setDrafts((current) => ({ ...current, [id ?? "new"]: current[id ?? "new"] || text }));
    } finally {
      setBusy(false);
      setSending(null);
    }
  }
  async function cancel() {
    if (!selected || !active) return;
    setBusy(true);
    setError(null);
    try {
      await api.assistantCancel(org, selected, active.id);
      await refresh();
    } catch (reason) {
      setError(reason);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!selected) return;
    await api.deleteAssistantConversation(org, selected);
    const removed = selected;
    setSelected(null);
    setDrafts((current) => {
      const next = { ...current };
      delete next[removed];
      return next;
    });
    cache.removeQueries({ queryKey: ["help", org, "conversation", removed] });
    await cache.invalidateQueries({ queryKey: ["help", org, "conversations"] });
  }

  const suggestions = assistantSuggestions({
    pathname: location.pathname,
    slot: slot?.title,
    profile: viewedProfile,
    deviceProfile: device.data?.profile,
    can,
  });
  function choose(suggestion: Suggestion) {
    const action = suggestion.action;
    setArticle(null);
    switch (action.kind) {
      case "context":
        setAskMode("context");
        return;
      case "profile":
        startTask("profile", { to: "profile", profile: action.profile });
        return;
      case "help":
        setAskMode("help");
        return;
      case "onboarding":
        startTask("onboarding", { to: "onboarding", fresh: action.fresh });
        return;
      case "automation": {
        // The automation assistant edits an editor's draft, so a new automation opens for it.
        const id = crypto.randomUUID();
        startTask("auto", { to: "automation", text: action.text, id });
        navigate(`/organizations/${encodeURIComponent(org)}/automation/new`, { state: { assistant: id } });
        return;
      }
    }
  }
  const taskLabel =
    ask === "context"
      ? slot?.title
      : ask === "profile"
        ? "Device profiles"
        : ask === "onboarding"
          ? "Device onboarding"
          : ask === "opening"
          ? "New automation"
          : "Usage help";

  const content = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-start justify-between gap-2 border-b p-4">
        <div className="min-w-0">
          <h2 id="help-title" className="flex items-center gap-2 font-semibold">
            <SparklesIcon className="size-4" />
            Assistant
          </h2>
          <p id="help-description" className="truncate text-xs text-muted-foreground">
            {tab !== "ask" || ask === "help"
              ? `Guides and usage questions · ${organizationName}`
              : ask === "context" && slot
                ? (slot.description ?? `Working on ${slot.title}`)
                : ask === "profile"
                  ? `Device profiles · ${organizationName}`
                  : ask === "onboarding"
                    ? `Device onboarding · ${organizationName}`
                    : `Suggestions for this page · ${organizationName}`}
          </p>
        </div>
        <Button
          size="icon"
          variant="ghost"
          aria-label="Close assistant"
          onClick={onClose}
        >
          <XIcon />
        </Button>
      </div>
      <Tabs
        value={tab}
        onValueChange={(value) => {
          setTab(value as PanelTab);
          setArticle(null);
          setError(null);
        }}
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        <div className="border-b p-3">
          <TabsList className="w-full" aria-label="Assistant views">
            <TabsTrigger value="ask">Ask</TabsTrigger>
            <TabsTrigger value="page">This page</TabsTrigger>
            <TabsTrigger value="guides">All guides</TabsTrigger>
          </TabsList>
        </div>
        {tab === "ask" && ask !== "home" && !article && (
          <div className="flex items-center gap-2 border-b px-3 py-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                takeHandoff();
                setAskMode("home");
              }}
            >
              <ArrowLeftIcon data-icon="inline-start" />
              Suggestions
            </Button>
            <span className="min-w-0 truncate text-meta text-muted-foreground">{taskLabel}</span>
          </div>
        )}
        {/* Always mounted: the page that owns the context assistant portals its body here. */}
        <div
          ref={setSlotTarget}
          data-slot="panel-slot"
          className={
            tab === "ask" && ask === "context" && !article
              ? "flex min-h-0 flex-1 flex-col"
              : "hidden"
          }
        />
        {tab === "ask" && ask === "profile" && !article && (
          <div className="flex min-h-0 flex-1 flex-col">
            <Suspense fallback={<Skeleton className="m-4 h-40" />}>{profileAssistant}</Suspense>
          </div>
        )}
        {tab === "ask" && ask === "onboarding" && !article && (
          <div className="flex min-h-0 flex-1 flex-col">
            <Suspense fallback={<Skeleton className="m-4 h-40" />}>{onboardingAssistant}</Suspense>
          </div>
        )}
        {tab === "ask" && ask === "home" && !article && (
          <AssistantHome
            page={page.data?.title}
            here={suggestions.here}
            more={suggestions.more}
            questions={page.data?.articles[0]?.questions ?? []}
            onChoose={choose}
            onQuestion={(question) => startTask("help", { to: "help", text: question })}
          />
        )}
        {tab === "ask" && ask === "opening" && !article && (
          <div className="p-4">
            <Thinking>Opening a new automation…</Thinking>
          </div>
        )}
        <TabsContent
          value={tab}
          className={
            tab === "ask" && ask !== "help" && !article
              ? "hidden"
              : "flex min-h-0 flex-1 flex-col"
          }
        >
          {Boolean(error) && (
            <div className="p-3">
              <RequestError error={error} />
            </div>
          )}
          {article ? (
            <>
              <div className="border-b p-3">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setArticle(null)}
                >
                  <ArrowLeftIcon data-icon="inline-start" />
                  Back to{" "}
                  {tab === "ask"
                    ? "Ask"
                    : tab === "guides"
                      ? "all guides"
                      : "this page"}
                </Button>
              </div>
              {articleQuery.isPending ? (
                <Skeleton className="m-4 h-40" />
              ) : articleQuery.error ? (
                <div className="p-4">
                  <RequestError error={articleQuery.error} />
                </div>
              ) : (
                articleQuery.data && (
                  <ArticleReader
                    article={articleQuery.data}
                    heading={article.heading}
                    onOpen={openArticle}
                  />
                )
              )}
            </>
          ) : tab === "page" ? (
            <div className="flex min-h-0 flex-1 flex-col">
              {page.isPending || (page.data && overview.isPending) ? (
                <Skeleton className="m-4 h-40" />
              ) : page.error || overview.error ? (
                <div className="p-4">
                  <RequestError error={page.error || overview.error} />
                </div>
              ) : (
                overview.data && (
                  <ArticleReader article={overview.data} onOpen={openArticle} />
                )
              )}
            </div>
          ) : tab === "guides" ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="p-4">
                <Field>
                  <FieldLabel htmlFor="help-search">Search guides</FieldLabel>
                  <Input
                    id="help-search"
                    placeholder="Try units, activation, or commands…"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </Field>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
                {articles.isPending ? (
                  <Skeleton className="h-40" />
                ) : articles.error ? (
                  <RequestError error={articles.error} />
                ) : articles.data?.length ? (
                  <GuideList articles={articles.data} onOpen={openArticle} />
                ) : (
                  <Empty>
                    <EmptyHeader>
                      <EmptyTitle>No matching guides</EmptyTitle>
                      <EmptyDescription>
                        Try a shorter phrase or a different feature name.
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                )}
              </div>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex items-end gap-2 border-b p-3">
                <div className="min-w-0 flex-1">
                  <SearchableSelect
                    label="Help conversation"
                    value={selected ?? ""}
                    selectedLabel={detail.data?.title}
                    search={conversationSearch}
                    onSearchChange={setConversationSearch}
                    options={(conversations.data ?? [])
                      .filter((item) =>
                        item.title
                          .toLowerCase()
                          .includes(conversationSearch.toLowerCase()),
                      )
                      .map((item) => ({ value: item.id, label: item.title }))}
                    onChange={(id) => {
                      setSelected(id);
                      pending.current = null;
                      setError(null);
                    }}
                    placeholder="Start a conversation"
                    disabled={busy}
                  />
                </div>
                <Button
                  size="icon"
                  variant="outline"
                  aria-label="New Help conversation"
                  disabled={busy}
                  onClick={() => {
                    setSelected(null);
                    pending.current = null;
                    setError(null);
                  }}
                >
                  <PlusIcon />
                </Button>
                {selected && (
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Delete Help conversation"
                    disabled={busy || Boolean(active)}
                    onClick={() => setDeleteOpen(true)}
                  >
                    <Trash2Icon />
                  </Button>
                )}
              </div>
              {(settings.error || conversations.error || detail.error) && (
                <div className="p-3">
                  <RequestError
                    error={
                      settings.error || conversations.error || detail.error
                    }
                  />
                </div>
              )}
              {settings.data && !available && (
                <div className="p-3">
                  <Alert>
                    <AlertTitle>Usage help unavailable</AlertTitle>
                    <AlertDescription>
                      You can still read and search the guides. AI answers are
                      unavailable on this server right now.
                    </AlertDescription>
                  </Alert>
                </div>
              )}
              <div className="min-h-0 flex-1">
                <MessageScrollerProvider key={selected ?? "new"} autoScroll>
                  <MessageScroller>
                    <MessageScrollerViewport>
                      <MessageScrollerContent className="p-4">
                        {!detail.data?.runs.length && !sending && (
                          <MessageScrollerItem messageId="welcome">
                            <Card>
                              <CardHeader>
                                <CardTitle>How can I use this page?</CardTitle>
                                <CardDescription>
                                  Ask a usage question. Answers cite approved
                                  guides and use your page context.
                                </CardDescription>
                              </CardHeader>
                              <CardContent className="flex flex-col gap-2">
                                {(
                                  page.data?.articles[0]?.questions ?? [
                                    "How do I get started?",
                                  ]
                                ).map((question) => (
                                  <Button
                                    key={question}
                                    variant="outline"
                                    className="h-auto justify-start whitespace-normal text-left"
                                    onClick={() =>
                                      setDrafts((current) => ({
                                        ...current,
                                        [draftKey]: question,
                                      }))
                                    }
                                  >
                                    {question}
                                  </Button>
                                ))}
                              </CardContent>
                            </Card>
                          </MessageScrollerItem>
                        )}
                        {detail.data?.runs.flatMap((run) => [
                          <MessageScrollerItem
                            key={`${run.id}-question`}
                            messageId={`${run.id}-question`}
                            scrollAnchor
                          >
                            <Message align="end">
                              <MessageContent>
                                <MessageHeader>
                                  You · {run.help_context?.title ?? "Help"}
                                </MessageHeader>
                                <Bubble align="end">
                                  <BubbleContent className="whitespace-pre-wrap">
                                    {run.prompt}
                                  </BubbleContent>
                                </Bubble>
                              </MessageContent>
                            </Message>
                          </MessageScrollerItem>,
                          <MessageScrollerItem
                            key={`${run.id}-answer`}
                            messageId={`${run.id}-answer`}
                          >
                            <Message>
                              <MessageContent>
                                <MessageHeader>Help</MessageHeader>
                                {run.status === "completed" && run.answer && (
                                  <Bubble variant="ghost">
                                    <BubbleContent>
                                      <Markdown>{run.answer}</Markdown>
                                    </BubbleContent>
                                  </Bubble>
                                )}
                                {run.help_answer?.citations.map((citation) => (
                                  <Button
                                    key={citation.citation_id}
                                    variant="link"
                                    className="h-auto justify-start whitespace-normal px-0 text-left"
                                    onClick={() =>
                                      openArticle({
                                        slug: citation.slug,
                                        heading: citation.heading,
                                      })
                                    }
                                  >
                                    {citation.title} · {citation.heading_title}
                                  </Button>
                                ))}
                                {(run.status === "running" ||
                                  run.status === "queued") && (
                                  <Thinking>
                                    {run.status === "queued"
                                      ? "Waiting for Help…"
                                      : "Reading the guides…"}
                                  </Thinking>
                                )}
                                {run.status === "cancelled" && (
                                  <Marker>
                                    <MarkerContent>
                                      Help response stopped.
                                    </MarkerContent>
                                  </Marker>
                                )}
                                {run.error_message && (
                                  <Alert>
                                    <AlertTitle>
                                      Response unavailable
                                    </AlertTitle>
                                    <AlertDescription>
                                      {run.error_message}
                                    </AlertDescription>
                                  </Alert>
                                )}
                              </MessageContent>
                            </Message>
                          </MessageScrollerItem>,
                        ])}
                        {selected && detail.isPending && !sending && (
                          <MessageScrollerItem messageId="loading">
                            <Skeleton className="h-24" />
                          </MessageScrollerItem>
                        )}
                        {sending &&
                          (detail.data?.runs.length ?? 0) === sending.runs && (
                            <MessageScrollerItem messageId="sending" scrollAnchor>
                              <div className="flex flex-col gap-4">
                                <Message align="end">
                                  <MessageContent>
                                    <MessageHeader>
                                      You · {page.data?.title ?? "Help"}
                                    </MessageHeader>
                                    <Bubble align="end">
                                      <BubbleContent className="whitespace-pre-wrap">
                                        {sending.prompt}
                                      </BubbleContent>
                                    </Bubble>
                                  </MessageContent>
                                </Message>
                                <Message>
                                  <MessageContent>
                                    <MessageHeader>Help</MessageHeader>
                                    <Thinking>Sending…</Thinking>
                                  </MessageContent>
                                </Message>
                              </div>
                            </MessageScrollerItem>
                          )}
                      </MessageScrollerContent>
                    </MessageScrollerViewport>
                    <MessageScrollerButton />
                  </MessageScroller>
                </MessageScrollerProvider>
              </div>
              <form
                className="border-t p-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void send();
                }}
              >
                <p className="mb-2 text-xs text-muted-foreground">
                  Question about: {page.data?.title ?? "this page"}
                </p>
                <Field>
                  <FieldLabel className="sr-only" htmlFor="help-question">
                    Ask a usage question
                  </FieldLabel>
                  <InputGroup>
                    <InputGroupTextarea
                      id="help-question"
                      placeholder="Ask how to use the system…"
                      maxLength={8000}
                      value={draft}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [draftKey]: event.target.value,
                        }))
                      }
                      disabled={busy}
                    />
                    <InputGroupAddon align="block-end" className="justify-end">
                      {active ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => void cancel()}
                        >
                          <SquareIcon data-icon="inline-start" />
                          Stop
                        </Button>
                      ) : (
                        <Button
                          type="submit"
                          size="sm"
                          disabled={
                            busy || !available || !page.data || !draft.trim()
                          }
                        >
                          <SendIcon data-icon="inline-start" />
                          Ask
                        </Button>
                      )}
                    </InputGroupAddon>
                  </InputGroup>
                </Field>
                <p className="mt-2 text-xs text-muted-foreground">
                  Uses approved guides. Your device data and unsaved edits are
                  not included.
                </p>
              </form>
            </div>
          )}
        </TabsContent>
      </Tabs>
      <nav
        aria-label="Support"
        className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t px-4 py-3 text-meta"
      >
        <span className="text-muted-foreground">Something wrong or missing?</span>
        <Link className="text-primary hover:underline" to={newTicketPath(org, "bug", location.pathname)} onClick={onClose}>
          Report a problem
        </Link>
        <Link className="text-primary hover:underline" to={newTicketPath(org, "improvement", location.pathname)} onClick={onClose}>
          Suggest an improvement
        </Link>
        <Link className="text-primary hover:underline" to={supportPath(org)} onClick={onClose}>
          Your tickets
        </Link>
      </nav>
      <Confirm
        open={deleteOpen}
        title="Delete this Help conversation?"
        description="Its questions and answers will be permanently removed."
        action="Delete conversation"
        onClose={() => setDeleteOpen(false)}
        onConfirm={remove}
      />
    </div>
  );

  if (mobile)
    return (
      <Sheet open={open} onOpenChange={(value) => !value && onClose()}>
        <SheetContent
          showCloseButton={false}
          className="w-full! max-w-none! gap-0 p-0 sm:w-[440px]!"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            trigger.current?.focus();
          }}
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Assistant</SheetTitle>
            <SheetDescription>
              Guides and usage questions for {organizationName}
            </SheetDescription>
          </SheetHeader>
          {content}
        </SheetContent>
      </Sheet>
    );
  return (
    <aside
      ref={panel}
      inert={!open}
      data-state={open ? "open" : "closed"}
      tabIndex={-1}
      aria-labelledby="help-title"
      aria-describedby="help-description"
      // Slides in from the right edge; closed it is off-screen, invisible and inert.
      className="fixed inset-y-0 right-0 w-[440px] border-l bg-background outline-none transition-[transform,visibility] duration-200 ease-out data-closed:invisible data-closed:translate-x-full"
    >
      {content}
    </aside>
  );
}
