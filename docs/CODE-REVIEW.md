# Presearchstr Code Quality Audit

The repository contains a Nostr client with federated search, a public web index, moderation, and optional AI answers. The optional backend includes crawlers, Meilisearch, a search relay, and a reports API. This audit assumes a public instance with multiple users and untrusted data from relays and websites.

**Status after fixes: all 19 audit findings have been addressed, and full validation passes.** The original review identified vulnerabilities, privacy and permission failures, incorrect search results, and broken validation. The fixes cover existing features and trust boundaries.

Original audit baseline: commit `642d588ed59c6910668f52e48bff72f92e41a302`. Audit and fix date: October 13, 2026. The review covered the entire repository. The descriptions below preserve the findings before the fixes; the current status and verification results appear at the end of this document.

P1 indicates an issue requiring an urgent fix. P2 indicates a concrete defect requiring a fix in the affected feature. Backend findings apply when running the optional server stack.

## Issues Requiring Urgent Fixes

### 1. P1 The clone command can execute code controlled by the event author

Location: [RepoView.tsx:252](/Users/admin/Desktop/newpresearch/0xPresearchstr/src/components/RepoView.tsx:252).

- **Feature:** the repository view generates and copies a `git clone` command from a public Nostr `clone` tag.
- **Problem:** the URL is inserted without quoting the shell argument. The sanitizer accepts `https://example.com/$(id)`, so pasting the command into a terminal also executes the `$(id)` substitution. The event author controls this part of the URL.
- **Smallest fix:** copy only the URL, or correctly quote the argument, including handling apostrophes, and add `git clone --`.
- **Impact if left unfixed:** a user running the command suggested by the application may execute code controlled by the event author. The audit inspected the generated text; it did not execute the command containing the substitution.

### 2. P1 Privacy Mode does not prevent queries from being sent to AI

Location: [useAIAnswer.ts:88](/Users/admin/Desktop/newpresearch/0xPresearchstr/src/hooks/useAIAnswer.ts:88), called from [Index.tsx:151](/Users/admin/Desktop/newpresearch/0xPresearchstr/src/pages/Index.tsx:151).

- **Feature:** AI receives the search query and a source bundle from the results.
- **Problem:** the activation condition does not read `privacyMode`. With AI enabled and two Web Index results, AI still runs in Privacy Mode; these results have `source: 'web'`, so disabling `includeNostr` does not remove them. A probe using the actual hook confirmed an active request with two sources.
- **Smallest fix:** include Privacy Mode in the activation condition and cancel an ongoing query when Privacy Mode is enabled.
- **Impact if left unfixed:** the query and results reach an AI provider or an external proxy despite the settings message stating “no clearnet APIs, no CORS proxies.”

### 3. P1 Revoked moderator permissions can remain active

Location: [useAdminAccess.ts:51](/Users/admin/Desktop/newpresearch/0xPresearchstr/src/hooks/useAdminAccess.ts:51).

- **Feature:** the application merges owner-signed administrator and moderator lists from multiple relays.
- **Problem:** it ignores `created_at` and prefers a nonempty list. An older list containing a moderator remains active even after a newer `[]` event revokes all permissions. A probe using timestamps 100 and 200 confirmed the defect for both relay response orders.
- **Smallest fix:** select the latest valid owner event for each `d`, including an empty list, and resolve timestamp ties deterministically.
- **Impact if left unfixed:** a removed team member retains console access, and their moderation signatures remain trusted.

### 4. P1 An invalid index observation can hide a valid page

Location: [web-index.ts:160](/Users/admin/Desktop/newpresearch/0xPresearchstr/src/lib/providers/web-index.ts:160), with the latest-event selection at line 74 in the same file.

- **Feature:** page observations are grouped by document identifier `d`, and the latest observation represents the page.
- **Problem:** identifier-to-URL integrity is checked after grouping and only for the selected event. An attacker-signed event with another page's `d`, a different URL, and a newer timestamp displaces the valid event; rejecting it removes the entire page from the results. A probe using the actual provider and signed events changed one valid result into an empty list.
- **Smallest fix:** verify each observation's integrity before grouping, calculating agreement, and ranking.
- **Impact if left unfixed:** a public event author can remove legitimate documents from search results without moderator permissions.

### 5. P1 One malformed message can crash the backend relay

Location: [backend/nip50-relay/src/index.ts:164](/Users/admin/Desktop/newpresearch/0xPresearchstr/backend/nip50-relay/src/index.ts:164).

- **Feature:** the public relay receives WebSocket `REQ` messages and queries the index.
- **Problem:** `['REQ', 'x', null]` reaches `handleReq`, which reads `filter.search` outside its error handler. The rejected promise is ignored. Running the actual handlers in an isolated Node 22 process terminated the process with exit code 1.
- **Smallest fix:** validate message and filter structures before calling the handler, and handle rejections from `handleReq`.
- **Impact if left unfixed:** an unauthenticated client can interrupt search for every user of that relay.

### 6. P1 The backend crawler can fetch private network resources

Location: [backend/clearnet-crawler/src/index.ts:125](/Users/admin/Desktop/newpresearch/0xPresearchstr/backend/clearnet-crawler/src/index.ts:125), with link discovery starting at line 188.

- **Feature:** the crawler fetches pages and queues discovered links and sitemap entries.
- **Problem:** it accepts arbitrary HTTP/HTTPS URLs and automatically follows redirects without checking for private addresses. A page controlled by someone else can direct it to loopback or private services on the server's network. A probe with mocked fetching confirmed that HTML from a private address was accepted.
- **Smallest fix:** reject loopback, private, and link-local addresses after DNS resolution; repeat the check for every redirect and every fetch, including robots.txt and sitemaps.
- **Impact if left unfixed:** the crawler can read private services it can reach, and the retrieved HTML can enter the public index. This is SSRF: an external page causes a request to be made from the server's network.

### 7. P1 The backend confirms content removal even when deletion fails

Location: [backend/abuse-api/src/index.ts:171](/Users/admin/Desktop/newpresearch/0xPresearchstr/backend/abuse-api/src/index.ts:171).

- **Feature:** an administrator marks a report as `removed`, and the API deletes the document from Meilisearch.
- **Problem:** the status is set before deletion; a deletion error is only logged. The API persists `removed` and returns HTTP 200 even when the index is unavailable. A mocked `removeDocuments` failure confirmed both behaviors.
- **Smallest fix:** persist completed removal only after the index confirms that the operation has finished; return a retryable state on failure.
- **Impact if left unfixed:** the moderator receives a false confirmation while the reported content remains available.

### 8. P1 Full repository validation is broken

Location: [privacy.test.tsx](/Users/admin/Desktop/newpresearch/0xPresearchstr/src/lib/privacy.test.tsx), previously `privacy.test.ts`, [TestApp.tsx:23](/Users/admin/Desktop/newpresearch/0xPresearchstr/src/test/TestApp.tsx:23), and the scripts in `package.json`.

- **Feature:** `npm test` is intended to check types, lint, tests, and the build.
- **Problem:** JSX was placed in a `.ts` file, preventing TypeScript and the test runner from parsing it. Temporarily excluding that file for diagnosis reveals 18 additional TypeScript diagnostics, including an incomplete `AppConfig` in TestApp, a nonexistent `AbuseReport` export, and an incompatible `index` tab type. The login test crashes because its fixture lacks `disabledProviders`; two existing search tests also fail.
- **Smallest fix:** rename the JSX file to `.tsx`, complete the TestApp configuration, fix the remaining type errors, and make tests and lint pass. Run this validation in the deployment workflow; GitHub Pages currently runs only the build.
- **Impact if left unfixed:** a successful build gives false confidence. New features have no reliable regression checks.

## Other Confirmed Defects

### 9. P2 Team moderation does not work for new logged-out users

Location: [useAdminAccess.ts:35](/Users/admin/Desktop/newpresearch/0xPresearchstr/src/hooks/useAdminAccess.ts:35), [useModeration.ts:51](/Users/admin/Desktop/newpresearch/0xPresearchstr/src/hooks/useModeration.ts:51).

- **Feature:** search results should respect hide actions signed by the owner, administrators, and moderators.
- **Problem:** fetching the trusted team list is disabled when logged out. In a fresh anonymous session, the application trusts only the owner and does not fetch hide actions from other team members.
- **Smallest fix:** fetch public lists of trusted moderators regardless of login status; require login for console access and performing actions.
- **Impact if left unfixed:** content hidden by a moderator remains visible to public visitors.

### 10. P2 Engine AI sends data through external proxies

Location: [corsProxy.ts:61](/Users/admin/Desktop/newpresearch/0xPresearchstr/src/lib/corsProxy.ts:61), [openai-compatible.ts:98](/Users/admin/Desktop/newpresearch/0xPresearchstr/src/lib/ai/openai-compatible.ts:98).

- **Feature:** engine AI should connect directly to the operator's worker.
- **Problem:** on presearchstr.com, the worker URL is absolute. `ENGINE_PROXY_PROVIDER` uses the generic `proxiedFetch`, which routes public absolute URLs through Shakespeare and fallback proxies. The actual provider with mocked fetch sent the query and sources to `proxy.shakespeare.diy`.
- **Smallest fix:** use direct `fetch` for engine AI, preserving the separate behavior of external providers configured by the user.
- **Impact if left unfixed:** additional proxy operators receive the query and source material, and AI answers depend on their availability. This also occurs outside Privacy Mode and is independent of finding 2.

### 11. P2 The AI admin panel sends operations to the wrong URL

Location: [engineAdmin.ts:47](/Users/admin/Desktop/newpresearch/0xPresearchstr/src/lib/ai/engineAdmin.ts:47).

- **Feature:** the admin panel signs requests to save, enable, disable, and delete AI configuration.
- **Problem:** it prepends `location.origin` to an absolute `ENGINE_AI_BASE`. This produces `https://presearchstr.comhttps://presearchstr.presearchstr.workers.dev/api/ai/admin`, with the host `presearchstr.comhttps`; the signed `u` tag also contains the incorrect URL.
- **Smallest fix:** resolve the full URL with ``new URL(`${ENGINE_AI_BASE}/admin`, location.origin).href`` and use it in both the signature and the request.
- **Impact if left unfixed:** AI configuration management from the production domain never reaches the worker.

### 12. P2 A successful AI configuration save appears to fail

Location: [worker.ts:331](/Users/admin/Desktop/newpresearch/0xPresearchstr/worker.ts:331).

- **Feature:** the worker handles signed configuration updates from another domain.
- **Problem:** the successful save response omits `request`, so it receives no CORS header. The actual worker with a test signature and mocked KV returned a valid preflight, saved the data, and then returned HTTP 200 without `Access-Control-Allow-Origin`.
- **Smallest fix:** pass `200, request` to `json` in the success response.
- **Impact if left unfixed:** after fixing the URL in finding 11, the browser still reports an error despite the completed save, and the panel does not refresh its status.

### 13. P2 Distinct pages disappear as supposed duplicates

Location: [useProviderSearch.ts:332](/Users/admin/Desktop/newpresearch/0xPresearchstr/src/hooks/useProviderSearch.ts:332).

- **Feature:** results from different providers are merged and deduplicated by URL.
- **Problem:** the key contains only the hostname and pathname, discarding query parameters, the port, and path case. Two different videos, `youtube.com/watch?v=A` and `?v=B`, become one result. A probe using the actual function confirmed that two videos were reduced to one.
- **Smallest fix:** preserve parameters that identify the document, the port, and path case; reuse the existing `normalizeIndexUrl` for HTTP(S) pages after checking its rules.
- **Impact if left unfixed:** users lose valid results, especially videos and pages identified by query parameters.

### 14. P2 Detecting one engine enables all engines disabled by default

Location: [AppProvider.tsx:124](/Users/admin/Desktop/newpresearch/0xPresearchstr/src/components/AppProvider.tsx:124).

- **Feature:** the application automatically makes Brave or Parallel available to a new user when the operator has configured a server-side key.
- **Problem:** the update uses the raw `cur.disabledProviders ?? []` instead of the default configuration. When no list has been saved yet, the result is `[]`; six default exclusions disappear, including Tor, Wikipedia, and the old cache. A probe of the transformation confirmed an empty list instead of a list with only Brave removed.
- **Smallest fix:** use the current effective list or `defaultConfig.disabledProviders` as the fallback, then remove only the detected engines.
- **Impact if left unfixed:** the All tab, for example, runs additional engines the user has not enabled.

### 15. P2 Engine switches do not update cached search results

Location: [useProviderSearch.ts:158](/Users/admin/Desktop/newpresearch/0xPresearchstr/src/hooks/useProviderSearch.ts:158), with the stream key at line 121.

- **Feature:** settings allow users to enable and disable search providers.
- **Problem:** the active provider list changes, but neither the query key nor the stream key includes it. Returning to the same search within 30 seconds can display the previous result set without running the newly enabled engine. This behavior was confirmed using the installed TanStack Query version.
- **Smallest fix:** include a stable list of active provider identifiers in both keys and discard responses from the previous provider set.
- **Impact if left unfixed:** settings appear to be applied, but displayed results do not match the configuration.

### 16. P2 Switching accounts retains the previous account's relays and upload servers

Location: [NostrSync.tsx:34](/Users/admin/Desktop/newpresearch/0xPresearchstr/src/components/NostrSync.tsx:34), with an equivalent check at line 77.

- **Feature:** after login, relay and Blossom server lists belonging to the current user are synchronized.
- **Problem:** timestamps are compared against one global state shared by all accounts. Logging in as account A with a list timestamp of 200, then account B with a timestamp of 100, causes B's configuration to be rejected. A probe using the actual component with stubs confirmed that no update occurred.
- **Smallest fix:** store these lists and timestamps by pubkey, and cancel the old account's synchronization when switching accounts.
- **Impact if left unfixed:** account B publishes or uploads files to destinations configured by account A.

### 17. P2 One malformed Nostra entry disables the entire Community provider

Location: [communityIndex.ts:286](/Users/admin/Desktop/newpresearch/0xPresearchstr/src/lib/communityIndex.ts:286), [community.ts:78](/Users/admin/Desktop/newpresearch/0xPresearchstr/src/lib/providers/community.ts:78).

- **Feature:** the provider reads public Nostra entries, including JSON payloads encoded as `NOSTRA_ENC_V1:RAW:`.
- **Problem:** JSON is cast to a type without validating its fields. A payload with `title: 42` or an object in `description` triggers a `TypeError` during `.trim()`. The combined `Promise.all` then rejects the entire parsing operation, including valid entries from other families.
- **Smallest fix:** validate decoded JSON as untrusted data and reject individual malformed entries while preserving the others.
- **Impact if left unfixed:** one public event can cause all Community results to disappear for visitors who receive it.

### 18. P2 The page size limit does not cap the data actually downloaded

Location: [backend/clearnet-crawler/src/index.ts:140](/Users/admin/Desktop/newpresearch/0xPresearchstr/backend/clearnet-crawler/src/index.ts:140).

- **Feature:** the crawler is intended to limit pages to approximately 5 MB.
- **Problem:** it checks only the declared `Content-Length`, then reads the entire `res.text()`. Without that header, the limit is bypassed. A probe accepted 6,650,026 characters despite the 5,242,880 limit.
- **Smallest fix:** read the stream with an actual byte limit and cancel the response when the limit is exceeded.
- **Impact if left unfixed:** an external page can force excessive memory use, especially during multiple concurrent fetches.

### 19. P2 Routing does not support the path used by GitHub Pages

Location: [AppRouter.tsx:16](/Users/admin/Desktop/newpresearch/0xPresearchstr/src/AppRouter.tsx:16), [.github/workflows/deploy.yml:47](/Users/admin/Desktop/newpresearch/0xPresearchstr/.github/workflows/deploy.yml:47).

- **Feature:** the workflow builds the project for deployment under `/<repository-name>/`.
- **Problem:** `VITE_BASE` changes asset URLs, but `BrowserRouter` has no `basename`. The actual route matcher treats `/0xPresearchstr/` as a NIP-19 identifier and `/0xPresearchstr/policy` as an unknown route. The first path also ends in a 404 after the identifier is rejected.
- **Smallest fix:** configure the router to match the deployment base and check generated links and the login callback under that base.
- **Impact if left unfixed:** the GitHub Pages deployment loads files, but the home page and subpages do not follow the application's routes. Deployments without a path prefix do not have this particular problem.

## Validation Results Before the Fixes

Dependencies were installed from `package-lock.json` without running package installation scripts. The results below use project dependencies, rather than the older globally installed compiler.

| Check | Result |
| --- | --- |
| `npm run build` | Passes with the default `/` base |
| `npm test` | Fails at the JSX in `privacy.test.ts` |
| TypeScript with that file temporarily excluded for diagnosis | 18 additional diagnostics; no code was changed |
| Standalone Vitest run | 176 tests pass, 3 fail, and one additional file cannot be parsed |
| Standalone ESLint run | 29 errors and 2 warnings across 15 files |

The three failing tests cover login switching with an incomplete TestApp configuration, plural matching for `nostr guides`, and the declared phrase/title/full/partial ranking order. The ranking test alone does not establish whether the algorithm or the expectation should change; the product contract needs to be established. Lint also includes stylistic issues, so its 29 errors do not represent 29 vulnerabilities.

## Fix Plan from the Original Audit

First, restore passing validation and include it in deployment. In parallel, fix the copied terminal command, AI privacy conditions, selection of current permissions, and index observation validation. Before publicly running the backend, fix the relay crash, crawler destination checks, and document removal confirmation.

Next, fix result merging, provider configuration, account switching, and AI admin paths. Add small regression tests for these specific cases. There is no need to start by changing frameworks or splitting the entire repository into new layers.

## Original Audit Scope and Limitations

The review traced the main search flows, parser and ranking, public index, Community, AI, roles and moderation, login and publishing, account synchronization, NIP-19 routing, repository views, active URL rendering, all backend service entry points, shared storage and policy functions, and Docker and CI configuration. Scenarios were reproduced using actual functions or libraries with controlled responses and signed test events.

The original audit did not include a full browser test, a load test, a Docker deployment, or integration with a live Meilisearch instance. It did not check every combination of the 48+ UI primitives or every external service live. No Nostr events were published, and no paid AI requests were made. No confirmed XSS vulnerability was found in the active rendering paths reviewed; finding 1 concerns command text pasted into a terminal.

The original findings showed inconsistent trust boundaries and broken regression checks. The application's structure allowed these issues to be fixed within existing layers.

## Status After the Fixes

| Finding | Fix Applied |
| --- | --- |
| 1 | The clone command quotes its shell argument and uses `--` |
| 2 | Privacy Mode blocks AI and API status requests, cancels ongoing requests, and stops proxy failover on cancellation |
| 3 | Role lists select the latest owner event, including an empty list |
| 4 | Each observation is validated before grouping and calculating agreement |
| 5 | The relay validates messages and filters, limits their size, and handles rejected promises |
| 6 | The crawler checks DNS addresses for public accessibility, pins the accepted connection address, and rechecks redirects |
| 7 | The `removed` status is persisted only after the Meilisearch deletion task succeeds |
| 8 | Types, test configuration, and lint were fixed; the deployment workflow runs the full `npm test` |
| 9 | Public moderation fetches team lists even when logged out |
| 10 | Engine AI connects directly to the worker; cached results also preserve the consent requirement for Nostr sources |
| 11 | The admin operation URL is resolved using `new URL` |
| 12 | The admin success response includes CORS headers |
| 13 | Deduplication preserves meaningful URL parameters, the port, and path case |
| 14 | Automatically enabling an engine preserves other default exclusions and user choices |
| 15 | Cache and stream keys include active providers; old responses cannot change current results |
| 16 | Relay and Blossom settings are stored per account; old synchronization is cancelled and the old pool is closed |
| 17 | Decoded Nostra JSON is validated; a single malformed entry does not disable Community |
| 18 | Limits apply to actual decompressed response bytes; the API also limits its request buffer |
| 19 | The router, login callback, assets, and manifest support the deployment path base |

Plural matching for `guides` was also fixed. The ranking test now distinguishes an actual title phrase from scattered words while preserving production boost rules. Regression cases were added to existing test files. All backend service configurations include shared sources, and `tsx` is available in production installations without downloading it at container startup. The settings header now fits a 360 px screen.

| Verification After the Fixes | Result |
| --- | --- |
| Full `npm test` | Passes: types, lint, 209 tests, and build |
| `VITE_BASE=/0xPresearchstr/ npm test` | Passes: 209 tests and build with the path prefix |
| Backend shared package and all five services | Type checks and builds pass |
| Controlled backend regression checks | Pass: private IP/DNS checks, DNS pinning, redirects, decompressed byte limits, malformed relay messages, and document removal |
| Production backend installations | All five services have a working `tsx` runtime |
| Browser | Home page, settings, and navigation work under the path prefix; widths of 360, 768, and 1280 px were checked |

The Docker stack and integrations with live Meilisearch and paid AI providers were not run. Security checks use controlled responses; no Nostr events were published. The reported blockers have been removed, and working regression checks have been restored before further development.
