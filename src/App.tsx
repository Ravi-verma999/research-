import { useState, useRef, useEffect } from "react";
import {
  Upload,
  Book as BookIcon,
  Terminal,
  Send,
  Trash2,
  Shield,
  Loader2,
  Info,
  Download,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import ReactMarkdown from "react-markdown";

interface BookItem {
  id: string;
  filename: string;
  chunks: number;
}

interface Message {
  id: string;
  role: "user" | "agent";
  content: string;
  sources?: string[];
}

export default function App() {
  const [books, setBooks] = useState<BookItem[]>([]);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "agent",
      content:
        "Welcome to the Pentesting RAG Agent. Upload a book (PDF) to build the knowledge base, then ask me for specific commands, exploits, or concepts.",
    },
  ]);
  const [input, setInput] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [uploadNote, setUploadNote] = useState<string | null>(null);
  const [isTyping, setIsTyping] = useState(false);
  const [inputUrl, setInputUrl] = useState("");
  const [useLocalModel, setUseLocalModel] = useState(false);
  const [pastedTitle, setPastedTitle] = useState("");
  const [pastedText, setPastedText] = useState("");
  const [uploadMode, setUploadMode] = useState<"files" | "url" | "text">(
    "files",
  );
  const [voiceOutputMode, setVoiceOutputMode] = useState(false);
  const [isListening, setIsListening] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    if ("SpeechRecognition" in window || "webkitSpeechRecognition" in window) {
      const SpeechRecognition =
        (window as any).SpeechRecognition ||
        (window as any).webkitSpeechRecognition;
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = false;
      recognitionRef.current.lang = "en-US";

      recognitionRef.current.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        setInput((prev) => (prev ? prev + " " + transcript : transcript));
        setIsListening(false);
      };

      recognitionRef.current.onerror = (event: any) => {
        console.error("Speech recognition error:", event.error);
        setIsListening(false);
      };

      recognitionRef.current.onend = () => {
        setIsListening(false);
      };
    }
  }, []);

  const toggleListening = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
    } else {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.start();
          setIsListening(true);
        } catch (e) {}
      } else {
        alert("Speech recognition not supported in this browser.");
      }
    }
  };

  const speakText = (text: string) => {
    if (!voiceOutputMode) return;
    window.speechSynthesis.cancel();

    // basic cleanup of markdown for speaking
    const cleanText = text
      .replace(/[*_#]/g, "")
      .replace(/```[\s\S]*?```/g, "Code block omitted for speech.");
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    window.speechSynthesis.speak(utterance);
  };

  // Focus and scroll
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  useEffect(() => {
    fetchBooks();
  }, []);

  const fetchBooks = async () => {
    try {
      const res = await fetch("/api/books");
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
      const res = await fetch("/api/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: inputUrl.trim(), useLocalModel }),
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || "Failed to fetch URL");
      setUploadNote(data.note || "Indexed successfully");
      setInputUrl("");
      fetchBooks();
    } catch (err: any) {
      alert("URL Fetch Failed: " + err.message);
    } finally {
      setIsUploading(false);
    }
  };

  const handleTextUpload = async () => {
    if (!pastedText.trim()) return;
    setIsUploading(true);
    setUploadNote(null);
    try {
      const res = await fetch("/api/upload-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: pastedTitle.trim(),
          text: pastedText.trim(),
          useLocalModel,
        }),
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || "Failed to paste text");
      setUploadNote(data.note || "Text indexed successfully");
      setPastedText("");
      setPastedTitle("");
      fetchBooks();
    } catch (err: any) {
      alert("Text Upload Failed: " + err.message);
    } finally {
      setIsUploading(false);
    }
  };

  const handleFileUpload = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    // Filter PDFs, EPUBs, and TXT files if a folder was selected
    const validFiles = files.filter(
      (f) =>
        f.type === "application/pdf" ||
        f.name.toLowerCase().endsWith(".pdf") ||
        f.name.toLowerCase().endsWith(".epub") ||
        f.type === "application/epub+zip" ||
        f.name.toLowerCase().endsWith(".txt") ||
        f.type === "text/plain",
    );

    if (validFiles.length === 0) {
      alert("No valid PDF, EPUB, or TXT files found.");
      return;
    }

    setIsUploading(true);
    setUploadNote(null);
    const formData = new FormData();
    validFiles.forEach((file) => formData.append("books", file));
    formData.append("useLocalModel", String(useLocalModel));

    try {
      const res = await fetch("/api/upload-book", {
        method: "POST",
        body: formData,
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
      if (fileInputRef.current) fileInputRef.current.value = "";
      if (folderInputRef.current) folderInputRef.current.value = "";
    }
  };

  const deleteBook = async (id: string) => {
    if (!confirm("Remove this book from the database?")) return;
    try {
      await fetch(`/api/books/${id}`, { method: "DELETE" });
      await fetchBooks();
    } catch (err) {
      console.error(err);
    }
  };

  const handleBackupBrain = async () => {
    const pwd = prompt("Enter a strong password to encrypt your brain:");
    if (!pwd) return;

    try {
      const res = await fetch("/api/export-brain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pwd }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      const blob = new Blob([data.encryptedData], { type: "text/plain" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "brain_backup.enc";
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      alert("Backup failed: " + err.message);
    }
  };

  const brainUploadRef = useRef<HTMLInputElement>(null);

  const handleRestoreBrain = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const pwd = prompt("Enter the password to decrypt your brain:");
    if (!pwd) {
      if (brainUploadRef.current) brainUploadRef.current.value = "";
      return;
    }

    setIsUploading(true);
    const formData = new FormData();
    formData.append("brainFile", file);
    formData.append("password", pwd);

    try {
      const res = await fetch("/api/import-brain", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      alert("Brain restored successfully! All knowledge acquired.");
      fetchBooks();
    } catch (err: any) {
      alert("Brain import failed: " + err.message);
    } finally {
      setIsUploading(false);
      if (brainUploadRef.current) brainUploadRef.current.value = "";
    }
  };

  const submitQuery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || books.length === 0) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      role: "user",
      content: input,
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsTyping(true);

    try {
      const res = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: userMsg.content, useLocalModel }),
      });
      const data = await res.json();

      setIsTyping(false);
      if (data.error) {
        const errorMsg = `**Error:** ${data.error}`;
        setMessages((prev) => [
          ...prev,
          { id: Date.now().toString(), role: "agent", content: errorMsg },
        ]);
        speakText(errorMsg);
        return;
      }

      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          role: "agent",
          content: data.answer,
          sources: data.sources,
        },
      ]);
      speakText(data.answer);
    } catch (err) {
      setIsTyping(false);
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          role: "agent",
          content: `**System Error:** Communication failed.`,
        },
      ]);
    }
  };

  return (
    <div className="flex flex-col md:flex-row h-screen w-full bg-[#030712] text-cyan-400 font-mono overflow-hidden">
      {/* Sidebar Knowledge Base */}
      <aside className="hidden md:flex w-80 border-r border-cyan-900/30 bg-[#080d1a] flex-col shrink-0">
        <div className="p-4 border-b border-cyan-900/30 flex flex-col space-y-2">
          <div className="flex items-center space-x-3">
            <Shield className="w-6 h-6 text-cyan-400" />
            <h1 className="text-xl font-bold text-white tracking-widest">
              LOSTX SYSTEM
            </h1>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="flex justify-between items-center mb-2">
            <h2 className="text-xs uppercase font-bold text-cyan-500 tracking-wider">
              Indexed Books
            </h2>
            <span className="text-xs bg-cyan-900/40 text-cyan-400 px-2 py-0.5 rounded-full">
              {books.length}
            </span>
          </div>

          <div className="space-y-2">
            <AnimatePresence>
              {books.map((book) => (
                <motion.div
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  key={book.id}
                  className="bg-[#0e1629] border border-cyan-900/20 p-3 rounded-none border-l-2 group relative"
                >
                  <div className="flex items-start space-x-3">
                    <BookIcon className="w-4 h-4 mt-1 text-cyan-700" />
                    <div className="flex-1 w-0">
                      <p
                        className="text-sm font-medium text-cyan-300 truncate"
                        title={book.filename}
                      >
                        {book.filename}
                      </p>
                      <p className="text-xs text-cyan-700 mt-1">
                        {book.chunks} indexed chunks
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => deleteBook(book.id)}
                    className="absolute top-2 right-2 p-1.5 text-red-500/0 group-hover:text-red-500 hover:bg-red-500/10 rounded-sm transition-all"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </motion.div>
              ))}
            </AnimatePresence>

            {books.length === 0 && (
              <div className="text-xs text-center p-6 border border-dashed border-cyan-900/30 text-cyan-800 rounded-none border-l-2">
                No vectors in DB. Upload a book to begin extraction.
              </div>
            )}
          </div>

          {/* Brain Sync Section */}
          <div className="mt-4 p-3 bg-cyan-900/10 border border-cyan-900/30 rounded-none border-l-2">
            <h2 className="text-[10px] uppercase font-bold text-cyan-500 tracking-wider mb-2">
              Brain Operations
            </h2>
            <div className="flex space-x-2">
              <button
                onClick={handleBackupBrain}
                className="flex-1 py-1.5 bg-black/40 hover:bg-cyan-900/40 border border-cyan-900/50 text-cyan-400 text-[10px] font-bold rounded-sm flex items-center justify-center space-x-1 transition-all"
              >
                <Download className="w-3 h-3" />
                <span>BACKUP</span>
              </button>
              <input
                type="file"
                accept=".enc,.json"
                className="hidden"
                ref={brainUploadRef}
                onChange={handleRestoreBrain}
              />
              <button
                onClick={() => brainUploadRef.current?.click()}
                disabled={isUploading}
                className="flex-1 py-1.5 bg-black/40 hover:bg-cyan-900/40 border border-cyan-900/50 text-cyan-400 text-[10px] font-bold rounded-sm flex items-center justify-center space-x-1 transition-all disabled:opacity-50"
              >
                <Upload className="w-3 h-3" />
                <span>RESTORE</span>
              </button>
            </div>
            <p className="text-[9px] text-cyan-700/80 mt-1.5 text-center">
              Export/Import offline to your Drive to keep knowledge forever.
            </p>
          </div>
        </div>

        <div className="p-4 border-t border-cyan-900/30 space-y-3">
          <label className="flex items-center space-x-2 text-xs text-cyan-400 cursor-pointer mb-2 p-2 bg-black/30 border border-cyan-900/40 rounded-sm">
            <input
              type="checkbox"
              checked={useLocalModel}
              onChange={(e) => setUseLocalModel(e.target.checked)}
              className="accent-cyan-400 w-3 h-3"
            />
            <span>Use Local AI Models (Offline Mode)</span>
          </label>

          <div className="flex border-b border-cyan-900/40 text-xs font-bold w-full text-cyan-500/50">
            <button
              onClick={() => setUploadMode("files")}
              className={`flex-1 py-2 text-center border-b-2 transition-all ${uploadMode === "files" ? "border-cyan-400 text-cyan-400 bg-cyan-900/10" : "border-transparent hover:text-cyan-400/80 hover:bg-cyan-900/5"}`}
            >
              FILES
            </button>
            <button
              onClick={() => setUploadMode("url")}
              className={`flex-1 py-2 text-center border-b-2 transition-all ${uploadMode === "url" ? "border-cyan-400 text-cyan-400 bg-cyan-900/10" : "border-transparent hover:text-cyan-400/80 hover:bg-cyan-900/5"}`}
            >
              URL
            </button>
            <button
              onClick={() => setUploadMode("text")}
              className={`flex-1 py-2 text-center border-b-2 transition-all ${uploadMode === "text" ? "border-cyan-400 text-cyan-400 bg-cyan-900/10" : "border-transparent hover:text-cyan-400/80 hover:bg-cyan-900/5"}`}
            >
              TEXT
            </button>
          </div>

          {uploadMode === "files" && (
            <div className="space-y-2 mt-2">
              <input
                type="file"
                accept="application/pdf,.epub,application/epub+zip,.txt,text/plain"
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
                  className="flex-1 relative py-2 bg-cyan-400/10 hover:bg-cyan-400/20 border border-cyan-400/50 text-cyan-400 text-xs font-bold rounded-none border-l-2 transition-all flex items-center justify-center space-x-2 disabled:opacity-50"
                >
                  {isUploading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Upload className="w-4 h-4" />
                  )}
                  <span>FILES</span>
                </button>
                <button
                  onClick={() => folderInputRef.current?.click()}
                  disabled={isUploading}
                  className="flex-1 relative py-2 bg-cyan-400/10 hover:bg-cyan-400/20 border border-cyan-400/50 text-cyan-400 text-xs font-bold rounded-none border-l-2 transition-all flex items-center justify-center space-x-2 disabled:opacity-50"
                >
                  {isUploading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Upload className="w-4 h-4" />
                  )}
                  <span>FOLDER</span>
                </button>
              </div>
            </div>
          )}

          {uploadMode === "url" && (
            <div className="flex space-x-2 w-full mt-2">
              <input
                type="text"
                value={inputUrl}
                onChange={(e) => setInputUrl(e.target.value)}
                placeholder="Cloud link (Drive, PDF url)..."
                className="flex-1 bg-black/50 border border-cyan-400/30 rounded-sm p-2 text-xs text-cyan-400 focus:outline-none"
                disabled={isUploading}
              />
              <button
                onClick={handleUrlUpload}
                disabled={isUploading || !inputUrl.trim()}
                className="px-3 py-2 bg-cyan-400/20 text-cyan-400 font-bold rounded-none border-l-2 text-xs border border-cyan-400/50 disabled:opacity-50 flex items-center justify-center"
              >
                {isUploading ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  "FETCH"
                )}
              </button>
            </div>
          )}

          {uploadMode === "text" && (
            <div className="space-y-2 mt-2">
              <input
                type="text"
                value={pastedTitle}
                onChange={(e) => setPastedTitle(e.target.value)}
                placeholder="Title (Optional)"
                className="w-full bg-black/50 border border-cyan-400/30 rounded-sm p-2 text-xs text-cyan-400 focus:outline-none"
                disabled={isUploading}
              />
              <textarea
                value={pastedText}
                onChange={(e) => setPastedText(e.target.value)}
                placeholder="Paste your commands, text, or notes here..."
                className="w-full h-24 resize-none bg-black/50 border border-cyan-400/30 rounded-sm p-2 text-xs text-cyan-400 focus:outline-none scrollbar-thin scrollbar-thumb-cyan-900 scrollbar-track-transparent"
                disabled={isUploading}
              />
              <button
                onClick={handleTextUpload}
                disabled={isUploading || !pastedText.trim()}
                className="w-full relative py-2 bg-cyan-400/10 hover:bg-cyan-400/20 border border-cyan-400/50 text-cyan-400 text-xs font-bold rounded-none border-l-2 transition-all flex items-center justify-center space-x-2 disabled:opacity-50"
              >
                {isUploading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Upload className="w-4 h-4" />
                )}
                <span>SAVE KNOWLEDGE</span>
              </button>
            </div>
          )}

          {uploadNote && (
            <div className="mt-3 flex items-start space-x-2 text-[10px] text-yellow-500/80 bg-yellow-500/10 p-2 rounded-sm border border-yellow-500/20">
              <Info className="w-3 h-3 flex-shrink-0 mt-0.5" />
              <span>{uploadNote}</span>
            </div>
          )}
        </div>
      </aside>

      {/* Main Terminal Area */}
      <main className="flex-1 flex flex-col min-w-0 min-h-0 bg-[#010409] relative bg-[linear-gradient(to_right,#00e5ff10_1px,transparent_1px),linear-gradient(to_bottom,#00e5ff10_1px,transparent_1px)] bg-[size:24px_24px]">
        <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6">
          {messages.map((msg) => (
            <motion.div
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              key={msg.id}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-none border-l-2 p-3 md:p-5 min-w-0 ${
                  msg.role === "user"
                    ? "bg-cyan-400 text-black shadow-[0_0_15px_rgba(0,229,255,0.4)] rounded-br-sm"
                    : "bg-[#0a1122] border border-cyan-900/30 text-cyan-400 rounded-tl-sm"
                }`}
              >
                {msg.role === "agent" && (
                  <div className="flex items-center space-x-2 mb-3 pb-2 border-b border-cyan-900/30">
                    <Terminal className="w-4 h-4" />
                    <span className="text-xs font-bold tracking-widest text-white/80">
                      AGENT // RESP
                    </span>
                  </div>
                )}

                <div
                  className={`prose prose-sm max-w-none break-words overflow-hidden ${msg.role === "user" ? "prose-p:text-black font-semibold whitespace-pre-wrap" : "prose-invert prose-p:text-cyan-300 prose-headings:text-white prose-a:text-cyan-400 prose-code:text-yellow-300 prose-code:bg-black/40 prose-pre:bg-[#060c17] prose-pre:border prose-pre:border-cyan-900/30 prose-pre:overflow-x-auto prose-pre:whitespace-pre-wrap prose-pre:break-words prose-p:break-words"}`}
                  style={{ wordBreak: 'break-word', overflowWrap: 'break-word' }}
                >
                  {msg.role === "agent" ? (
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                  ) : (
                    <p className="whitespace-pre-wrap break-words m-0">{msg.content}</p>
                  )}
                </div>

                {msg.sources && msg.sources.length > 0 && (
                  <div className="mt-4 pt-3 border-t border-cyan-900/30">
                    <p className="text-[10px] uppercase text-cyan-700 font-bold mb-1">
                      Vector Sources
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {Array.from(new Set(msg.sources)).map((s, i) => (
                        <span
                          key={i}
                          className="text-[10px] bg-cyan-900/20 px-2 py-1 border border-cyan-900/40 rounded-sm"
                        >
                          [{i + 1}] {s}
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
              <div className="bg-[#0a1122] border border-cyan-900/30 text-cyan-400 p-4 rounded-none border-l-2 rounded-tl-sm flex items-center space-x-3">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-xs tracking-widest animate-pulse">
                  QUERYING KNOWLEDGE BASE...
                </span>
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Input Area */}
        <div className="p-4 border-t border-cyan-900/30 bg-[#050b14] shrink-0">
          <div className="max-w-4xl mx-auto flex items-center justify-between mb-2">
            <div className="flex space-x-3">
              <button
                type="button"
                title="Voice Control (Mic)"
                onClick={toggleListening}
                className={`flex items-center space-x-1 px-2 py-1 text-xs border rounded-sm transition-all ${isListening ? "bg-red-900/40 border-red-500 text-red-400 animate-pulse" : "bg-cyan-900/10 border-cyan-900/50 text-cyan-500 hover:text-cyan-400 hover:border-cyan-400"}`}
              >
                {isListening ? (
                  <MicOff className="w-3 h-3" />
                ) : (
                  <Mic className="w-3 h-3" />
                )}
                <span>{isListening ? "LISTENING..." : "DICTATOR MODE"}</span>
              </button>
              <button
                type="button"
                title="Toggle Voice Output"
                onClick={() => setVoiceOutputMode((v) => !v)}
                className={`flex items-center space-x-1 px-2 py-1 text-xs border rounded-sm transition-all ${voiceOutputMode ? "bg-cyan-500/30 border-cyan-400 text-cyan-300" : "bg-cyan-900/10 border-cyan-900/50 text-cyan-500 hover:text-cyan-400 hover:border-cyan-400"}`}
              >
                {voiceOutputMode ? (
                  <Volume2 className="w-3 h-3" />
                ) : (
                  <VolumeX className="w-3 h-3" />
                )}
                <span>
                  {voiceOutputMode ? "VOICE OUT: ON" : "VOICE OUT: OFF"}
                </span>
              </button>
            </div>
            <p className="text-[10px] text-cyan-800">
              Use on smartphone for hands-free live interaction.
            </p>
          </div>

          <form
            onSubmit={submitQuery}
            className="max-w-4xl mx-auto relative flex items-center"
          >
            <span className="absolute left-4 text-cyan-500 font-bold">
              $&gt;
            </span>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={isTyping}
              placeholder="Ask Lostx or Query Books (e.g. 'Can you use anonymous search for bug bounty?')..."
              className="w-full bg-[#0a1122] border border-cyan-900/50 rounded-none border-l-2 py-4 pl-12 pr-14 text-white focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 disabled:opacity-50 placeholder-cyan-800 transition-all font-mono"
            />
            <button
              type="submit"
              disabled={!input.trim() || isTyping}
              className="absolute right-2 p-2 bg-cyan-400 text-black hover:bg-cyan-400 rounded-sm transition-colors disabled:opacity-50 disabled:bg-cyan-900"
            >
              <Send className="w-5 h-5" />
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
