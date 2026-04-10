import { main } from './migrate.js';

main().catch((error) => {
  console.error('[migrate:mongo] Fatal error:', error.message);
  process.exit(1);
});
