import { pipeline, env } from '@xenova/transformers';

env.allowLocalModels = false;
env.useBrowserCache = false;

async function test() {
  const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  const output = await extractor('This is a test.', { pooling: 'mean', normalize: true });
  console.log(output.data.length);
}
test().catch(console.error);
