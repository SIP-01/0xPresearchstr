/**
 * Presearchstr query ENGINE — evaluates parsed queries (queryParser.ts)
 * against documents. This is the authoritative local evaluation layer:
 * relays and engines get the raw query as an acceleration hint, but THIS
 * code decides what actually matches, so a relay misunderstanding an
 * operator can never produce incorrect results (site: works even when the
 * relay has never heard of it).
 *
 * Two evaluation modes, deliberately:
 *
 *   - LEGACY GATE — plain queries (no explicit boolean ops) keep the exact
 *     battle-tested semantics from queryMatch.ts: meaningful-term AND gate,
 *     stop-word tolerance, plural folding, gutting guard, phrase floors.
 *
 *   - STRICT AST — explicit AND/OR/NOT/parens evaluate the tree directly.
 *     Stop words are strict here: inside explicit operators every word is
 *     deliberate.
 *
 * Filters evaluate against structured document metadata (FilterDoc), never
 * against free text.
 */
import {
  parseQuery,
  type FilterField,
  type ParsedQuery,
  type QueryNode,
} from '@/lib/queryParser';
import { normalizeText, termMatches, STOP_WORDS } from '@/lib/queryMatch';
import type { IndexObservation } from '@/lib/webIndex';
import type { SearchResult } from '@/lib/providers/types';

/* ------------------------------------------------------------------ */
/* Documents                                                           */
/* ------------------------------------------------------------------ */

/**
 * A document as the engine sees it. `text` fields drive term/phrase
 * matching (title FIRST by convention — the title is the strongest field);
 * the structured fields drive filters.
 */
export interface FilterDoc {
  url?: string;
  title?: string;
  description?: string;
  /** Topic tags (SIP-01 `t` tags / result tags), any case. */
  topics?: string[];
  /** ISO 639-1 language tag, when known. */
  language?: string;
  /** SIP-01 `type` extension value, when known. */
  type?: string;
  /** SIP-01 `mime` extension value, when known. */
  mime?: string;
  /** Page's claimed publication time (unix seconds), when known. */
  publishedAt?: number;
  /** Observation/index time (unix seconds), when known. */
  observedAt?: number;
  /** Text fields for term matching, title first. */
  text: (string | undefined)[];
}

/** Adapt a SIP-01 observation. */
export function docFromObservation(obs: IndexObservation): FilterDoc {
  return {
    url: obs.url,
    title: obs.title,
    description: obs.description,
    topics: obs.topics,
    language: obs.language,
    type: obs.extensions.type,
    mime: obs.extensions.mime,
    // Date filters read the page's claimed publish time first, then the
    // observation time (always present for SIP-01 — we never invent dates).
    publishedAt: obs.published,
    observedAt: obs.observedAt,
    text: [obs.title, obs.description, obs.url, ...obs.topics],
  };
}

/** Adapt a universal SearchResult (orchestrator-level filtering/ranking). */
export function docFromSearchResult(r: SearchResult): FilterDoc {
  return {
    url: r.url,
    title: r.title,
    description: r.snippet,
    topics: r.tags,
    language: r.language,
    publishedAt: r.timestamp,
    observedAt: r.nostrEvent?.created_at,
    text: [r.title, r.snippet, r.domain, ...(r.tags ?? []), r.nostrEvent?.content],
  };
}

/* ------------------------------------------------------------------ */
/* Evaluation context (per doc per query — normalized once)            */
/* ------------------------------------------------------------------ */

interface EvalCtx {
  /** Space-padded normalized text of all text fields. */
  haystack: string;
  /** Space-padded normalized title only. */
  title: string;
  /** Normalized hostname (lowercase, no www-stripping — see site:/domain:). */
  host?: string;
  /** Normalized topic set (lowercase). */
  topics: Set<string>;
}

function buildCtx(doc: FilterDoc): EvalCtx {
  const haystack = ` ${normalizeText(doc.text.filter(Boolean).join(' '))} `;
  const title = doc.title ? ` ${normalizeText(doc.title)} ` : '';

  let host: string | undefined;
  if (doc.url) {
    try {
      host = new URL(doc.url).hostname.toLowerCase();
    } catch {
      host = undefined;
    }
  }

  return {
    haystack,
    title,
    host,
    topics: new Set((doc.topics ?? []).map((t) => t.toLowerCase())),
  };
}

/* ------------------------------------------------------------------ */
/* Text leaf evaluation                                                */
/* ------------------------------------------------------------------ */

/** Split a term node's raw text into normalized match words (len ≥ 2). */
function termWords(value: string): string[] {
  return normalizeText(value).split(/\s+/).filter((w) => w.length >= 2);
}

/** A term node matches when every normalized word it carries matches. */
function evalTerm(value: string, ctx: EvalCtx): boolean {
  const words = termWords(value);
  if (words.length === 0) return true; // punctuation-only token — no constraint
  return words.every((w) => termMatches(ctx.haystack, w));
}

/** A phrase node matches when its normalized form is a substring (order-sensitive). */
function evalPhrase(value: string, ctx: EvalCtx): boolean {
  const phrase = normalizeText(value).trim();
  if (phrase.length < 2) return true;
  return ctx.haystack.includes(phrase);
}

/* ------------------------------------------------------------------ */
/* Filter evaluation                                                   */
/* ------------------------------------------------------------------ */

/** Normalize a site:/domain: value to a host: strip scheme, path, port, www NOT stripped. */
function normalizeHostValue(value: string): string | null {
  let v = value.trim().toLowerCase();
  if (!v) return null;
  // Tolerate users typing site:https://github.com or site:github.com/
  v = v.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  v = v.split('/')[0].split('?')[0].split('#')[0];
  v = v.replace(/^\*\./, ''); // leading wildcard — treat as the bare domain
  v = v.replace(/:\d+$/, ''); // port
  v = v.replace(/\.$/, '');   // trailing dot
  return v && /^[\w.-]+$/.test(v) ? v : null;
}

/**
 * Parse a date boundary: YYYY, YYYY-MM, or YYYY-MM-DD → unix seconds at the
 * START of that day (UTC). Invalid dates ("not-a-date", 2026-13-99) → null.
 */
export function parseDateBoundary(value: string): number | null {
  const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(value.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = m[2] ? Number(m[2]) : 1;
  const day = m[3] ? Number(m[3]) : 1;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const ts = Math.floor(Date.UTC(year, month - 1, day) / 1000);
  // Roundtrip check — Date.UTC silently rolls overflow (Feb 30 → Mar 2).
  const d = new Date(ts * 1000);
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return null;
  }
  return ts;
}

/** type: aliases — user vocabulary → SIP-01 `type` registry values. */
const TYPE_ALIASES: Record<string, string[]> = {
  code: ['repository'],
  repo: ['repository'],
  docs: ['page', 'article'],
};

/** Evaluate one filter clause against a document. */
export function evalFilter(clause: { field: FilterField; value: string }, doc: FilterDoc, ctx: EvalCtx): boolean {
  switch (clause.field) {
    case 'site':
    case 'domain': {
      const want = normalizeHostValue(clause.value);
      if (!want || !ctx.host) return false;
      if (clause.field === 'domain') {
        // Exact host match — domain:github.com is github.com only.
        return ctx.host === want;
      }
      // site: host IS the value or a subdomain of it — www.github.com and
      // gist.github.com match site:github.com; evilgithub.com never does
      // (the dot boundary makes suffix matching safe).
      return ctx.host === want || ctx.host.endsWith(`.${want}`);
    }

    case 'title': {
      const v = normalizeText(clause.value).trim();
      if (!v) return true; // empty title: — no-op
      if (v.includes(' ')) return ctx.title.includes(v); // multi-word = phrase
      return termMatches(ctx.title, v);
    }

    case 'type': {
      const v = clause.value.trim().toLowerCase();
      if (!v) return true;
      const wanted = [v, ...(TYPE_ALIASES[v] ?? [])];
      const docType = doc.type?.toLowerCase();
      const docMime = doc.mime?.toLowerCase();
      // Unknown type must FAIL the filter, never falsely match (task §11).
      if (!docType && !docMime) return false;
      return wanted.some((w) =>
        docType === w || docMime === w || (!!docMime && docMime.endsWith(`/${w}`)),
      );
    }

    case 'lang': {
      const v = clause.value.trim().toLowerCase();
      if (!/^[a-z]{2}$/.test(v)) return true; // invalid lang value → no-op, flagged upstream
      // Unknown language passes (consistent with the Settings language
      // filter — most indexers don't tag language yet); a KNOWN different
      // language fails.
      if (!doc.language) return true;
      return doc.language.toLowerCase() === v;
    }

    case 'tag': {
      const v = clause.value.trim().toLowerCase();
      if (!v) return true;
      // Exact tag match only — tag:nostr must not match "nostr-tools".
      return ctx.topics.has(v);
    }

    case 'before':
    case 'after': {
      const boundary = parseDateBoundary(clause.value);
      if (boundary === null) return true; // invalid date → no-op (graceful), flagged upstream
      // Best available timestamp: the page's claimed publish time first,
      // then the observation time. Docs with NO date pass — freshness can't
      // be disproven; undated results sink via the recency tie-band instead.
      const ts = doc.publishedAt ?? doc.observedAt;
      if (ts === undefined) return true;
      return clause.field === 'before' ? ts < boundary : ts >= boundary;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Strict AST evaluation (explicit boolean structure)                  */
/* ------------------------------------------------------------------ */

function evalNode(node: QueryNode, doc: FilterDoc, ctx: EvalCtx): boolean {
  switch (node.type) {
    case 'term':
      return evalTerm(node.value, ctx);
    case 'phrase':
      return evalPhrase(node.value, ctx);
    case 'filter':
      return evalFilter(node, doc, ctx);
    case 'not':
      return !evalNode(node.child, doc, ctx);
    case 'and':
      return node.children.every((c) => evalNode(c, doc, ctx));
    case 'or':
      return node.children.some((c) => evalNode(c, doc, ctx));
  }
}

/* ------------------------------------------------------------------ */
/* Legacy gate (plain queries — the proven queryMatch semantics)       */
/* ------------------------------------------------------------------ */

interface LegacyGateInput {
  /** Term leaf values (raw). */
  terms: string[];
  /** Phrase leaf values (quoted phrases are hard gates). */
  phrases: string[];
  /** The normalized whole-text-query phrase probe (old behavior). */
  phraseProbe: string;
}

function legacyGate(input: LegacyGateInput, ctx: EvalCtx): { match: boolean; phraseHit: boolean } {
  // Every quoted phrase must hit (order-sensitive).
  let phraseHit = false;
  for (const p of input.phrases) {
    const np = normalizeText(p).trim();
    if (np.length >= 2) {
      if (!ctx.haystack.includes(np)) return { match: false, phraseHit: false };
      phraseHit = true;
    }
  }

  // The whole-query substring probe (the old phrase-matching feature).
  if (input.phraseProbe.length >= 3 && ctx.haystack.includes(input.phraseProbe)) {
    phraseHit = true;
  }

  // Split words into meaningful vs stop words across ALL term leaves.
  const allWords: string[] = [];
  const meaningful: string[] = [];
  for (const t of input.terms) {
    for (const w of termWords(t)) {
      if (allWords.includes(w)) continue;
      allWords.push(w);
      if (!STOP_WORDS.has(w)) meaningful.push(w);
    }
  }
  const gateWords = meaningful.length > 0 ? meaningful : allWords;
  for (const w of gateWords) {
    if (!termMatches(ctx.haystack, w)) return { match: false, phraseHit };
  }

  // Gutting guard: 3+ raw words reduced to ONE meaningful keyword → require
  // a secondary raw-word hit or a phrase hit ("how to build" ≠ "build").
  if (meaningful.length === 1 && allWords.length >= 3 && !phraseHit) {
    const secondary = allWords.filter((w) => w !== meaningful[0]);
    if (!secondary.some((w) => termMatches(ctx.haystack, w))) {
      return { match: false, phraseHit };
    }
  }

  return { match: true, phraseHit };
}

/* ------------------------------------------------------------------ */
/* Public evaluation API                                               */
/* ------------------------------------------------------------------ */

export interface EvalResult {
  /** The gate: does the document satisfy the query at all? */
  match: boolean;
  /** 0..1 composite relevance (coverage + phrase/title bonuses). */
  relevance: number;
  /** Every query word (stop words included) found, 0..1. */
  coverage: number;
  /** An explicit phrase or the whole-query substring hit. */
  phraseHit: boolean;
  /** Phrase hit inside the title, or every meaningful word in the title. */
  titleHit: boolean;
  /** Filters satisfied / total (display + diagnostics). */
  filtersSatisfied: number;
  filterTotal: number;
}

const EMPTY_EXPR_RESULT: EvalResult = {
  match: true, relevance: 0.5, coverage: 1, phraseHit: false, titleHit: false,
  filtersSatisfied: 0, filterTotal: 0,
};

/**
 * Evaluate a parsed query against a document. NEVER throws.
 * This is the single authoritative entry point for local matching.
 */
export function evaluateQuery(doc: FilterDoc, parsed: ParsedQuery): EvalResult {
  if (!parsed.expr) return EMPTY_EXPR_RESULT;
  const ctx = buildCtx(doc);

  // Filter satisfaction (display/diagnostics — the gate itself is below).
  let filtersSatisfied = 0;
  for (const f of parsed.filters) {
    if (evalFilter(f, doc, ctx)) filtersSatisfied++;
  }

  let match: boolean;
  let phraseHit: boolean;

  if (!parsed.hasBoolean) {
    // Legacy gate: the plain-query semantics that already work.
    const terms: string[] = [];
    const phrases: string[] = [];
    collectLeaves(parsed.expr, terms, phrases);
    const textResidue = normalizeText([...terms, ...phrases].join(' ')).trim();
    const gate = legacyGate({ terms, phrases, phraseProbe: textResidue }, ctx);
    // Filters AND into the gate.
    const filtersOk = parsed.filters.every((f) => !f.negated
      ? evalFilter(f, doc, ctx)
      : !evalFilter(f, doc, ctx));
    match = gate.match && filtersOk;
    phraseHit = gate.phraseHit;
  } else {
    match = evalNode(parsed.expr, doc, ctx);
    // Signal only: did any explicit phrase hit?
    const phrases: string[] = [];
    collectPhrases(parsed.expr, phrases);
    phraseHit = phrases.some((p) => {
      const np = normalizeText(p).trim();
      return np.length >= 2 && ctx.haystack.includes(np);
    });
  }

  if (!match) {
    return {
      match: false, relevance: 0, coverage: 0, phraseHit: false, titleHit: false,
      filtersSatisfied, filterTotal: parsed.filters.length,
    };
  }

  // ── Relevance signals ──────────────────────────────────────────────
  // Coverage counts the query's TEXT words only (terms + phrase words) —
  // filter values ("github.com" from site:) are not text to match. This
  // preserves the old tokenizeRaw word-coverage semantics exactly.
  const textTerms: string[] = [];
  const textPhrases: string[] = [];
  collectLeaves(parsed.expr, textTerms, textPhrases);
  const allWords = new Set<string>();
  for (const t of textTerms) for (const w of termWords(t)) allWords.add(w);
  for (const p of textPhrases) for (const w of termWords(p)) allWords.add(w);
  let hits = 0;
  for (const w of allWords) {
    if (termMatches(ctx.haystack, w)) hits++;
  }
  const coverage = allWords.size > 0 ? hits / allWords.size : 1;

  // Title signals: phrase in title, or every meaningful word in title.
  const titlePhraseHit = phraseHit && ctx.title.length > 0 && phrasesOf(parsed).some((p) => ctx.title.includes(p));
  const meaningful = [...allWords].filter((w) => !STOP_WORDS.has(w));
  const titleTermHit = meaningful.length > 0 && meaningful.every((w) => termMatches(ctx.title, w));
  const titleHit = titlePhraseHit || titleTermHit;

  // Composite: phrase floor 0.9 (legacy), then coverage, plus bonuses.
  const base = Math.max(coverage, phraseHit ? 0.9 : 0);
  const relevance = Math.min(1, base + (titlePhraseHit ? 0.1 : 0) + (titleTermHit ? 0.05 : 0));

  return {
    match, relevance, coverage, phraseHit, titleHit,
    filtersSatisfied, filterTotal: parsed.filters.length,
  };
}

function collectLeaves(node: QueryNode | undefined, terms: string[], phrases: string[]): void {
  if (!node) return;
  switch (node.type) {
    case 'term': terms.push(node.value); break;
    case 'phrase': phrases.push(node.value); break;
    case 'not': collectLeaves(node.child, terms, phrases); break;
    case 'and':
    case 'or': for (const c of node.children) collectLeaves(c, terms, phrases); break;
  }
}

function collectPhrases(node: QueryNode | undefined, out: string[]): void {
  if (!node) return;
  if (node.type === 'phrase') out.push(normalizeText(node.value).trim());
  else if (node.type === 'not') collectPhrases(node.child, out);
  else if (node.type === 'and' || node.type === 'or') {
    for (const c of node.children) collectPhrases(c, out);
  }
}

function phrasesOf(parsed: ParsedQuery): string[] {
  const out: string[] = [];
  collectPhrases(parsed.expr, out);
  // The whole-text-query probe also counts as a phrase when it hits.
  if (!parsed.hasBoolean) {
    const terms: string[] = [];
    const phrases: string[] = [];
    collectLeaves(parsed.expr, terms, phrases);
    const probe = normalizeText([...terms, ...phrases].join(' ')).trim();
    if (probe.length >= 3) out.push(probe);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Hard constraints (orchestrator-level, ALL providers)                */
/* ------------------------------------------------------------------ */

export interface HardConstraints {
  /** Positive filters; values are OR'ed within a field group. */
  filters: { field: FilterField; values: string[] }[];
  /** NOT subtrees (terms, phrases, or filters) that must NOT match. */
  nots: QueryNode[];
}

/**
 * Collect the constraints that hold at the TOP level of the query — the
 * parts that may be enforced result-by-result at merge time without
 * understanding the boolean tree:
 *   - filters directly under AND (root or nested ANDs)
 *   - OR groups whose members are all filters of the SAME field
 *     (site:a OR site:b → site ∈ {a, b})
 *   - NOT subtrees under AND
 * Exotic shapes (filter OR'd with text, NOT under OR) are left to the
 * providers' full AST evaluation — degraded, never wrong-by-accident.
 */
export function collectHardConstraints(parsed: ParsedQuery): HardConstraints {
  const filters: { field: FilterField; values: string[] }[] = [];
  const nots: QueryNode[] = [];

  const addFilter = (field: FilterField, value: string) => {
    const existing = filters.find((f) => f.field === field);
    if (existing) {
      if (!existing.values.includes(value)) existing.values.push(value);
    } else {
      filters.push({ field, values: [value] });
    }
  };

  const walk = (node: QueryNode | undefined, underAnd: boolean): void => {
    if (!node) return;
    switch (node.type) {
      case 'filter':
        if (underAnd) addFilter(node.field, node.value);
        return;
      case 'not':
        if (underAnd) nots.push(node.child);
        return;
      case 'and':
        for (const c of node.children) walk(c, true);
        return;
      case 'or': {
        // Same-field filter groups collapse into an any-of-values constraint.
        if (underAnd && node.children.length > 0 && node.children.every((c) => c.type === 'filter')) {
          const fields = new Set(node.children.map((c) => (c as { field: FilterField }).field));
          if (fields.size === 1) {
            for (const c of node.children) {
              const f = c as { field: FilterField; value: string };
              addFilter(f.field, f.value);
            }
          }
        }
        return;
      }
      default:
        return;
    }
  };

  walk(parsed.expr, true);
  return { filters, nots };
}

/** Does the document pass the hard constraints? (NOT subtrees fully evaluated.) */
export function passesHardConstraints(doc: FilterDoc, constraints: HardConstraints): boolean {
  const ctx = buildCtx(doc);
  for (const f of constraints.filters) {
    // Any-of-values within a field group.
    if (!f.values.some((v) => evalFilter({ field: f.field, value: v }, doc, ctx))) return false;
  }
  for (const n of constraints.nots) {
    if (evalNode(n, doc, ctx)) return false;
  }
  return true;
}

/** Convenience: parse + hard-constraint filter a result list. */
export function applyHardConstraints(results: SearchResult[], parsed: ParsedQuery): SearchResult[] {
  if (!parsed.expr) return results;
  const constraints = collectHardConstraints(parsed);
  if (constraints.filters.length === 0 && constraints.nots.length === 0) return results;
  return results.filter((r) => passesHardConstraints(docFromSearchResult(r), constraints));
}

/** Convenience wrapper for providers: parse (memoized) + evaluate. */
export function evaluateRaw(doc: FilterDoc, rawQuery: string): EvalResult {
  return evaluateQuery(doc, parseQuery(rawQuery));
}
