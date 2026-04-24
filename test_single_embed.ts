import { GoogleGenAI } from '@google/genai';

console.log('Key:', process.env.GEMINI_API_KEY ? 'exists' : 'missing');

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || 'fake' });
async function run() {
  try {
     const single = await ai.models.embedContent({
        model: 'text-embedding-004',
        contents: 'hello'
     });
     console.log('Single returned successfully. Vector length:', single.embeddings?.[0]?.values?.length);
  } catch(e: any) {
     console.error('Embed error:', e.message);
  }
}
run();
