import type {
  AssistantConversation,
  AssistantDetail,
  AssistantRun,
} from "./assistant";

export type HelpArticleSummary = {
  slug: string;
  title: string;
  summary: string;
  section: string;
  contexts: string[];
  revision: number;
  questions: string[];
};
export type HelpArticle = HelpArticleSummary & {
  chunks: { id: string; title: string; html: string }[];
};
export type HelpPage = {
  key: string;
  title: string;
  overview: string;
  articles: HelpArticleSummary[];
};
export type HelpCitation = {
  citation_id: string;
  slug: string;
  heading: string;
  title: string;
  heading_title: string;
  revision: number;
};
export type HelpAnswer = {
  answer: string;
  supported: boolean;
  citations: HelpCitation[];
};
export type HelpRun = AssistantRun & {
  help_context: { key: string; title: string };
  help_answer: HelpAnswer | null;
};
export type HelpConversation = AssistantConversation & { scope: "help" };
export type HelpDetail = Omit<AssistantDetail, "runs"> & {
  scope: "help";
  runs: HelpRun[];
};
