import { run } from './main';

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
