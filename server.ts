import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { GoogleGenAI } from '@google/genai';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Gemini lazily
let aiClient: GoogleGenAI | null = null;
function getAI() {
  if (!aiClient) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error("GEMINI_API_KEY environment variable is required");
    aiClient = new GoogleGenAI({ apiKey: key });
  }
  return aiClient;
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
}

// In-memory databases
const booksDb: Record<string, Book> = {};
let vectorStore: Chunk[] = [];

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
  res.json({ success: true, message: 'Book deleted completely' });
});

app.post('/api/upload-book', upload.single('book'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No book file provided." });
    
    console.log(`Processing file: ${req.file.originalname} (${req.file.size} bytes)`);

    // Parse PDF
    let textContent = "";
    try {
      const data = await pdfParse(req.file.buffer);
      textContent = data.text;
    } catch (parseErr) {
      console.error("PDF Parse error:", parseErr);
      return res.status(400).json({ error: "Could not extract text from this PDF." });
    }

    if (!textContent || textContent.trim().length === 0) {
      return res.status(400).json({ error: "Extracted text is empty. PDF might be scanned images." });
    }

    const bookId = uuidv4();
    booksDb[bookId] = {
      id: bookId,
      filename: req.file.originalname,
      text: textContent
    };

    // Create chunks
    const chunks = chunkText(textContent);
    console.log(`Generated ${chunks.length} chunks for ${req.file.originalname}. Embedding now...`);
    
    // Batch process embeddings to avoid rate limits
    const embedBatchSize = 100; // Define appropriately
    let embeddedChunksCount = 0;
    
    // Process top K chunks if it's too large to prevent timeout/quota issues initially,
    // or we can process all if we do it sequentially.
    // For AI Studio demo safety, we limit to first 200 chunks if extremely long.
    const chunksToEmbed = chunks.slice(0, 200); 

    for (const chunkTextContent of chunksToEmbed) {
      try {
        const response = await getAI().models.embedContent({
          model: 'text-embedding-004',
          contents: chunkTextContent
        });
        
        vectorStore.push({
          id: uuidv4(),
          bookId,
          bookName: req.file.originalname,
          text: chunkTextContent,
          embedding: response.embeddings?.[0]?.values || []
        });
        embeddedChunksCount++;
      } catch (embErr) {
        console.error("Embedding API error:", embErr);
        // Continue indexing although some might fail
      }
    }

    res.json({ 
      success: true, 
      id: bookId, 
      filename: req.file.originalname, 
      chunksIndexed: embeddedChunksCount,
      totalChunksFound: chunks.length,
      note: chunks.length > 200 ? "Limited to first 200 chunks to prevent quota limits." : undefined
    });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

app.post('/api/query', async (req, res) => {
  try {
    const { question } = req.body;
    if (!question) return res.status(400).json({ error: 'Question is required' });
    if (vectorStore.length === 0) {
      return res.status(400).json({ error: 'No books have been uploaded yet. Please upload a PDF first.' });
    }

    // Embed the query
    const queryResponse = await getAI().models.embedContent({
      model: 'text-embedding-004',
      contents: question
    });
    
    const queryEmbedding = queryResponse.embeddings?.[0]?.values;
    if (!queryEmbedding) return res.status(500).json({ error: 'Failed to generate embedding for query' });

    // Retrieve Top K (K=3)
    const scoredChunks = vectorStore
      .filter(c => c.embedding && c.embedding.length > 0)
      .map(chunk => ({
        ...chunk,
        score: cosineSimilarity(queryEmbedding, chunk.embedding!)
      }))
      .sort((a, b) => b.score - a.score);

    const topK = scoredChunks.slice(0, 3);
    
    // Format Context
    const contextStr = topK.map((c, i) => `[Source ${i+1}: ${c.bookName}]\n...\n${c.text}\n...`).join('\n\n');

    // Prompt the LLM
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

    const chatRes = await getAI().models.generateContent({
      model: 'gemini-2.5-pro',
      contents: prompt
    });

    res.json({
      question,
      answer: chatRes.text,
      sources: topK.map(c => c.bookName)
    });
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
