// LEGACY WRAPPER — not referenced by any npm script.
// The canonical migration entry point is src/db/migrate.js.
// Run via:  npm run db:migrate   OR   npm run migrate:mongo
// This file is kept only for historical reference and can be deleted.
import { main } from './migrate.js';

main().catch((error) => {
  console.error('[migrate:mongo] Fatal error:', error.message);
  process.exit(1);
});
