export interface PropDefinition {
  name: string;
  type: string;
  optional: boolean;
}

export interface ComponentSignature {
  name: string;
  filePath: string;
  relativePath: string;
  imports: string[];
  props: PropDefinition[];
  jsxTags: string[];
  jsxDepth: number;
}

export interface ComponentsManifest {
  scannedAt: string;
  srcDir: string;
  components: ComponentSignature[];
}

export interface ComponentEmbedding {
  name: string;
  filePath: string;
  relativePath: string;
  vector: number[];
  textRepresentation: string;
  /** SHA-256 (first 16 hex chars) of the source file at embed time. Used for cache invalidation. */
  fileHash?: string;
}

export interface ComponentsEmbeddings {
  embeddedAt: string;
  model: string;
  components: ComponentEmbedding[];
}

export interface SimilarityPair {
  nameA: string;
  fileA: string;
  nameB: string;
  fileB: string;
  score: number;
}

export interface SimilarityCluster {
  representative: string;
  members: string[];
  avgScore: number;
  suggestion: string;
}

export interface ComponentsSimilarity {
  comparedAt: string;
  threshold: number;
  totalComponents: number;
  pairsAboveThreshold: number;
  pairs: SimilarityPair[];
  clusters: SimilarityCluster[];
}
