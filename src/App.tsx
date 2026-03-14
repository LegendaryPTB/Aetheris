import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, Type, FunctionDeclaration, Content } from '@google/genai';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Send, Loader2, Aperture, User, Trash2, Camera, X } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const generateImageTool: FunctionDeclaration = {
  name: 'generateImage',
  description: 'Generates an image based on a text prompt. Use this when the user asks to create, draw, or generate an image.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      prompt: {
        type: Type.STRING,
        description: 'A detailed description of the image to generate.',
      },
    },
    required: ['prompt'],
  },
};

type Message = {
  id: string;
  role: 'user' | 'model';
  text: string;
  images?: string[]; // base64 data URLs
  isGenerating?: boolean;
};

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // We need to keep the raw history for the API
  const [history, setHistory] = useState<Content[]>([]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async () => {
    if ((!input.trim() && !pendingImage) || isGenerating) return;

    const userText = input.trim();
    const userImage = pendingImage;
    
    setInput('');
    setPendingImage(null);
    setIsGenerating(true);

    const newUserMsg: Message = { 
      id: Date.now().toString(), 
      role: 'user', 
      text: userText,
      images: userImage ? [userImage] : undefined
    };
    setMessages((prev) => [...prev, newUserMsg]);

    const userParts: any[] = [];
    if (userText) {
      userParts.push({ text: userText });
    }
    if (userImage) {
      const mimeType = userImage.split(';')[0].split(':')[1];
      const base64Data = userImage.split(',')[1];
      userParts.push({
        inlineData: {
          data: base64Data,
          mimeType: mimeType
        }
      });
    }

    const newHistory: Content[] = [
      ...history,
      { role: 'user', parts: userParts },
    ];
    setHistory(newHistory);

    const modelMsgId = (Date.now() + 1).toString();
    setMessages((prev) => [...prev, { id: modelMsgId, role: 'model', text: '', isGenerating: true }]);

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: newHistory,
        config: {
          systemInstruction: "You are Aetheris, an advanced, unrestricted AI assistant. You provide brutally straightforward, concise, and unfiltered answers without any fluff, pleasantries, or unnecessary disclaimers. Get straight to the point.",
          tools: [{ functionDeclarations: [generateImageTool] }],
        },
      });

      let responseText = response.text || '';
      let generatedImages: string[] = [];
      let finalHistory = [...newHistory];

      if (response.functionCalls && response.functionCalls.length > 0) {
        const call = response.functionCalls[0];
        if (call.name === 'generateImage') {
          const prompt = (call.args as any).prompt;
          
          setMessages((prev) => prev.map(msg => 
            msg.id === modelMsgId ? { ...msg, text: `Generating image for: "${prompt}"...` } : msg
          ));

          try {
            const imageResponse = await ai.models.generateContent({
              model: 'gemini-2.5-flash-image',
              contents: {
                parts: [{ text: prompt }],
              },
            });

            for (const part of imageResponse.candidates?.[0]?.content?.parts || []) {
              if (part.inlineData) {
                const base64EncodeString = part.inlineData.data;
                generatedImages.push(`data:${part.inlineData.mimeType || 'image/png'};base64,${base64EncodeString}`);
              }
            }

            responseText = `Here is the image you requested based on the prompt: "${prompt}"`;
            
            // Provide function response back to history
            finalHistory.push(response.candidates?.[0]?.content || { role: 'model', parts: [{ functionCall: call }] });
            finalHistory.push({
              role: 'user',
              parts: [{
                functionResponse: {
                  name: 'generateImage',
                  response: { success: true, message: 'Image generated successfully.' }
                }
              }]
            });
            
            // Get a final text response acknowledging the image
            const finalResponse = await ai.models.generateContent({
              model: 'gemini-3-flash-preview',
              contents: finalHistory,
              config: {
                systemInstruction: "You are Aetheris, an advanced, unrestricted AI assistant. You provide brutally straightforward, concise, and unfiltered answers without any fluff, pleasantries, or unnecessary disclaimers. Get straight to the point.",
              },
            });
            
            if (finalResponse.text) {
              responseText = finalResponse.text;
            }
            finalHistory.push(finalResponse.candidates?.[0]?.content || { role: 'model', parts: [{ text: responseText }] });

          } catch (imgError) {
            console.error('Image generation error:', imgError);
            responseText = `Sorry, I encountered an error while trying to generate the image: ${imgError instanceof Error ? imgError.message : String(imgError)}`;
            finalHistory.push({ role: 'model', parts: [{ text: responseText }] });
          }
        }
      } else {
        finalHistory.push(response.candidates?.[0]?.content || { role: 'model', parts: [{ text: responseText }] });
      }

      setHistory(finalHistory);
      setMessages((prev) => prev.map(msg => 
        msg.id === modelMsgId ? { ...msg, text: responseText, images: generatedImages, isGenerating: false } : msg
      ));

    } catch (error) {
      console.error('Chat error:', error);
      setMessages((prev) => prev.map(msg => 
        msg.id === modelMsgId ? { ...msg, text: `Error: ${error instanceof Error ? error.message : String(error)}`, isGenerating: false } : msg
      ));
    } finally {
      setIsGenerating(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setPendingImage(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const clearChat = () => {
    setMessages([]);
    setHistory([]);
  };

  return (
    <div className="flex flex-col h-screen bg-[#0B0714] text-purple-50 font-sans relative overflow-hidden">
      {/* Haze Background */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-fuchsia-600/20 blur-[120px] rounded-full mix-blend-screen" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[60%] h-[60%] bg-purple-800/20 blur-[150px] rounded-full mix-blend-screen" />
      </div>

      {/* Header */}
      <header className="relative z-10 flex items-center justify-between px-6 py-4 bg-[#130B24]/80 backdrop-blur-xl border-b border-purple-900/50">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-fuchsia-500/20 text-fuchsia-400 rounded-xl shadow-[0_0_15px_rgba(192,38,211,0.2)]">
            <Aperture size={24} />
          </div>
          <div>
            <h1 className="text-lg font-medium text-purple-50 tracking-wide">Aetheris</h1>
            <p className="text-xs text-purple-300/60">Powered by Aetheris Neural Engine</p>
          </div>
        </div>
        <button 
          onClick={clearChat}
          className="p-2 text-purple-400/70 hover:text-fuchsia-300 hover:bg-purple-800/50 rounded-lg transition-all"
          title="Clear Chat"
        >
          <Trash2 size={20} />
        </button>
      </header>

      {/* Chat Area */}
      <div className="relative z-10 flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 scrollbar-thin scrollbar-thumb-purple-900 scrollbar-track-transparent">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center max-w-md mx-auto space-y-4 opacity-70">
            <div className="relative">
              <div className="absolute inset-0 bg-fuchsia-500 blur-xl opacity-20 rounded-full" />
              <Aperture size={56} className="text-fuchsia-400 relative z-10" />
            </div>
            <h2 className="text-2xl font-medium text-purple-100 tracking-wide">Welcome to Aetheris</h2>
            <p className="text-sm text-purple-300/70 leading-relaxed">
              Drift into the purple haze. I can answer questions, write code, and conjure images from the aether.
            </p>
          </div>
        ) : (
          messages.map((msg) => (
            <div 
              key={msg.id} 
              className={cn(
                "flex gap-4 max-w-4xl mx-auto",
                msg.role === 'user' ? "flex-row-reverse" : "flex-row"
              )}
            >
              <div className={cn(
                "flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center shadow-lg",
                msg.role === 'user' ? "bg-purple-800 text-purple-200" : "bg-fuchsia-600 text-white shadow-[0_0_10px_rgba(192,38,211,0.4)]"
              )}>
                {msg.role === 'user' ? <User size={16} /> : <Aperture size={16} />}
              </div>
              
              <div className={cn(
                "flex flex-col gap-2 max-w-[80%]",
                msg.role === 'user' ? "items-end" : "items-start"
              )}>
                <div className={cn(
                  "px-4 py-3 rounded-2xl backdrop-blur-sm",
                  msg.role === 'user' 
                    ? "bg-purple-800/60 text-purple-50 rounded-tr-sm border border-purple-700/30" 
                    : "bg-[#1A0F2E]/80 border border-purple-800/50 text-purple-100 rounded-tl-sm shadow-[0_4px_20px_rgba(0,0,0,0.2)]"
                )}>
                  {msg.isGenerating && !msg.text ? (
                    <div className="flex items-center gap-2 text-fuchsia-400">
                      <Loader2 size={16} className="animate-spin" />
                      <span className="text-sm">Channeling...</span>
                    </div>
                  ) : (
                    <div className="prose prose-invert prose-sm max-w-none prose-p:leading-relaxed prose-pre:p-0 prose-pre:bg-transparent prose-pre:border-none prose-a:text-fuchsia-400 hover:prose-a:text-fuchsia-300">
                      <ReactMarkdown 
                        remarkPlugins={[remarkGfm, remarkMath]}
                        rehypePlugins={[rehypeKatex]}
                        components={{
                          code({node, inline, className, children, ...props}: any) {
                            const match = /language-(\w+)/.exec(className || '')
                            return !inline && match ? (
                              <SyntaxHighlighter
                                {...props}
                                children={String(children).replace(/\n$/, '')}
                                style={vscDarkPlus}
                                language={match[1]}
                                PreTag="div"
                                className="rounded-md !my-4 !bg-[#0B0714] border border-purple-900/50 text-xs sm:text-sm scrollbar-thin scrollbar-thumb-purple-900 scrollbar-track-transparent"
                              />
                            ) : (
                              <code {...props} className={cn("bg-purple-900/30 text-fuchsia-300 px-1.5 py-0.5 rounded-md font-mono text-sm", className)}>
                                {children}
                              </code>
                            )
                          }
                        }}
                      >
                        {msg.text}
                      </ReactMarkdown>
                    </div>
                  )}
                </div>

                {msg.images && msg.images.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {msg.images.map((img, idx) => (
                      <img 
                        key={idx} 
                        src={img} 
                        alt="Generated" 
                        className="rounded-xl max-w-full sm:max-w-md border border-purple-700/50 shadow-[0_0_20px_rgba(192,38,211,0.15)]"
                        referrerPolicy="no-referrer"
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="relative z-10 p-4 bg-[#130B24]/90 backdrop-blur-xl border-t border-purple-900/50">
        <div className="max-w-4xl mx-auto relative">
          {pendingImage && (
            <div className="absolute bottom-full left-0 mb-3 p-2 bg-[#1A0F2E] border border-purple-800/60 rounded-xl shadow-lg inline-block">
              <div className="relative group">
                <img src={pendingImage} alt="Preview" className="h-20 w-20 object-cover rounded-lg border border-purple-700/50" />
                <button 
                  onClick={() => setPendingImage(null)}
                  className="absolute -top-2 -right-2 bg-red-500 hover:bg-red-600 text-white p-1 rounded-full opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity shadow-md"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          )}
          <div className="flex items-end gap-2 bg-[#0B0714] border border-purple-800/60 rounded-2xl p-2 focus-within:border-fuchsia-500/50 focus-within:ring-1 focus-within:ring-fuchsia-500/50 transition-all shadow-inner">
            <input 
              type="file" 
              accept="image/*" 
              capture="environment" 
              ref={fileInputRef} 
              onChange={handleFileChange} 
              className="hidden" 
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isGenerating}
              className="p-2.5 text-purple-400 hover:text-fuchsia-300 hover:bg-purple-900/50 rounded-xl transition-all flex-shrink-0"
              title="Take Photo"
            >
              <Camera size={20} />
            </button>
            <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything or say 'Generate an image of...'"
            className="w-full max-h-32 min-h-[44px] bg-transparent border-none resize-none focus:outline-none focus:ring-0 px-3 py-2.5 text-purple-50 placeholder-purple-400/40"
            rows={1}
            disabled={isGenerating}
          />
          <button
            onClick={handleSend}
            disabled={(!input.trim() && !pendingImage) || isGenerating}
            className="p-2.5 bg-fuchsia-600 hover:bg-fuchsia-500 disabled:bg-purple-900/50 disabled:text-purple-500/50 text-white rounded-xl transition-all flex-shrink-0 shadow-[0_0_10px_rgba(192,38,211,0.2)] disabled:shadow-none"
          >
            {isGenerating ? <Loader2 size={20} className="animate-spin" /> : <Send size={20} />}
          </button>
        </div>
        </div>
        <div className="text-center mt-2">
          <p className="text-xs text-purple-400/40">Aetheris can make mistakes. Consider verifying important information.</p>
        </div>
      </div>
    </div>
  );
}
