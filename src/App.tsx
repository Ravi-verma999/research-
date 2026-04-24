import { useState, useRef, useEffect } from 'react';
import { Upload, Book as BookIcon, Terminal, Send, Trash2, Shield, Loader2, Info } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';

interface BookItem {
  id: string;
  filename: string;
  chunks: number;
}

interface Message {
  id: string;
  role: 'user' | 'agent';
  content: string;
  sources?: string[];
}

export default function App() {
  const [books, setBooks] = useState<BookItem[]>([]);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'agent',
      content: 'Welcome to the Pentesting RAG Agent. Upload a book (PDF) to build the knowledge base, then ask me for specific commands, exploits, or concepts.'
    }
  ]);
  const [input, setInput] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadNote, setUploadNote] = useState<string | null>(null);
  const [isTyping, setIsTyping] = useState(false);
  const [inputUrl, setInputUrl] = useState('');
  const [useLocalModel, setUseLocalModel] = useState(true);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Focus and scroll
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  useEffect(() => {
    fetchBooks();
  }, []);

  const fetchBooks = async () => {
    try {
      const res = await fetch('/api/books');
      const data = await res.json();
      setBooks(data);
    } catch (err) {
      console.error(err);
    }
  };

  const handleUrlUpload = async () => {
    if (!inputUrl.trim()) return;
    setIsUploading(true);
    setUploadNote(null);
    try {
      const res = await fetch('/api/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: inputUrl.trim(), useLocalModel })
      });
      const data = await res.json();
      
      if (!res.ok) throw new Error(data.error || 'Failed to fetch URL');
      setUploadNote(data.note || 'Indexed successfully');
      setInputUrl('');
      fetchBooks();
    } catch (err: any) {
      alert("URL Fetch Failed: " + err.message);
    } finally {
      setIsUploading(false);
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    // Filter PDFs and EPUBs if a folder was selected
    const validFiles = files.filter(f => 
      f.type === 'application/pdf' || 
      f.name.toLowerCase().endsWith('.pdf') || 
      f.name.toLowerCase().endsWith('.epub') || 
      f.type === 'application/epub+zip'
    );

    if (validFiles.length === 0) {
      alert("No valid PDF or EPUB files found.");
      return;
    }

    setIsUploading(true);
    setUploadNote(null);
    const formData = new FormData();
    validFiles.forEach(file => formData.append('books', file));
    formData.append('useLocalModel', String(useLocalModel));

    try {
      const res = await fetch('/api/upload-book', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (data.error) {
        alert(data.error);
      } else {
        if (data.note) setUploadNote(data.note);
        await fetchBooks();
      }
    } catch (err) {
      alert("Upload failed. Make sure the server is running.");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (folderInputRef.current) folderInputRef.current.value = '';
    }
  };

  const deleteBook = async (id: string) => {
    if (!confirm('Remove this book from the database?')) return;
    try {
      await fetch(`/api/books/${id}`, { method: 'DELETE' });
      await fetchBooks();
    } catch (err) {
      console.error(err);
    }
  };

  const submitQuery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || books.length === 0) return;
    
    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: input };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsTyping(true);

    try {
      const res = await fetch('/api/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: userMsg.content, useLocalModel })
      });
      const data = await res.json();
      
      setIsTyping(false);
      if (data.error) {
        setMessages(prev => [...prev, { id: Date.now().toString(), role: 'agent', content: `**Error:** ${data.error}` }]);
        return;
      }
      
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'agent',
        content: data.answer,
        sources: data.sources
      }]);
    } catch (err) {
      setIsTyping(false);
      setMessages(prev => [...prev, { id: Date.now().toString(), role: 'agent', content: `**System Error:** Communication failed.` }]);
    }
  };

  return (
    <div className="flex h-screen w-full bg-[#0a0a0c] text-green-500 font-mono overflow-hidden">
      
      {/* Sidebar Knowledge Base */}
      <aside className="w-80 border-r border-green-900/30 bg-[#0d0d12] flex flex-col">
        <div className="p-4 border-b border-green-900/30 flex items-center space-x-3">
          <Shield className="w-6 h-6 text-green-400" />
          <h1 className="text-xl font-bold text-white tracking-widest">PENTEST.ai</h1>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="flex justify-between items-center mb-2">
            <h2 className="text-xs uppercase font-bold text-green-600 tracking-wider">Indexed Books</h2>
            <span className="text-xs bg-green-900/40 text-green-400 px-2 py-0.5 rounded-full">{books.length}</span>
          </div>

          <div className="space-y-2">
            <AnimatePresence>
              {books.map(book => (
                <motion.div 
                  initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }}
                  key={book.id} 
                  className="bg-[#121218] border border-green-900/20 p-3 rounded-lg group relative"
                >
                  <div className="flex items-start space-x-3">
                    <BookIcon className="w-4 h-4 mt-1 text-green-700" />
                    <div className="flex-1 w-0">
                      <p className="text-sm font-medium text-green-300 truncate" title={book.filename}>
                        {book.filename}
                      </p>
                      <p className="text-xs text-green-700 mt-1">{book.chunks} indexed chunks</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => deleteBook(book.id)}
                    className="absolute top-2 right-2 p-1.5 text-red-500/0 group-hover:text-red-500 hover:bg-red-500/10 rounded transition-all"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </motion.div>
              ))}
            </AnimatePresence>
            
            {books.length === 0 && (
              <div className="text-xs text-center p-6 border border-dashed border-green-900/30 text-green-800 rounded-lg">
                No vectors in DB. Upload a book to begin extraction.
              </div>
            )}
          </div>
        </div>

        <div className="p-4 border-t border-green-900/30 space-y-3">
          <label className="flex items-center space-x-2 text-xs text-green-400 cursor-pointer mb-2 p-2 bg-black/30 border border-green-900/40 rounded">
            <input 
              type="checkbox" 
              checked={useLocalModel} 
              onChange={e => setUseLocalModel(e.target.checked)}
              className="accent-green-500 w-3 h-3"
            />
            <span>Use Local AI Models (Offline Mode)</span>
          </label>
        
          <input 
            type="file" 
            accept="application/pdf,.epub,application/epub+zip"
            className="hidden" 
            ref={fileInputRef}
            onChange={handleFileUpload}
            multiple
          />
          <input 
            type="file" 
            className="hidden" 
            ref={folderInputRef}
            onChange={handleFileUpload}
            //@ts-ignore
            webkitdirectory="true"
            directory="true"
            multiple
          />
          <div className="flex space-x-2 w-full">
            <button 
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="flex-1 relative py-2 bg-green-500/10 hover:bg-green-500/20 border border-green-500/50 text-green-400 text-xs font-bold rounded-lg transition-all flex items-center justify-center space-x-2 disabled:opacity-50"
            >
              {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              <span>FILES</span>
            </button>
            <button 
              onClick={() => folderInputRef.current?.click()}
              disabled={isUploading}
              className="flex-1 relative py-2 bg-green-500/10 hover:bg-green-500/20 border border-green-500/50 text-green-400 text-xs font-bold rounded-lg transition-all flex items-center justify-center space-x-2 disabled:opacity-50"
            >
              {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              <span>FOLDER</span>
            </button>
          </div>

          <div className="flex space-x-2 w-full mt-2">
            <input 
              type="text" 
              value={inputUrl}
              onChange={e => setInputUrl(e.target.value)}
              placeholder="Cloud link (Drive, PDF url)..."
              className="flex-1 bg-black/50 border border-green-500/30 rounded p-2 text-xs text-green-400 focus:outline-none"
              disabled={isUploading}
            />
            <button 
              onClick={handleUrlUpload}
              disabled={isUploading || !inputUrl.trim()}
              className="px-3 py-2 bg-green-500/20 text-green-400 font-bold rounded-lg text-xs border border-green-500/50 disabled:opacity-50 flex items-center justify-center"
            >
              {isUploading ? <Loader2 className="w-3 h-3 animate-spin" /> : 'FETCH'}
            </button>
          </div>
          
          {uploadNote && (
            <div className="mt-3 flex items-start space-x-2 text-[10px] text-yellow-500/80 bg-yellow-500/10 p-2 rounded border border-yellow-500/20">
              <Info className="w-3 h-3 flex-shrink-0 mt-0.5" />
              <span>{uploadNote}</span>
            </div>
          )}
        </div>
      </aside>

      {/* Main Terminal Area */}
      <main className="flex-1 flex flex-col bg-[#050505] relative">
        <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6">
          {messages.map(msg => (
            <motion.div 
              initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }}
              key={msg.id} 
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div className={`max-w-[85%] rounded-lg p-5 ${
                msg.role === 'user' 
                  ? 'bg-green-500 text-black rounded-br-sm' 
                  : 'bg-[#111] border border-green-900/30 text-green-400 rounded-tl-sm'
              }`}>
                {msg.role === 'agent' && (
                  <div className="flex items-center space-x-2 mb-3 pb-2 border-b border-green-900/30">
                    <Terminal className="w-4 h-4" />
                    <span className="text-xs font-bold tracking-widest text-white/80">AGENT // RESP</span>
                  </div>
                )}
                
                <div className={`prose prose-sm max-w-none ${msg.role === 'user' ? 'prose-p:text-black font-semibold' : 'prose-invert prose-p:text-green-300 prose-headings:text-white prose-a:text-green-400 prose-code:text-yellow-300 prose-code:bg-black/40 prose-pre:bg-[#0a0a0a] prose-pre:border prose-pre:border-green-900/30'}`}>
                  {msg.role === 'agent' ? (
                     <ReactMarkdown>{msg.content}</ReactMarkdown>
                  ) : (
                    <p className="whitespace-pre-wrap m-0">{msg.content}</p>
                  )}
                </div>

                {msg.sources && msg.sources.length > 0 && (
                  <div className="mt-4 pt-3 border-t border-green-900/30">
                    <p className="text-[10px] uppercase text-green-700 font-bold mb-1">Vector Sources</p>
                    <div className="flex flex-wrap gap-2">
                       {Array.from(new Set(msg.sources)).map((s, i) => (
                         <span key={i} className="text-[10px] bg-green-900/20 px-2 py-1 border border-green-900/40 rounded">
                           [{i+1}] {s}
                         </span>
                       ))}
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          ))}
          {isTyping && (
             <div className="flex justify-start">
               <div className="bg-[#111] border border-green-900/30 text-green-500 p-4 rounded-lg rounded-tl-sm flex items-center space-x-3">
                 <Loader2 className="w-4 h-4 animate-spin" />
                 <span className="text-xs tracking-widest animate-pulse">QUERYING KNOWLEDGE BASE...</span>
               </div>
             </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Input Area */}
        <div className="p-4 border-t border-green-900/30 bg-[#08080a]">
          <form onSubmit={submitQuery} className="max-w-4xl mx-auto relative flex items-center">
            <span className="absolute left-4 text-green-600 font-bold">$&gt;</span>
            <input 
              type="text" 
              value={input}
              onChange={e => setInput(e.target.value)}
              disabled={books.length === 0 || isTyping}
              placeholder={books.length === 0 ? "System locked. Upload knowledge source to enable..." : "Execute query (e.g. 'commands to enumerate SMB')..."}
              className="w-full bg-[#111] border border-green-900/50 rounded-lg py-4 pl-12 pr-14 text-white focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500 disabled:opacity-50 placeholder-green-800 transition-all"
            />
            <button 
              type="submit"
              disabled={!input.trim() || books.length === 0 || isTyping}
              className="absolute right-2 p-2 bg-green-500 text-black hover:bg-green-400 rounded transition-colors disabled:opacity-50 disabled:bg-green-900"
            >
              <Send className="w-5 h-5" />
            </button>
          </form>
        </div>
      </main>

    </div>
  );
}
