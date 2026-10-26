// Sentence embeddings computed locally (no paid API) with transformers.js.
// Model: paraphrase-multilingual-MiniLM-L12-v2 -> 384-dimensional vectors,
// trained on 50+ languages so "doodh", "milk" and "paal" land close together.
// The model (~120 MB) downloads once on first use and is cached on disk.

const MODEL = process.env.EMBEDDING_MODEL || 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';
export const EMBEDDING_DIM = 384;

const g = globalThis;

async function getExtractor() {
  if (!g.__hisaabExtractor) {
    g.__hisaabExtractor = import('@huggingface/transformers').then(({ pipeline }) =>
      pipeline('feature-extraction', MODEL, { dtype: 'q8' })
    );
  }
  return g.__hisaabExtractor;
}

/**
 * Embed one or more texts. Returns number[][] (L2-normalised, so cosine = dot product),
 * or null if embeddings are disabled / the model could not load - callers then fall back
 * to full-text + fuzzy search only.
 */
export async function embed(texts) {
  if (process.env.EMBEDDINGS_DISABLED === '1') return null;
  const list = Array.isArray(texts) ? texts : [texts];
  if (!list.length) return [];
  try {
    const extractor = await getExtractor();
    const output = await extractor(list, { pooling: 'mean', normalize: true });
    return output.tolist();
  } catch (e) {
    g.__hisaabExtractor = null;
    console.warn('[embeddings] unavailable, using text search only:', e.message);
    return null;
  }
}

export async function embedOne(text) {
  const v = await embed([text]);
  return v ? v[0] : null;
}

/** pgvector literal: [0.12,-0.03,...] */
export function toPgVector(vec) {
  return vec ? `[${vec.map((x) => Number(x).toFixed(6)).join(',')}]` : null;
}

/** The text that represents a product in vector space. */
export function productEmbeddingText({ name, brand, size_label, category, aliases = [] }) {
  return [name, brand, size_label, category, aliases.length ? `also called ${aliases.join(', ')}` : '']
    .filter(Boolean)
    .join(' | ');
}
