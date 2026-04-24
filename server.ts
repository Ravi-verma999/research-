import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import multer from 'multer';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { GoogleGenAI } from '@google/genai';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { EPub } from 'epub2';
import { convert } from 'html-to-text';
import dotenv from 'dotenv';
import { pipeline, env } from '@xenova/transformers';
import { search, SafeSearchType } from 'duck-duck-scrape';
import * as cheerio from 'cheerio';

dotenv.config();

// Setup transformers
env.allowLocalModels = false;
env.useBrowserCache = false;

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Gemini lazily
let aiClient: GoogleGenAI | null = null;
function getAI() {
  if (!aiClient) {
    const key = process.env.GEMINI_API_KEY;
    // Don't throw if empty strictly here, just try to initialize and let API throw if it tries to use it.
    // Google AI Studio injects the key under the hood, but sometimes it might appear empty locally.
    aiClient = new GoogleGenAI(key && key !== 'MY_GEMINI_API_KEY' ? { apiKey: key } : {});
  }
  return aiClient;
}

// Lazy load embedding pipeline
let embedPipeline: any = null;
async function getEmbedder() {
  if (!embedPipeline) {
    console.log("Loading local embedding model (Xenova/all-MiniLM-L6-v2)...");
    embedPipeline = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  }
  return embedPipeline;
}

const app = express();
app.use(express.json());
const PORT = 3000;

// Set up file uploads using memory storage
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

// --- RAG / Vector DB In-Memory Implementation ---

interface Book {
  id: string;
  filename: string;
  text: string;
}

interface Chunk {
  id: string;
  bookId: string;
  bookName: string;
  text: string;
  embedding?: number[];
  model?: 'local' | 'gemini';
}

// In-memory databases
let booksDb: Record<string, Book> = {};
let vectorStore: Chunk[] = [];

// Persistence functions
const DATA_FILE = path.join(process.cwd(), '.data', 'store.json');

function loadStore() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
      booksDb = data.booksDb || {};
      vectorStore = data.vectorStore || [];
      console.log(`Loaded ${Object.keys(booksDb).length} books and ${vectorStore.length} chunks from disk.`);
    }
  } catch (err) {
    console.error("Failed to load store:", err);
  }
}

function saveStore() {
  try {
    const dir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify({ booksDb, vectorStore }));
  } catch (err) {
    console.error("Failed to save store:", err);
  }
}

loadStore();

// Helper: Cosine Similarity
function cosineSimilarity(A: number[], B: number[]) {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < A.length; i++) {
    dotProduct += A[i] * B[i];
    normA += A[i] * A[i];
    normB += B[i] * B[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Helper: Chunk Text
function chunkText(text: string, chunkSize = 1500, overlap = 200) {
  const chunks = [];
  let i = 0;
  while (i < text.length) {
    chunks.push(text.slice(i, i + chunkSize));
    i += chunkSize - overlap;
  }
  return chunks;
}

// API Routes

app.get('/api/health', (req, res) => {
  res.json({ status: 'healthy', storedBooks: Object.keys(booksDb).length });
});

app.get('/api/books', (req, res) => {
  const list = Object.values(booksDb).map(b => ({
    id: b.id,
    filename: b.filename,
    chunks: vectorStore.filter(c => c.bookId === b.id).length
  }));
  res.json(list);
});

app.delete('/api/books/:id', (req, res) => {
  const bookId = req.params.id;
  if (!booksDb[bookId]) return res.status(404).json({ error: 'Book not found' });
  
  delete booksDb[bookId];
  vectorStore = vectorStore.filter(c => c.bookId !== bookId);
  saveStore();
  res.json({ success: true, message: 'Book deleted completely' });
});

// Helper: Ingest Book Buffer
async function ingestBookBuffer(buffer: Buffer, originalname: string, mimetype: string, useLocalModel: boolean) {
  const isEpub = originalname.toLowerCase().endsWith('.epub') || mimetype === 'application/epub+zip';
  const isText = originalname.toLowerCase().endsWith('.txt') || mimetype === 'text/plain';
  let textContent = "";
  let embeddedCount = 0;
  let chunksCount = 0;

  if (isText) {
    textContent = buffer.toString('utf-8');
  } else if (isEpub) {
    try {
      const tempPath = path.join('/tmp', `${uuidv4()}.epub`);
      fs.writeFileSync(tempPath, buffer);
      
      const epub = await EPub.createAsync(tempPath);
      for (const chapter of epub.flow) {
        if (chapter.id) {
          try {
            const chapterText = await epub.getChapterAsync(chapter.id);
            textContent += convert(chapterText) + '\n\n';
          } catch (err) {
            console.warn("Could not read chapter:", chapter.id);
          }
        }
      }
      fs.unlinkSync(tempPath);
    } catch (err) {
      console.error(`EPUB Parse error for ${originalname}:`, err);
      return { embeddedCount: 0, chunksCount: 0, error: "EPUB Parse error" };
    }
  } else {
    // Parse as PDF
    try {
      const data = await pdfParse(buffer);
      textContent = data.text;
    } catch (parseErr) {
      console.error(`PDF Parse error for ${originalname}:`, parseErr);
      return { embeddedCount: 0, chunksCount: 0, error: "PDF Parse error" };
    }
  }

  if (!textContent || textContent.trim().length === 0) {
    console.warn(`Extracted text is empty for ${originalname}. Skipping.`);
    return { embeddedCount: 0, chunksCount: 0, error: "Empty text extracted" };
  }

  const bookId = uuidv4();
  booksDb[bookId] = {
    id: bookId,
    filename: originalname,
    text: textContent
  };

  const chunks = chunkText(textContent);
  console.log(`Generated ${chunks.length} chunks for ${originalname}. Embedding now... (Local: ${useLocalModel})`);
  
  chunksCount = chunks.length;
  // If using local model, limit to 500 chunks. If using Gemini, limit to 15 (as earlier) to prevent rate limits on free tier, or let's allow more if they have a key. Let's limit Gemini to 50 as a safe number.
  const chunksToEmbed = chunks.slice(0, useLocalModel ? 500 : 50); 
  
  if (useLocalModel) {
    try {
      const extractor = await getEmbedder();
      for (const chunkTextContent of chunksToEmbed) {
        const output = await extractor(chunkTextContent, { pooling: 'mean', normalize: true });
        const embeddingArray = Array.from(output.data) as number[];
        
        vectorStore.push({
          id: uuidv4(),
          bookId,
          bookName: originalname,
          text: chunkTextContent,
          embedding: embeddingArray,
          model: 'local'
        });
        embeddedCount++;
      }
    } catch (embErr: any) {
      console.error("Local embedding error:", embErr.message || embErr);
    }
  } else {
    // Gemini Embedding
    for (const chunkTextContent of chunksToEmbed) {
      try {
        const response = await getAI().models.embedContent({
          model: 'text-embedding-004',
          contents: chunkTextContent
        });
        
        vectorStore.push({
          id: uuidv4(),
          bookId,
          bookName: originalname,
          text: chunkTextContent,
          embedding: response.embeddings?.[0]?.values || [],
          model: 'gemini'
        });
        embeddedCount++;
        // Slight pause to not hammer the API too fast
        await new Promise(r => setTimeout(r, 200));
      } catch (embErr: any) {
         console.error("Gemini embedding error:", embErr.message || embErr);
         return { embeddedCount, chunksCount, error: embErr.message || "Gemini API Error" };
      }
    }
  }

  return { embeddedCount, chunksCount, error: null };
}

app.post('/api/upload-book', upload.array('books', 50), async (req, res) => {
  try {
    const files = req.files as Express.Multer.File[];
    const useLocalModel = req.body.useLocalModel === 'true' || req.query.local === 'true';

    if (!files || files.length === 0) return res.status(400).json({ error: "No book files provided." });
    
    let totalEmbedded = 0;
    let totalChunks = 0;
    let globalError = null;
    
    for (const file of files) {
      console.log(`Processing file: ${file.originalname} (${file.size} bytes)`);
      const result = await ingestBookBuffer(file.buffer, file.originalname, file.mimetype, useLocalModel);
      totalEmbedded += result.embeddedCount;
      totalChunks += result.chunksCount;
      if (result.error) {
         globalError = result.error;
         break;
      }
    }
    
    saveStore();

    if (globalError && totalEmbedded === 0) {
      return res.status(400).json({ error: `Upload failed: ${globalError}` });
    }

    let note = `Found ${totalChunks} total chunks across ${files.length} files.`;
    if (totalChunks > totalEmbedded) {
      note += ` Only indexed ${totalEmbedded} chunks limit applied (speed/API constraints).`;
    }

    res.json({ 
      success: true, 
      filesProcessed: files.length,
      chunksIndexed: totalEmbedded,
      totalChunksFound: totalChunks,
      note: note
    });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

app.post('/api/upload-url', async (req, res) => {
  try {
    let { url, useLocalModel } = req.body;
    if (!url) return res.status(400).json({ error: "URL is required" });
    const isLocal = useLocalModel === true || useLocalModel === 'true';

    // Handle generic cloud links if possible
    if (url.includes('dropbox.com') && url.includes('dl=0')) {
      url = url.replace('dl=0', 'dl=1');
    } else if (url.includes('drive.google.com/file/d/')) {
      const match = url.match(/\/d\/([a-zA-Z0-9_\-]+)/);
      if (match && match[1]) {
        url = `https://drive.google.com/uc?export=download&id=${match[1]}`;
      }
    }

    console.log(`Fetching URL: ${url}`);
    const response = await fetch(url.trim());
    if (!response.ok) {
      return res.status(400).json({ error: `Failed to fetch URL. HTTP Status: ${response.status}` });
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    let originalname = url.split('/').pop()?.split('?')[0] || 'downloaded_book';
    const contentDisp = response.headers.get('content-disposition');
    if (contentDisp && contentDisp.includes('filename=')) {
      const match = contentDisp.match(/filename="?([^"]+)"?/);
      if (match) originalname = match[1];
    }
    const mimetype = response.headers.get('content-type') || 'application/pdf';

    if (!originalname.toLowerCase().endsWith('.epub') && !originalname.toLowerCase().endsWith('.pdf')) {
      if (mimetype.includes('epub')) originalname += '.epub';
      else originalname += '.pdf';
    }

    console.log(`Processing fetched URL file: ${originalname} (${buffer.length} bytes)`);
    const result = await ingestBookBuffer(buffer, originalname, mimetype, isLocal);
    
    saveStore();

    if (result.error && result.chunksCount === 0) {
      return res.status(400).json({ error: result.error });
    }

    res.json({ 
      success: true,
      filesProcessed: 1,
      chunksIndexed: result.embeddedCount,
      totalChunksFound: result.chunksCount,
      note: `Fetched and indexed ${result.embeddedCount} chunks from URL.`
    });

  } catch (err: any) {
    console.error("URL upload error:", err);
    res.status(500).json({ error: err.message || "Failed to process URL" });
  }
});

async function learnFromWeb(query: string, useLocalModel: boolean): Promise<boolean> {
  console.log(`Self-Improving: Searching web for "${query}"...`);
  try {
    const searchResults = await search(query, { safeSearch: SafeSearchType.OFF });
    if (!searchResults.results || searchResults.results.length === 0) return false;

    let combinedText = `[Self-Learned Web Knowledge for: ${query}]\n\n`;
    
    // 1. Add quick summaries from DDG
    for (const res of searchResults.results.slice(0, 5)) {
      combinedText += `Source: ${res.title} (${res.url})\nDescription: ${res.description}\n\n`;
    }

    // 2. Perform deep scrape of the top 2 sites
    for (const res of searchResults.results.slice(0, 2)) {
      try {
        console.log(`Scraping detailed page: ${res.url}`);
        const pageReq = await fetch(res.url);
        const html = await pageReq.text();
        const $ = cheerio.load(html);
        $('script, style, nav, footer, header, noscript').remove();
        const pageText = $('body').text().replace(/\s+/g, ' ').trim().substring(0, 3000); // 3000 chars max
        if (pageText.length > 200) {
           combinedText += `\nDeep Dive from ${res.url}:\n...\n${pageText}\n...\n`;
        }
      } catch (err) {
        console.warn(`Could not scrape detailed page ${res.url}`);
      }
    }

    const buffer = Buffer.from(combinedText, 'utf-8');
    const originalname = `Web Search: ${query.substring(0, 30)}.txt`;
    console.log("Ingesting web knowledge...");
    await ingestBookBuffer(buffer, originalname, 'text/plain', useLocalModel);
    saveStore();
    return true;
  } catch (e) {
    console.error("Web learn error:", e);
    return false;
  }
}

app.post('/api/query', async (req, res) => {
  try {
    const { question, useLocalModel } = req.body;
    if (!question) return res.status(400).json({ error: 'Question is required' });
    const isLocal = useLocalModel === true || useLocalModel === 'true';
    const expectedModelType = isLocal ? 'local' : 'gemini';

    let validChunks = vectorStore.filter(c => c.embedding && c.embedding.length > 0 && c.model === expectedModelType);

    // Embed the query
    let queryEmbedding: number[] = [];
    if (isLocal) {
      try {
        const extractor = await getEmbedder();
        const output = await extractor(question, { pooling: 'mean', normalize: true });
        queryEmbedding = Array.from(output.data) as number[];
      } catch (e: any) {
        console.error("Local query embed error:", e);
        return res.status(500).json({ error: 'Failed to generate embedding for query' });
      }
    } else {
      try {
        const queryResponse = await getAI().models.embedContent({
          model: 'text-embedding-004',
          contents: question
        });
        queryEmbedding = queryResponse.embeddings?.[0]?.values || [];
      } catch (e: any) {
        console.error("Gemini query embed error:", e);
        if (e.message?.includes('API key not valid')) {
          return res.status(400).json({ error: 'Invalid Gemini API Key. Switch to Local model or update key.' });
        }
        return res.status(500).json({ error: 'Failed to generate Gemini embedding for query' });
      }
    }
    
    if (!queryEmbedding || queryEmbedding.length === 0) {
      return res.status(500).json({ error: 'Failed to generate embedding for query' });
    }

    // Retrieve Top K
    let scoredChunks = validChunks
      .map(chunk => ({ ...chunk, score: cosineSimilarity(queryEmbedding, chunk.embedding!) }))
      .sort((a, b) => b.score - a.score);

    // SELF LEARNING LOGIC
    let highestScore = scoredChunks.length > 0 ? scoredChunks[0].score : 0;
    if (highestScore < 0.4 || validChunks.length === 0) {
      console.log(`Knowledge confidence low (${highestScore.toFixed(2)}). Engaging Auto-Search...`);
      const learned = await learnFromWeb(question, isLocal);
      
      if (learned) {
        // Refresh validChunks after learning
        validChunks = vectorStore.filter(c => c.embedding && c.embedding.length > 0 && c.model === expectedModelType);
        scoredChunks = validChunks
          .map(chunk => ({ ...chunk, score: cosineSimilarity(queryEmbedding, chunk.embedding!) }))
          .sort((a, b) => b.score - a.score);
      }
    }

    if (scoredChunks.length === 0) {
      return res.status(400).json({ error: "No knowledge available and auto-search failed." });
    }

    const topK = scoredChunks.slice(0, 3);
    
    // Format Context
    const contextStr = topK.map((c, i) => `[Source ${i+1}: ${c.bookName}]\n...\n${c.text}\n...`).join('\n\n');

    if (isLocal) {
      try {
        console.log("Using local QA model...");
        const qaPipeline = await pipeline('question-answering', 'Xenova/distilbert-base-cased-distilled-squad');
        
        let localAnswer = "";
        for (const chunk of topK) {
          const result: any = await qaPipeline(question, chunk.text);
          if (result && result.answer && result.score > 0.05) {
            localAnswer += `According to ${chunk.bookName}:\n"${result.answer}"\n\n`;
          }
        }
        
        if (!localAnswer) {
           localAnswer = "I couldn't find a specific answer in the local documents. Here are the most relevant sections:\n\n" + 
             topK.map(c => `**From ${c.bookName}**: \n\n${c.text.substring(0, 300)}...`).join('\n\n---');
        }

        res.json({
           question,
           answer: "(Answered via Local AI) " + localAnswer,
           sources: topK.map(c => c.bookName)
        });
      } catch (localErr) {
        console.error("Local QA failed:", localErr);
        const fallbackText = "I successfully retrieved information from the books locally, but I couldn't summarize it.\n\nHere are the direct sections from your books:\n" + topK.map(c => `**From ${c.bookName}**: \n\n${c.text.substring(0, 300)}...`).join('\n\n---');
        
        res.json({
           question,
           answer: fallbackText,
           sources: topK.map(c => c.bookName)
        });
      }
    } else {
      // Use Gemini for QA
      const prompt = `You are a professional Pentesting Teaching AI Agent. Answering based ONLY on the provided context excerpts from pentesting books.
      
  Context:
  ${contextStr}

  User Question: ${question}

  Instructions:
  1. Provide specific commands, exploits, techniques, and solutions cited strictly from the context.
  2. If the context does not contain the answer, say "Based on the uploaded books, I cannot find the specific commands or answer to this. Please upload a relevant book."
  3. Format output clearly in Markdown.
  4. Cite the [Source] when providing the answer.
  `;

      try {
        const chatRes = await getAI().models.generateContent({
          model: 'gemini-2.5-flash',
          contents: prompt
        });

        res.json({
          question,
          answer: chatRes.text,
          sources: topK.map(c => c.bookName)
        });
      } catch (llmError: any) {
        // If Gemini fails (e.g. invalid API key), fallback
        console.error("Gemini API failed:", llmError.message || llmError);
        const fallbackText = "I successfully retrieved information from the books locally, but I couldn't summarize it because the AI model is not configured (missing/invalid Gemini API Key).\n\nHere are the direct sections from your books:\n" + topK.map(c => `**From ${c.bookName}**: \n\n${c.text.substring(0, 300)}...`).join('\n\n---');
        res.json({
           question,
           answer: fallbackText,
           sources: topK.map(c => c.bookName)
        });
      }
    }
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

// Setup Vite & Start Server
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    // Production static serving
    const distPath = path.join(__dirname);
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Pentesting Agent Server running on http://localhost:${PORT}`);
  });
}

startServer();
