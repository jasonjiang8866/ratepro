import { readArticles } from './build-editorial';
console.log(
  `Validated ${readArticles().length} editorial records. Rate observations are separate.`,
);
