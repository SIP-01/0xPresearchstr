# Presearchstr

**The community-driven search engine.** Nostr first, web when needed, with Precommunity keyword ads. Organic search works without a configured backend.

Presearchstr is the **community fork of [0xSearchstr](https://github.com/NostrDanish/0xSearchstr.git)**, inspired by [Presearch](https://presearch.com): a shared Nostr search index with keyword advertising managed through [Precommunity](https://precommunity.org/keyword-market).

---

## One Index, Many Frontends (Federation)

Presearchstr and 0xSearchstr share **one search index** on Nostr. Both apps publish the
exact same event schemas — each signed by its own indexer keys:

| App | Legacy cache signer |
|-----|---------------------|
| 0xSearchstr | `12ad55ad…77d199` |
| Presearchstr (retired) | `be7cad9a…c4289` |

Readers trust **all** keys (`INDEXER_PUBKEYS` in `src/lib/searchIndex.ts`). So:

- **0xSearchstr makes Presearchstr better** — every cache event its users write is an instant hit here.
- **Presearchstr makes 0xSearchstr better** — every search here feeds the same shared pool.
- **Your fork makes everyone better** — publish SIP-01 observations (no trust list needed) and you join the index on first search.

Same kinds. Same tags. Different signers. One index.

---

## Search Index Protocol (SIP-01) — kind 39697

The shared web index has graduated from app-signed query caches to a real protocol:
**one addressable event per web document, per indexer**. Canonical spec (v1.2):
**[github.com/NostrDanish/SIP-01](https://github.com/NostrDanish/SIP-01)** — local copy at
[docs/SIP-01.md](docs/SIP-01.md), plus an [implementation guide](docs/IMPLEMENTATION-GUIDE.md)
with test vectors every implementation must reproduce.

We implement the spec byte-compatibly (shared `webIndex.ts` + §13 test vectors),
including the §9.2 extension-tag registry (`type`/`platform`/`category`/`network`/`country`/`mime`)
and `verifyObservation()` integrity checks (d ↔ u, x ↔ content) before results are shown.

```
Your search surfaces "https://example.com/great-page"
       │
       ▼
kind 39697 event — signed by THIS DEVICE's indexing identity
  d = "widx:" + sha256(normalized_url)[0:32]   ← URL identity
  u = canonical URL      x = sha256(title + "\n" + description)
  content = { title, description?, image? }
       │
       ▼
Published to index relays → every compatible client can search it
```

What makes it different from the old cache:

- **Every browser is an indexer** — a dedicated pseudonymous keypair is generated on first
  use (Settings → Auto Indexer), stored locally, never your personal Nostr identity
- **No queries in events** — an observation reveals a URL + public page metadata, never
  who searched what
- **Independent observation counts** — N indexers seeing the same page produce N events
  with the same `d` tag; search nodes group by `d` and rank by agreement + recency
- **Anyone can join** — crawlers, other engines, other apps; the schema is the whole contract

The legacy kind 30078 query cache is **frozen and read-only here** — this app no longer
publishes it, but historical entries from trusted indexer keys are still read so older
clients keep working — no flag day. Automatic indexing can be toggled in
**Settings → Auto Indexer**.

---

## How It Works

```
User Search
       │
       ▼
 ┌─────────────── All providers run in parallel ──────────────┐
 │                                                             │
 │  Web Index  Federated  Nostr   Community  SearXNG  Wiki Tor │
 │  (SIP-01)   Cache      NIP-50     │        │        │   │   │
 │  39697      30078        │        │    DuckDuckGo HN StackOverflow
 │    │           │         │        │        │        │   │   │
 │    ▼           ▼         ▼        ▼        ▼        ▼   ▼   │
 │   SearchResult[] from each provider                         │
 │                                                             │
 └──────────────────────┬──────────────────────────────────────┘
                        │
                   Merge + Deduplicate + Rank
                        │
                        ▼
                    Display Results
                        │
                        ▼
              Auto-index (SIP-01, per-device identity)
                        │
                   Still nothing?
                        │
                        ▼
                Browser Fallback Links
             (DDG, Brave, Mojeek, Marginalia)
```

Instead of building another centralized search engine, Presearchstr is a **search aggregator** with a plugin-based provider architecture:

1. **Every source is a provider** — each returns a universal `SearchResult[]`
2. **All providers run in parallel** — results stream in as each completes
3. **Nostr scores highest** — decentralized results are prioritized
4. **Auto-indexing** — every search contributes its surfaced pages back to the shared SIP-01 index
5. **Never leaves you empty** — fallback links to privacy-respecting search engines

Organic aggregation and ranking run in the browser. The engine backend provides
Precommunity ads and optional engine-provided search or AI credentials. Ads resolve
separately and never enter the organic result pipeline.

### Auto-Indexing (Community Index)

The killer feature: **every search grows the index.**

When you search, the useful pages your results surface get published as SIP-01
document observations (kind 39697) — signed by this device's pseudonymous indexing
identity, never your personal key, never containing your query. Next time *anyone* —
on this app, on 0xSearchstr, on any compatible client — searches for something those
pages answer, results come from Nostr instantly, no external API call needed.

```
Search "best monero wallet"
       │
       ├─→ Read the shared index (SIP-01 docs + legacy cache)
       │     └─→ HIT (pages observed by ANY indexer)? → instant results
       │
       ├─→ Run all providers in parallel
       │     └─→ Merge + deduplicate + rank
       │
       └─→ Contribute surfaced pages back to the index
             ├─→ kind 39697 observations, signed by this device (SIP-01)
             └─→ kind 30078 term signal: sha256(query) only — NEVER plaintext
                   └─→ Next user on ANY compatible client gets an instant hit
```

The legacy query cache (kind 30078, signed by the trusted indexer keys above) is still
read in parallel for backwards compatibility — but SIP-01 is where the index grows.

**Queries are not published as plaintext index observations.** "Trending searches" are built from
one-way term signals: each device publishes only `sha256(normalized query)` under its
pseudonymous indexing identity. A term's plaintext is revealed by the network only
once **3+ independent devices** searched it (the reveal is self-verifying — readers
re-hash the plaintext and compare). Rare queries do not appear as plaintext trending
events, and sensitive query classes (NIP-19 ids, NIP-05 addresses, URLs,
math) are never signaled at all. See [NIP.md](NIP.md).

### Keyword staking

PRE community, the community around the PRE token, resolves blockchain keyword
stakes through our backend using only the search query. Submitted text searches can display one
**Keyword staking** card in **Web**
and **All**, below any instant or AI answers and above organic results. Keyword
staking is managed at [Precommunity Keyword Market](https://precommunity.org/keyword-market).

The placement is **on by default**. PRE staking words are a platform setting:
visitors cannot turn them off. Team admins (the owner key, or a pubkey on the
owner-signed admin list) publish a kind 30078 switch,
`presearchstr:keyword-staking`. A missing event means keyword staking stays on.
Nostr keyword staking and npub staking remain in Explore; staker npubs and the
device indexing npub stay hidden until **Show npubs** is turned on in Settings.

The browser also reads the public keyword ledger at
`GET https://precommunity.org/api/v1/keyword-market/keywords/{query}`.
A synced eligible stake, such as Bitcoin, is shown from that ledger even when
the ad proxy has no creative. The browser calls `GET /api/ads/precommunity?q=…` on the engine backend for the counted creative. The worker
calls Precommunity's resolve API with a server-only `KEYWORD_MARKET_API_KEY` and
returns `{ ad: PrecommunityAd | null }`. An ad has `headline`, `description`, `url`,
`clickUrl`, and `reportUrl` fields. When the ledger has no eligible stake and the
creative lookup completes with `ad: null` or an error, the card shows **Stake this keyword**,
inviting website promotion for the submitted query with a **Keyword staking** link to the Keyword
Marketplace. This invitation does not assert that the keyword is available and
does not block organic search.

- Ads are independent of result counts, ranking, votes, Nostr indexing, and AI evidence.
- Pagination and switching between Web and All retain the same ad for the submitted query.
- Keyword staking is an explicit Privacy Mode exception: eligible submitted
  text searches in Web and All still resolve ads and show ads or marketplace invitations.
  Organic search uses Nostr-tier providers only and AI answers remain disabled in this mode.
  The invitation stays hidden during the initial lookup, on other tabs, and for
  special query classes (NIP-19, NIP-05, URLs, and math), which do not resolve ads.
- Ad clicks open `clickUrl` in a new tab; reports open `reportUrl`. All links require
  HTTPS, and click/report links are restricted to `precommunity.org`.
- Nostr keyword staking and npub staking remain in **Explore → Nostr keyword staking** and
  admin statistics. They no longer receive search placement; their schema and existing
  events are preserved in [NIP.md](NIP.md). Npubs stay hidden unless the visitor turns
  **Show npubs** on.

### Base payout wallet

The account menu and Settings link a Base address to the logged-in Nostr
account for payouts. The link is a [NIP-39](https://github.com/nostr-protocol/nips/blob/master/39.md)
kind 10011 claim, `ethereum:8453:address:0x…`, proved by an EIP-191 signature
from that wallet. The Nostr key is not reused as an Ethereum key. The wallet
key stays in the wallet. The signed address is public. Details are in
[NIP.md](NIP.md).

**Privacy:** eligible Web/All text queries still resolve ads in Privacy Mode.
Our backend can observe the query and browser IP; its API request to PRE community
forwards only search text, without the Nostr account, browser cookies, or user IP headers.
Ad/report links connect the browser directly to PRE community; ad clicks are counted.
Ordinary clearnet providers and AI remain disabled in Privacy Mode, and unsupported
query classes do not reach the advertising API.

---

## Quick Start

```bash
git clone https://github.com/NostrDanish/0xPresearchstr.git
cd Presearchstr
npm install
npm run dev
```

Open `http://localhost:8080` and search.

The Vite-only command above does not run the worker API. To try ads locally, place
the operator's key in the ignored `.dev.vars` file at the repository root:

```dotenv
KEYWORD_MARKET_API_KEY=<your Precommunity API key>
```

Then build the frontend and serve both the app and its API through the worker:

```bash
npm run build
npx wrangler@4 dev --port 8080
```

Never prefix this secret with `VITE_` or add it to committed configuration.

---

## Provider Architecture

```
src/lib/providers/
├── types.ts          ← SearchResult, SearchProvider interface
├── web-index.ts      ← SIP-01 web document index (kind 39697, reads first!)
├── cached-index.ts   ← Federated Nostr cache (legacy kind 30078, trusts all indexers)
├── nostr.ts          ← NIP-50 relay search
├── community.ts      ← User-curated index submissions + Nostra interop
├── searxng.ts        ← SearXNG meta-search with failover
├── duckduckgo.ts     ← DuckDuckGo HTML scraper
├── brave.ts          ← Brave Search API (BYOK — lead engine when a key is set)
├── parallel.ts       ← Parallel Search API (BYOK — long dense excerpts)
├── wikipedia.ts      ← MediaWiki API
├── hacker-news.ts    ← Algolia HN Search API
├── stackoverflow.ts  ← StackExchange API
├── tor.ts            ← Ahmia.fi .onion search
├── registry.ts       ← Provider catalog
└── index.ts          ← Barrel export
```

### Adding a Provider

1. Create `src/lib/providers/my-provider.ts` implementing `SearchProvider`
2. Import it in `registry.ts` and add to `ALL_PROVIDERS`
3. Done — the orchestrator picks it up automatically

### SearchProvider Interface

```typescript
interface SearchProvider {
  id: string;
  name: string;
  source: SearchSource;
  search(options: SearchOptions): Promise<ProviderSearchResponse>;
}
```

### Live Providers

| Provider | Source | API | Notes |
|----------|--------|-----|-------|
| **Web Index** | SIP-01 kind 39697 | WebSocket | Shared per-document index, any indexer, ranked by relevance + independent observations |
| **Nostr** | NIP-50 relays | WebSocket | Profiles, notes, articles, wiki (NIP-54), files (NIP-94), torrents (NIP-35), code snippets (NIP-C0) |
| **Community** | User submissions | WebSocket | Curated links + Nostra interop + NIP-B0 web bookmarks |
| **SearXNG** | Discovered instance pool (top 4 auto-picked, language-aware) | CORS proxy | The fallback band — DDG, Brave, Wikipedia, and dozens more behind it |
| **DuckDuckGo** | HTML scraper | CORS proxy | The default lead web engine (unless a Brave key is set) |
| **Hacker News** | Algolia API | Direct (CORS) | Stories with points/comments |
| **Git Repos** | ngit/GRASP relays (NIP-34) | WebSocket, read-only | Repos, issues, PRs & patches — pool editable in Settings → Git Relays |
| **Nostr Wiki** | Wiki relays (NIP-54) | WebSocket, read-only | Decentralized wiki articles (Wikifreedia corpus) — pool editable in Settings → Wiki Relays |
| **Cache Index** | Federated Nostr index | WebSocket | Legacy kind 30078 cache — **off by default** (frozen, read-only) |
| **Brave** | Brave Search API | CORS proxy | BYOK: paste your free-tier key (2k queries/mo) in Settings → Brave — **with a key set, Brave becomes the lead web engine** |
| **Parallel** | Parallel Search API | CORS proxy | BYOK: free starting credits — Settings → Parallel. Long dense excerpts; every result feeds the SIP-01 index with richer descriptions |
| **Wikipedia** | MediaWiki API | Direct (CORS) | **Off by default** — enable in Settings → Engines |
| **Stack Overflow** | StackExchange API | Direct (CORS) | **Off by default** — enable in Settings → Engines |
| **Tor (Ahmia)** | HTML scraping | CORS proxy | **Off by default** — policy-compliant .onion search |

Precommunity ads are a separate backend-resolved placement, not a `SearchProvider`.

### Dynamic SearXNG Instance Pool (searxist-style)

Instead of a hardcoded instance list, the SearXNG provider uses a **self-healing dynamic pool** (inspired by [searxist](https://codeberg.org/searxist)):

```
┌── Tier 1: Custom ──────┐   Your self-hosted / trusted instances (always first)
├── Tier 2: Discovered ──┤   ON BY DEFAULT. Live from searx.space, privacy-
│                        │   filtered: no analytics • clearnet • ≥80% success.
│                        │   Top 4 auto-activated — language-aware when a
│                        │   result language filter is set; the rest standby.
└── Tier 3: Bootstrap ───┘   Hardcoded seeds — cold-start only (until the
                             first discovery lands) or when discovery is off
```

- **Discovery is on by default** — the pool refreshes from [searx.space](https://searx.space) every 24h, client-side; flip it off in Settings → SearXNG to run the fixed bootstrap set only
- **Auto-picked active set** — the top 4 discovered instances run; the rest sit on standby in Settings, one click to force-enable
- **Language-aware picking** — the result language filter (Settings → General, defaults to your browser language, English fallback) flows to SearXNG/Brave/Wikipedia server-side and filters the SIP-01 index by its `l` tag; instances that prove they serve your languages rank first
- **Health tracking** — per-instance success/failure/latency stats in localStorage; failing instances sink, fast ones rise
- **One-click control** — enable/disable any instance (custom, discovered, or bootstrap) with a click in Settings; remove customs entirely
- **Self-hosting friendly** — add your own instance in Settings and it runs first on every search

Bootstrap pool (cold start / discovery off): `search.bus-hit.me`, `baresearch.org`,
`search.ononoki.org`, `ooglester.com`, `searxng.site`, `search.mectov.my.id`,
`search.im-in.space`.
- **Zero backend** — discovery, health, and ranking all happen in the browser

### Incremental Results

All providers run in parallel — web engines first (Brave when a key is set,
else DuckDuckGo leads, SearXNG as the fallback band), then the community
index. The UI shows live status:
```
✔ DuckDuckGo (480ms)  ✔ SearXNG (640ms)  ✔ Index (80ms)  ⏳ Brave...
```

Results render **the instant each provider resolves** — no waiting for the
slowest. And **Settings → Search Engines** lets you turn any engine off with a
click (including the index providers) — off engines never run, never see your
query.

### Voting & Reporting

Every result card carries 👍/👎 votes and a report flag:

- **Votes** are NIP-25 reactions (kind 7, `e` tag for events, `r` tag for URLs —
  SIP-01-normalized so the same page tallies together). **Anonymous by default**:
  signed by this device's built-in indexing identity, never your npub. Flip
   "Vote with my npub" in Settings → Auto Indexer to vote attributably.
- **Reports** are NIP-56 kind 1984 events — from the Policy page or any result
  card's flag — landing in the team's `/admin` inbox for one-click moderation.

### Query Classification

The search bar understands what you typed and routes accordingly:

| Input | What happens |
|-------|--------------|
| `15% of 80` | Calculator instant answer — **no providers run at all** |
| `npub1…` / `note1…` / `naddr1…` | Profile/event instant card — clearnet engines never see it |
| `name@domain.tld` | NIP-05 resolution to a profile card |
| `https://example.com/page` | SIP-01 index lookup ("observed by N indexers") + open-link card — only Nostr-tier providers run |
| anything else | Full provider fan-out, punctuation-insensitive + plural-folding matching |

Provider skipping isn't just speed — it's privacy: a NIP-19 identifier or URL never
leaves for a third-party engine.

### Structured query engine

The search bar parses real search syntax into a structured form
(`src/lib/queryParser.ts`) and executes it **locally and authoritatively**
(`src/lib/queryEngine.ts`) — operators are never "stripped and hoped for":

```
nostr privacy                              both words, order-free
"decentralized search"                     exact phrase — ranked above loose matches
nostr AND privacy                          explicit boolean (UPPERCASE; lowercase stays text)
nostr OR bitcoin                           either
nostr NOT twitter                          exclusion ("nostr -twitter" works too)
nostr AND (privacy OR decentralization)    parentheses, correct precedence
site:github.com                            host + subdomains (never evilgithub.com)
domain:github.com                          exact host only
title:"Nostr relay"                        title-only search (phrase or words)
type:pdf / type:repository                 SIP-01 type/mime metadata
lang:de                                    language (unknown language passes through)
tag:nostr                                  exact topic tag (never "nostr-tools")
before:2026-08-01 / after:2026-01-01       published/observed date boundaries
nostr privacy site:github.com lang:en      everything combines
```

NIP-50 relays still receive the raw query as an *acceleration hint*, but every
candidate is re-evaluated against the parsed AST locally — a relay that
misunderstands `site:` cannot answer it wrong. Engines that natively support
an operator get it (DuckDuckGo/Brave/SearXNG understand `site:`; `lang:` is
translated to their language parameters); engines that don't get the text
residue, and the merge layer enforces the filters on whatever returns. The
results page shows the parsed interpretation as "Understood as:" chips.
Full guide: [docs/SEARCH-QUERIES.md](docs/SEARCH-QUERIES.md).

---

## Team Console (`/admin`)

A hidden, role-gated dashboard. Not linked in navigation — team members see an
"Admin console" entry in their account dropdown when logged in with a team key.

Roles (resolved live from owner-signed kind 30078 role lists, relay-finder pattern):

| Role | Access |
|------|--------|
| **Owner** | Everything, incl. the Roles tab (add/remove admins & moderators) |
| **Admin** | Stats, Reports, Moderation, Filter test |
| **Moderator** | Stats, Reports, Moderation, Filter test |

- **Stats** — indexed pages, cached queries, archived keyword stakes, open reports, relay pool sizes
- **Reports** — the NIP-56 abuse inbox (kind 1984, `0xsearchstr.abuse` namespace),
  one-click "hide from results"
- **Moderation** — team-signed NIP-32 labels (kind 1985, `0xsearchstr.moderation`)
  hide URLs/event ids from **every user's** results; un-hiding publishes a NIP-09
  deletion. Clients trust labels from the owner + role-list pubkeys only.
- **Roles** (owner) — add/remove admins and moderators by npub or hex; lists are
  addressable events (`presearchstr:admin-roles` / `presearchstr:mod-roles`)
- **Filter test** — check whether a URL or event id is currently filtered

---

---

## Relay Pools

Four default pools, all **fully user-editable** in Settings — hide any default
(restorable) or add your own. The search and index pools additionally grow by
**auto-discovery** (on by default): NIP-66 announcements (kind 30166, `#N: 50`)
supply candidates, and each candidate's NIP-11 document is verified before it
joins — `supported_nips` must list 50 for the search pool, and the SIP-01
`uncaged_index` block earns a spot in the index pool. Verification probes pause
in Privacy Mode.

The layout is an explicit model (`RELAY_LAYOUT` in `src/lib/appRelays.ts`) —
every relay has a reason for being used, reads are resilient, writes are
controlled:

```
indexRead / indexWrite   SIP-01 index pool — observations and submissions;
                         legacy cache and keyword stakes remain readable
searchRead               NIP-50 full-text pool (read-only — nothing is written)
controlRead / Write      app control plane (moderation labels, role lists,
                         abuse inbox) = index + search pools + app defaults
gitRead / wikiRead       specialized read-only pools (NIP-34 / NIP-54)
discovery                NIP-66 bootstrap relays feeding auto-discovery
fallback                 APP_RELAYS — login/NIP-46 handshake + NIP-65 defaults
```

Identity and namespaces are centralized in `src/lib/appProfile.ts`
(`APP_PROFILE`): the engine's appId/namespace, the SIP-01 indexer source id,
the app-specific control namespaces (`presearchstr.*`), and the fork-family
federation namespaces (`0xsearchstr:*` protocol data, shared by design).

| Pool | Purpose | Defaults |
|------|---------|----------|
| **Index Relays** | Where the community index lives — SIP-01 observations (kind 39697) and community submissions are published and read; legacy query cache and archived keyword stakes remain readable. Every browser running the app can be an indexing node; this is its peer list. | `relay-na1.metanomalist.com` (NIP-50 + NIP-77 index relay), the UNCAGED SIP cluster (`test-sip-relay.sip-01test`, `sip-relay-2.sip-booster-relay`, `sip-relay-3.uncaged-sip`, `sip-relay-4.sip-relay-4` — serverless SIP-01 index relays), `relay.ditto.pub`, `jskitty.cat/nostr`, `search.nos.today`, `relay.primal.net` + auto-discovered SIP-01 relays |
| **Search Relays** | NIP-50 full-text Nostr search (read-only) | `relay.ditto.pub`, `relay-na1.metanomalist.com`, the UNCAGED SIP cluster, `relay.nostr.band`, `search.nos.today`, `relay.noswhere.com`, `relay.pocketnostr.com` + auto-discovered NIP-50 relays |
| **Git Relays** | NIP-34 repos/issues/PRs/patches for the Code tab (read-only) | `ngit.danconwaydev.com`, `gitnostr.com`, `relay.ngit.dev`, `indexer.coracle.social`, `index.ngit.dev`, `git.shakespeare.diy` |
| **Wiki Relays** | NIP-54 wiki articles (read-only) — the pool wikistr reads | `relay.wikifreedia.xyz`, `nostr.wine`, `nostr21.com` |

---

## Themes

Two core themes, both Presearch-branded: **Dark** (default) is dodger blue
(`#2D8EFF`) on deep navy with a horizon glow; **Light** is the same blue on clean
white. The retro Hacker theme hides behind a small "hacker mode?" toggle in
Settings → Appearance.

---

## Search Tabs

The tab bar is **fully modular** — Settings → Search Tabs lets every user pick which
tabs show, drag them into their own order, and star the tab a fresh visit starts on.

| Tab | Sources | Default |
|-----|---------|---------|
| **Web** | Web Index (SIP-01) + Community + SearXNG + DuckDuckGo + Brave (BYOK); separate Precommunity ad | ✅ visible, **default tab** |
| **Index** | The community index only — SIP-01 observations + legacy cache | ✅ visible |
| **All** | All providers merged + ranked; separate Precommunity ad | ✅ visible |
| **Nostr** | Profiles, notes, articles, Wikifreedia, files | ✅ visible |
| **News** | Hacker News stories | ✅ visible |
| **Wiki** | Nostr wiki articles (NIP-54, wikistr relay pool); Wikipedia engine off until enabled | ✅ visible |
| **Code** | Git repos/issues/PRs (NIP-34 via ngit/GRASP) + NIP-C0 snippets; Stack Overflow off until enabled | ✅ visible |
| **Tor** | .onion hidden services via Ahmia | off — enable in Settings |
| **I2P** | Eepsite directory links | off — enable in Settings |

Deep links (`/?source=tor&q=…`) keep working even for hidden tabs.

Query matching is phrase-aware: client-side providers tokenize punctuation-insensitively,
tolerate stop words ("the best wallet" ≈ "best wallet"), fold plurals ("wallets" matches
"wallet"), and never literal-match NIP-50 operators like `site:` or `lang:`. A gutting
guard keeps multi-word queries honest — when stop-word removal shrinks "how to build" to
one keyword, a document must match a second query word or the full phrase, and a relevance
score (word coverage + phrase/title bonuses) ranks what survives.

The merged result list is then **coverage-ranked**: every result is reweighted by how many
of your words it actually contains — 50% title, 50% body (snippet + domain + tags + full
article text for Nostr-backed results). All four words of "walk in the park" beats three
beats two beats one; loose engine hits with zero word overlap sink to the bottom.
Precommunity ads never enter this ranking.

---

## Self-Hosted Backend (Optional)

The `backend/` directory contains a full self-hosted stack for when you want to run your own search infrastructure:

| Service | Description |
|---------|-------------|
| **Meilisearch** | Full-text search index engine |
| **Nostr Crawler** | NIP-01 subscriber indexing kinds 0/1/30023/1063 |
| **Clearnet Crawler** | Polite web crawler (robots.txt, rate-limited) |
| **Tor/I2P Crawler** | Hidden service crawler with content policy enforcement |
| **NIP-50 Relay** | Search relay proxy bridging Meilisearch to Nostr |
| **Abuse API** | REST search API + abuse report management |

```bash
cp .env.example .env   # Edit MEILI_API_KEY + ABUSE_ADMIN_TOKEN
docker compose up -d
```

See the `backend/` directory and [CONTRIBUTING.md](CONTRIBUTING.md) for details.

---

## Content Policy

The self-hosted backend enforces content policy modeled on [Ahmia](https://ahmia.fi). Hard-blocked categories: CSAM, human trafficking, weapons sales, drug marketplace listings. See the Policy page in the app for details.

---

## Protocol

The Nostr schemas this app uses are documented in [NIP.md](NIP.md) and the canonical
[SIP-01 spec](https://github.com/NostrDanish/SIP-01) (local: [docs/SIP-01.md](docs/SIP-01.md)):

- **Web document index** (`widx:*`) — SIP-01, kind 39697, per-device indexer identities
- **Search cache** (`0xsearchstr:cache:*`) — federated auto-index, kind 30078 (legacy, frozen)
- **Term signals** (`0xsearchstr:term:*`) — hashed k-anonymity trending, kind 30078 (no plaintext queries)
- **Community submissions** (`0xsearchstr:submit:*`) — user-curated links, kind 30078
- **Keyword stakes** (`0xsearchstr:stake:*`) — historical archive, kind 30078; search placement retired
- **Nostra Search interop** (read-only) — including NOSTRA_ENC_V1 payloads

We also read/write existing NIPs wherever they fit instead of inventing formats:
wiki articles (NIP-54), torrents (NIP-35), code snippets (NIP-C0), web bookmarks
(NIP-B0), abuse reports (NIP-56, from the Policy page), content warnings (NIP-36),
media attachments (NIP-92), relay lists (NIP-65). Full matrix in [NIP.md](NIP.md).

---

## AI Answers (Optional — BYOK + engine-provided)

An optional **AI Answer layer** sits on top of the search federation — off by
default, fully user-controlled:

```
Search federation (SIP-01 + web engines)
        │
        ▼
  Evidence pack (top results, numbered)
        │
        ▼
  AI synthesizes an answer with [n] citations
        │
        ▼
  Displayed above results — ephemeral, NEVER indexed into SIP-01
```

**Credential precedence (exactly):**

```
User's own key (Settings → AI)   ← always wins; stored only in their browser
        ↓
Engine-provided AI (/api/ai)     ← operator's key, server-side only (worker)
        ↓
Built-in free tier               ← shared rate-limited PPQ key, locked model,
                                   public by design (ships in the bundle)
        ↓
AI unavailable                   ← only for forks that remove the built-in key
```

- **AI works out of the box** — the built-in tier gives every user free
  answers with zero setup (PPQ.ai, `qwen/qwen-2.5-7b-instruct`, locked on this
  tier). Its key is **public and rate-limited by design** — it ships in the
  bundle, and abuse is bounded by the key's own limits. Operators who want a
  *private* key use the engine tier below (it overrides the built-in one).
- **No secret API key ships in this repository** for the engine tier — the
  operator's key lives only in worker env/KV. Forks can empty
  `COMMUNITY_AI_KEY` in `src/lib/aiConfig.ts` to disable the built-in tier.
- **User-provided (BYOK)** — any OpenAI-compatible API:
  [PPQ.ai](https://ppq.ai/invite/949880ca) (pay-per-prompt, Lightning-native),
  OpenRouter, OpenAI, Ollama (local), or a custom endpoint. Provider, endpoint,
  and model unlock the moment a key is pasted; removing the key returns to the
  engine tier. The key never leaves the device except in requests to the
  chosen provider.
- **Engine-provided** — the operator configures provider/model/key in
  **Admin → AI** (or via worker env vars). Users on this tier call the
  same-origin `/api/ai` proxy with **no key** — the worker injects the
  operator's key upstream. The key is never in the frontend bundle,
  localStorage, logs, or any API response (status returns only a masked
  4-char tail for the admin UI). The UI labels the active tier:
  "Using engine-provided AI" vs "Using your own AI provider".
- **Evidence, not vibes** — the model answers ONLY from the supplied results,
  with clickable [n] citations linking back to the actual sources
- **Privacy boundaries hold** — AI runs only on plain-text queries; NIP-19/05,
  URLs, and math keep their deterministic paths. Nostr results are excluded from
  evidence unless you opt in (Settings → AI)

The `AIProvider` interface (`src/lib/ai/`) mirrors the search `SearchProvider`
registry — add a provider in one file and it works.

### Operator setup: Precommunity keyword ads

Use the included `worker.ts` and `wrangler.jsonc`. Configure the API key as a
Cloudflare secret, then build and deploy:

Deploying the frontend's `dist/` through Shakespeare does not deploy this
repository's `worker.ts`. The existing hosting/backend operator must configure
`KEYWORD_MARKET_API_KEY` and deploy the Worker. If it uses a separate domain, the
frontend operator can point the build's non-secret `VITE_ENGINE_API_BASE` at that
backend's `/api/ai` URL. This is an operator handoff; site users do not need to
sign in to Cloudflare or create a hosting account.

```bash
npx wrangler@4 secret put KEYWORD_MARKET_API_KEY
npm run build
npx wrangler@4 deploy
```

Wrangler prompts for the secret; never put its value in source, `wrangler.jsonc`,
`VITE_*`, logs, or frontend responses. The worker routes `/api/*` before static
assets, validates the ad response, allows only HTTPS links, applies a five-second
timeout and a separate limit of 20 ad requests per minute per IP, and responds
with `Cache-Control: no-store`.

On `presearchstr.com` and `www.presearchstr.com`, the existing static frontend
calls `https://presearchstr.presearchstr.workers.dev/api/ads/precommunity`.
Other hosts use same-origin `/api/ads/precommunity`. Forks with a separate worker
can set the non-secret build variable
`VITE_ENGINE_API_BASE=https://your-worker.workers.dev/api/ai`; ads derive their
`/api/ads` base from the same setting. Allow the frontend origin in the worker's
existing CORS configuration. The static frontend deployment process is unchanged.

Missing configuration or an ad lookup failure shows the marketplace invitation
after the lookup finishes; organic search continues independently.

### Operator setup: engine-provided AI

Requires deploying with the included worker (`worker.ts` — Cloudflare Workers
path, static assets included):

```bash
# 1. The provider key — a server secret, never committed:
wrangler secret put AI_API_KEY

# 2. Non-secret vars live in wrangler.jsonc (OWNER_PUBKEY enables Admin → AI):
#    AI_PROVIDER_ENDPOINT / AI_MODEL / AI_PROVIDER_NAME / AI_ENGINE_ENABLED

# 3. Optional: let the Admin tab manage config at runtime (no redeploys):
wrangler kv namespace create AI_CONFIG_KV
#    …paste the id into the kv_namespaces binding in wrangler.jsonc

wrangler deploy
```

Admin writes are authenticated with a NIP-98-style signed event from
`OWNER_PUBKEY` — no accounts or passwords. Without KV, env vars are the config
(admin tab shows status, edits need a redeploy). Without either, the proxy
reports "not configured" and everything else keeps working.

### Operator setup: engine-provided search keys (Brave / Parallel)

The same worker can hold the Brave and/or Parallel API keys server-side so
**every** user gets those engines with zero BYOK setup — the browser only
talks same-origin, and no key is ever in the bundle, localStorage, or any
response (this is the 0xSigner-shaped delegation surface):

```bash
wrangler secret put BRAVE_API_KEY      # enables /api/search/brave
wrangler secret put PARALLEL_API_KEY   # enables /api/search/parallel
wrangler deploy
```

`GET /api/search/status` reports which engines are configured (booleans only).
A user's own BYOK key always takes precedence over the engine tier. Static
deployments (no worker) report unconfigured and everything stays BYOK.

---

## Tech Stack

- **React 19** + TypeScript + Vite
- **TailwindCSS 4** + shadcn/ui
- **Nostrify** — NIP-50 relay search
- **SearXNG** — meta-search fallback
- **Wikipedia** — MediaWiki API
- **Hacker News** — Algolia search
- **TanStack Query** — data fetching + caching
- **Optional AI** — [PPQ.ai](https://ppq.ai/invite/949880ca) + any OpenAI-compatible API

---

## License

MIT

---

*AI powered by [PPQ.ai](https://ppq.ai/invite/949880ca) (supports the project)*
