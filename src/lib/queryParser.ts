/**
 * Presearchstr structured query parser — INTERNAL search-engine machinery.
 *
 * Turns the raw user query into a structured representation:
 *
 *   nostr AND privacy site:github.com lang:en
 *
 *   → {
 *       expr: AND[ term(nostr), term(privacy), filter(site:github.com), filter(lang:en) ],
 *       filters: [ site:github.com, lang:en ],   // flattened for UI/engines
 *       ...
 *     }
 *
 * The core distinction the whole engine is built on:
 *
 *   TEXT QUERY ≠ FILTER — text nodes are matched against document text
 *   (title/description/topics/…), filter nodes are evaluated against
 *   structured document metadata (hostname, language, type, dates, …).
 *
 * Supported syntax:
 *   Boolean:   AND  OR  NOT  (UPPERCASE only — lowercase and/or/not stay
 *              ordinary words, so "rock and roll" and "node not syncing"
 *              are not mangled), plus a leading "-" as NOT ("-twitter").
 *   Grouping:  ( … )  with correct precedence: NOT > AND > OR.
 *   Phrases:   "decentralized search"  (order-sensitive)
 *   Filters:   site: domain: title: type: lang: tag: before: after:
 *              (field names case-insensitive; values bare or "quoted")
 *
 * Robustness: the parser NEVER throws. Malformed input (dangling operator,
 * unclosed quote/paren, empty filter value, unknown field) degrades to
 * useful fallback behavior with `hadErrors` set.
 *
 * This is deliberately NOT a protocol — it's Presearchstr's local query
 * understanding. SIP-01 events are untouched; relays still get the raw
 * query as a NIP-50 acceleration hint.
 */

/* ------------------------------------------------------------------ */
/* Public types                                                        */
/* ------------------------------------------------------------------ */

/** Structured filter fields (case-insensitive in the raw query). */
export type FilterField =
  | 'site'    // host is value or a subdomain of it (site:github.com ⊇ www./sub.)
  | 'domain'  // exact host only
  | 'title'   // term/phrase must appear in the document title
  | 'type'    // SIP-01 `type` extension (or mime tail): pdf, code, page, …
  | 'lang'    // ISO 639-1 language tag
  | 'tag'     // exact topic tag match (no substring looseness)
  | 'before'  // date boundary, YYYY[-MM[-DD]] — strictly before that day
  | 'after';  // date boundary — on/after that day

export const FILTER_FIELDS: readonly FilterField[] = [
  'site', 'domain', 'title', 'type', 'lang', 'tag', 'before', 'after',
];

const FILTER_FIELD_SET = new Set<string>(FILTER_FIELDS);

export interface FilterClause {
  field: FilterField;
  /** Raw value as typed (quotes stripped). Normalization happens at eval. */
  value: string;
  /** True when the clause sits under a NOT (display + translation care). */
  negated: boolean;
}

/** Query AST node. */
export type QueryNode =
  | { type: 'term'; value: string }
  | { type: 'phrase'; value: string }
  | { type: 'and'; children: QueryNode[]; implicit: boolean }
  | { type: 'or'; children: QueryNode[] }
  | { type: 'not'; child: QueryNode }
  | { type: 'filter'; field: FilterField; value: string };

export interface ParsedQuery {
  /** The original query string. */
  raw: string;
  /**
   * The full AST — text and filter nodes combined. Undefined when the query
   * carried nothing parseable (empty / only operators that decayed away).
   */
  expr?: QueryNode;
  /**
   * Every filter leaf in the AST (flattened, with negation) — for UI chips
   * and engine translation. Evaluation always uses the AST, never this list.
   */
  filters: FilterClause[];
  /** True when the query contains explicit AND/OR/NOT structure. */
  hasBoolean: boolean;
  /** True when the query contains at least one "quoted phrase". */
  hasPhrases: boolean;
  /** True when the query contains at least one filter. */
  hasFilters: boolean;
  /** True when anything malformed was encountered (never fatal). */
  hadErrors: boolean;
}

/* ------------------------------------------------------------------ */
/* Lexer                                                               */
/* ------------------------------------------------------------------ */

type Token =
  | { kind: 'word'; text: string }
  | { kind: 'phrase'; text: string }
  | { kind: 'and' }
  | { kind: 'or' }
  | { kind: 'not' }
  | { kind: 'lparen' }
  | { kind: 'rparen' };

interface LexResult {
  tokens: Token[];
  hadErrors: boolean;
}

/**
 * Split raw input into tokens. Rules:
 * - whitespace separates;
 * - `"` opens a phrase (runs to the closing quote, or to end-of-input when
 *   unclosed — graceful, flagged);
 * - `(…)` are their own tokens;
 * - a word runs to whitespace/paren; an embedded `"` after a known
 *   `field:` prefix extends the word to the closing quote
 *   (title:"Nostr relay" is ONE filter);
 * - a leading `-` on a word/phrase emits NOT first ("-twitter");
 * - AND/OR/NOT are operators ONLY when the whole token is uppercase.
 */
function lex(raw: string): LexResult {
  const tokens: Token[] = [];
  let hadErrors = false;
  let i = 0;
  const n = raw.length;

  const isBoundary = (c: string) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '(' || c === ')';

  while (i < n) {
    const c = raw[i];

    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
    if (c === '(') { tokens.push({ kind: 'lparen' }); i++; continue; }
    if (c === ')') { tokens.push({ kind: 'rparen' }); i++; continue; }

    // Quoted phrase.
    if (c === '"') {
      const end = raw.indexOf('"', i + 1);
      if (end === -1) {
        // Unclosed quote — take the rest as the phrase, flag it.
        tokens.push({ kind: 'phrase', text: raw.slice(i + 1) });
        hadErrors = true;
        i = n;
      } else {
        tokens.push({ kind: 'phrase', text: raw.slice(i + 1, end) });
        i = end + 1;
      }
      continue;
    }

    // A leading '-' is a NOT prefix when something follows it
    // ("-twitter", '-"exact phrase"'). A lone '-' stays a word fragment.
    if (c === '-' && i + 1 < n && !isBoundary(raw[i + 1]) && raw[i + 1] !== '-') {
      tokens.push({ kind: 'not' });
      i++;
      continue;
    }

    // Word / filter token: run to the next boundary. An embedded quote
    // after a known `field:` prefix pulls in the quoted section as the
    // value (title:"Nostr relay").
    let j = i;
    let text = '';
    while (j < n && !isBoundary(raw[j])) {
      if (raw[j] === '"') {
        const m = /^([a-z]+):$/i.exec(text);
        if (m && FILTER_FIELD_SET.has(m[1].toLowerCase())) {
          const end = raw.indexOf('"', j + 1);
          if (end === -1) {
            text += raw.slice(j + 1); // unclosed — take the rest
            hadErrors = true;
            j = n;
          } else {
            text += raw.slice(j + 1, end);
            j = end + 1;
          }
          continue;
        }
      }
      text += raw[j];
      j++;
    }
    i = j;

    if (!text) continue;

    // Whole-token uppercase operators only.
    if (text === 'AND') { tokens.push({ kind: 'and' }); continue; }
    if (text === 'OR') { tokens.push({ kind: 'or' }); continue; }
    if (text === 'NOT') { tokens.push({ kind: 'not' }); continue; }

    tokens.push({ kind: 'word', text });
  }

  return { tokens, hadErrors };
}

/* ------------------------------------------------------------------ */
/* Parser (recursive descent; precedence NOT > AND > OR; juxtaposition  */
/* is implicit AND)                                                    */
/* ------------------------------------------------------------------ */

interface ParseState {
  tokens: Token[];
  pos: number;
  hadErrors: boolean;
}

function peek(s: ParseState): Token | undefined {
  return s.tokens[s.pos];
}

/** Does this token start a primary (word/phrase/filter/paren/not)? */
function startsPrimary(t: Token | undefined): boolean {
  return !!t && (t.kind === 'word' || t.kind === 'phrase' || t.kind === 'lparen' || t.kind === 'not');
}

function parseOr(s: ParseState): QueryNode | undefined {
  const children: QueryNode[] = [];
  const child = parseAnd(s);
  if (child) children.push(child);

  while (peek(s)?.kind === 'or') {
    s.pos++; // consume OR
    const next = parseAnd(s);
    if (!next) {
      // Dangling OR ("bitcoin OR") — drop the operator, keep the left side.
      s.hadErrors = true;
      break;
    }
    children.push(next);
  }

  if (children.length === 0) return undefined;
  if (children.length === 1) return children[0];
  return { type: 'or', children };
}

function parseAnd(s: ParseState): QueryNode | undefined {
  const children: QueryNode[] = [];
  let implicit = true;
  const child = parseUnary(s);
  if (child) children.push(child);

  for (;;) {
    const t = peek(s);
    if (t?.kind === 'and') {
      implicit = false;
      s.pos++; // consume AND
      const next = parseUnary(s);
      if (!next) {
        // Dangling AND ("nostr AND") — drop it.
        s.hadErrors = true;
        break;
      }
      children.push(next);
      continue;
    }
    if (startsPrimary(t)) {
      // Juxtaposition = implicit AND ("nostr privacy site:x").
      const next = parseUnary(s);
      if (next) children.push(next);
      continue;
    }
    break;
  }

  if (children.length === 0) return undefined;
  if (children.length === 1) return children[0];
  return { type: 'and', children, implicit };
}

function parseUnary(s: ParseState): QueryNode | undefined {
  if (peek(s)?.kind === 'not') {
    s.pos++; // consume NOT
    const child = parseUnary(s);
    if (!child) {
      // Dangling NOT ("nostr NOT") — drop it.
      s.hadErrors = true;
      return undefined;
    }
    return { type: 'not', child };
  }
  return parsePrimary(s);
}

function parsePrimary(s: ParseState): QueryNode | undefined {
  const t = peek(s);
  if (!t) return undefined;

  if (t.kind === 'lparen') {
    s.pos++; // consume (
    const inner = parseOr(s);
    if (peek(s)?.kind === 'rparen') {
      s.pos++; // consume )
    } else {
      // Unclosed paren — accept what we have.
      s.hadErrors = true;
    }
    if (!inner) {
      // Empty parens "()" — ignore.
      s.hadErrors = true;
    }
    return inner;
  }

  if (t.kind === 'phrase') {
    s.pos++;
    const value = t.text.trim();
    if (!value) {
      s.hadErrors = true; // empty quotes ""
      return undefined;
    }
    return { type: 'phrase', value };
  }

  if (t.kind === 'word') {
    s.pos++;
    return wordToNode(t.text, s);
  }

  // Stray ')' or a boolean operator where a primary belongs.
  s.hadErrors = true;
  s.pos++;
  return undefined;
}

/** Map a word token to a term or filter node. */
function wordToNode(text: string, s: ParseState): QueryNode | undefined {
  const m = /^([a-z]+):(.*)$/is.exec(text);
  if (m) {
    const field = m[1].toLowerCase();
    const value = m[2].trim();
    if (FILTER_FIELD_SET.has(field)) {
      if (!value) {
        // "site:" with no value — drop the token, flag it, keep going.
        s.hadErrors = true;
        return undefined;
      }
      return { type: 'filter', field: field as FilterField, value };
    }
  }
  // Unknown field ("foo:bar") or any other word — plain text term. URLs
  // ("https://example.com") land here untouched: `https` is not a filter
  // field, so the whole token survives as text.
  return { type: 'term', value: text };
}

/* ------------------------------------------------------------------ */
/* Assembly                                                            */
/* ------------------------------------------------------------------ */

/** Collect every filter leaf with its negation state (for UI/translation). */
function collectFilters(node: QueryNode | undefined, negated: boolean, out: FilterClause[]): void {
  if (!node) return;
  switch (node.type) {
    case 'filter':
      out.push({ field: node.field, value: node.value, negated });
      return;
    case 'not':
      collectFilters(node.child, !negated, out);
      return;
    case 'and':
    case 'or':
      for (const c of node.children) collectFilters(c, negated, out);
      return;
    default:
      return;
  }
}

function treeFlags(node: QueryNode | undefined, flags: { bool: boolean; phrase: boolean }): void {
  if (!node) return;
  if (node.type === 'and' || node.type === 'or') {
    if (node.type === 'or' || !node.implicit) flags.bool = true;
    for (const c of node.children) treeFlags(c, flags);
  } else if (node.type === 'not') {
    flags.bool = true;
    treeFlags(node.child, flags);
  } else if (node.type === 'phrase') {
    flags.phrase = true;
  }
}

/* ------------------------------------------------------------------ */
/* Entry point (memoized — a query parses once per unique string)      */
/* ------------------------------------------------------------------ */

const parseCache = new Map<string, ParsedQuery>();
const PARSE_CACHE_MAX = 128;

/**
 * Parse a raw query string into the structured form. NEVER throws.
 * Memoized: the same string parses once per session (§ performance).
 */
export function parseQuery(raw: string): ParsedQuery {
  const cached = parseCache.get(raw);
  if (cached) return cached;

  const { tokens, hadErrors: lexErrors } = lex(raw);
  const state: ParseState = { tokens, pos: 0, hadErrors: lexErrors };
  const expr = parseOr(state);
  if (state.pos < tokens.length) state.hadErrors = true; // trailing junk (")" etc.)

  const filters: FilterClause[] = [];
  collectFilters(expr, false, filters);
  const flags = { bool: false, phrase: false };
  treeFlags(expr, flags);

  const parsed: ParsedQuery = {
    raw,
    expr,
    filters,
    hasBoolean: flags.bool,
    hasPhrases: flags.phrase,
    hasFilters: filters.length > 0,
    hadErrors: state.hadErrors,
  };

  if (parseCache.size >= PARSE_CACHE_MAX) {
    // Oldest-first eviction (Map preserves insertion order).
    parseCache.delete(parseCache.keys().next().value!);
  }
  parseCache.set(raw, parsed);
  return parsed;
}

/** All text-bearing leaves (terms + phrases), flattened — for legacy paths. */
export function collectTextLeaves(node: QueryNode | undefined, out: { terms: string[]; phrases: string[] } = { terms: [], phrases: [] }): { terms: string[]; phrases: string[] } {
  if (!node) return out;
  switch (node.type) {
    case 'term':
      out.terms.push(node.value);
      break;
    case 'phrase':
      out.phrases.push(node.value);
      break;
    case 'not':
      collectTextLeaves(node.child, out);
      break;
    case 'and':
    case 'or':
      for (const c of node.children) collectTextLeaves(c, out);
      break;
  }
  return out;
}

/** The plain-text residue of a query (terms + phrases, no filters/operators)
 *  joined with spaces — for engines that only understand text. */
export function textOnly(parsed: ParsedQuery): string {
  const { terms, phrases } = collectTextLeaves(parsed.expr);
  return [...terms, ...phrases.map((p) => `"${p}"`)].join(' ').trim();
}

/**
 * Translate the parsed query into DDG-family engine syntax (DuckDuckGo,
 * Brave, SearXNG's engines): what they support natively, translated — and
 * nothing they would misinterpret. What they CAN'T express is simply
 * omitted here and enforced locally at the merge layer (never discarded).
 *
 *   AND          → space (implicit)          OR  → ' OR '
 *   NOT x        → -x (engine-native)        ""  → quoted phrase
 *   site:/domain:→ site:value (both native)  title: → intitle:
 *   before:/after: → kept (DDG-native dates)
 *   lang:        → DROPPED from text — translated to engine language PARAMS
 *   type:/tag:   → DROPPED from text — enforced by local filter evaluation
 */
export function toEngineQuery(parsed: ParsedQuery): string {
  const parts: string[] = [];

  const render = (node: QueryNode, negated: boolean): void => {
    switch (node.type) {
      case 'term':
        parts.push(negated ? `-${node.value}` : node.value);
        return;
      case 'phrase':
        parts.push(negated ? `-"${node.value}"` : `"${node.value}"`);
        return;
      case 'filter': {
        // Only positive, engine-native operators translate; everything else
        // is enforced locally at the merge layer.
        if (negated) return;
        const v = node.value.includes(' ') ? `"${node.value}"` : node.value;
        if (node.field === 'site') parts.push(`site:${v}`);
        else if (node.field === 'domain') parts.push(`site:${v}`); // closest native
        else if (node.field === 'title') parts.push(`intitle:${v}`);
        else if (node.field === 'before' || node.field === 'after') parts.push(`${node.field}:${v}`);
        return;
      }
      case 'not':
        render(node.child, !negated);
        return;
      case 'and':
        for (const c of node.children) render(c, negated);
        return;
      case 'or':
        // Engine OR has no portable parentheses — a flat OR chain is the
        // safest common denominator.
        parts.push(node.children.map((c) => renderToString(c, negated)).filter(Boolean).join(' OR '));
        return;
    }
  };

  const renderToString = (node: QueryNode, negated: boolean): string => {
    const before = parts.length;
    render(node, negated);
    return parts.splice(before).join(' ');
  };

  if (parsed.expr) render(parsed.expr, false);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}
