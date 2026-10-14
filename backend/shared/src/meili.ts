import { MeiliSearch, type Index } from 'meilisearch';
import type { SearchDocument } from './types.js';

const MEILI_HOST = process.env.MEILI_HOST || 'http://localhost:7700';
const MEILI_API_KEY = process.env.MEILI_API_KEY || '';
const INDEX_NAME = process.env.MEILI_INDEX || '0xsearchstr';

let clientInstance: MeiliSearch | null = null;

/** Get or create the Meilisearch client singleton. */
export function getMeiliClient(): MeiliSearch {
  if (!clientInstance) {
    clientInstance = new MeiliSearch({
      host: MEILI_HOST,
      apiKey: MEILI_API_KEY,
    });
  }
  return clientInstance;
}

/** Get the primary search index, creating it if necessary. */
export async function getSearchIndex(): Promise<Index<SearchDocument>> {
  const client = getMeiliClient();

  try {
    return await client.getIndex<SearchDocument>(INDEX_NAME);
  } catch {
    // Index doesn't exist — create and configure it.
    await client.createIndex(INDEX_NAME, { primaryKey: 'id' });
    const index = client.index<SearchDocument>(INDEX_NAME);

    // Configure searchable attributes (order = priority).
    await index.updateSearchableAttributes([
      'title',
      'content',
      'summary',
      'author_name',
      'tags',
      'domain',
    ]);

    // Filterable attributes for faceted search.
    await index.updateFilterableAttributes([
      'source',
      'kind',
      'pubkey',
      'domain',
      'language',
      'tags',
      'timestamp',
    ]);

    // Sortable attributes.
    await index.updateSortableAttributes([
      'timestamp',
      'reply_count',
      'repost_count',
      'reaction_count',
      'zap_total_msats',
    ]);

    // Facets exposed to frontend.
    await index.updateFaceting({ maxValuesPerFacet: 100 });

    // Ranking rules: custom ranking boosts engagement signals.
    await index.updateRankingRules([
      'words',
      'typo',
      'proximity',
      'attribute',
      'sort',
      'exactness',
      'zap_total_msats:desc',
      'reaction_count:desc',
      'reply_count:desc',
    ]);

    // Pagination settings.
    await index.updatePagination({ maxTotalHits: 5000 });

    return index;
  }
}

/** Add or update documents in the search index. */
export async function indexDocuments(docs: SearchDocument[]): Promise<void> {
  if (docs.length === 0) return;
  const index = await getSearchIndex();
  await index.addDocuments(docs, { primaryKey: 'id' });
}

/** Remove documents by their IDs. */
export async function removeDocuments(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const index = await getSearchIndex();
  const task = await index.deleteDocuments(ids);
  const completed = await index.waitForTask(task.taskUid, { timeOutMs: 30_000 });
  if (completed.status !== 'succeeded') throw new Error('Index deletion did not succeed');
}

/** Search the index with filters. */
export async function searchIndex(
  query: string,
  options?: {
    filter?: string;
    sort?: string[];
    limit?: number;
    offset?: number;
    facets?: string[];
  },
) {
  const index = await getSearchIndex();
  return index.search(query, {
    limit: options?.limit ?? 20,
    offset: options?.offset ?? 0,
    filter: options?.filter,
    sort: options?.sort,
    facets: options?.facets ?? ['source', 'kind', 'tags'],
    attributesToHighlight: ['content', 'title', 'summary'],
    highlightPreTag: '<mark>',
    highlightPostTag: '</mark>',
  });
}
