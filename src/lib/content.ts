import { ArticleSchema } from './editorial';
const files = import.meta.glob('../../content/{insights,promotions}/*.json', {
  eager: true,
  import: 'default',
});
// Temporal/integrity checks run at build time; a visitor's incorrect clock must not crash the app.
export const articles = Object.values(files)
  .map((value) => ArticleSchema.parse(value))
  .sort((a, b) => b.reportDate.localeCompare(a.reportDate) || a.slug.localeCompare(b.slug));
