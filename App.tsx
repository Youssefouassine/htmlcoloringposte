
import React, { useState, useCallback, useEffect } from 'react';
import { ColoringPage, GeneratedContent } from './types';
import { generatePostContent } from './services/aiService';
import GeneratedHtmlOutput from './components/GeneratedHtmlOutput';
import { TrashIcon } from './components/Icons';

interface PairedFile {
    id: string;
    webpFile: File;
    pdfFile: File;
    previewUrl: string;
    theme: string;
}

const cleanFilename = (filename: string): string => {
  // Removes common suffixes, case-insensitively
  const cleaned = filename.replace(/-?COLORING-?PAGES?-?for-?Kids?/i, '');
  // Replaces hyphens with spaces and trims any leftover whitespace
  return cleaned.replace(/-/g, ' ').trim();
};

const sanitizeFilenameForUrl = (filename: string): string => {
  // Replaces spaces with hyphens, removes special characters, and cleans up hyphens.
  let sanitized = filename.replace(/\s+/g, '-'); // Handle spaces

  // Handle apostrophe-S possessives, quotes, and ampersands per user request
  sanitized = sanitized.replace(/'s/ig, ''); // removes 's and 'S
  sanitized = sanitized.replace(/['"&]/g, ''); // removes leftover ', ", &

  // Clean up any resulting multiple hyphens from the removals
  sanitized = sanitized.replace(/-+/g, '-');

  // Per user request, replace "_scaled" with "-scaled" at the end of filenames.
  sanitized = sanitized.replace(/_scaled(\.webp|\.pdf)$/i, '-scaled$1');

  return sanitized;
};


const App: React.FC = () => {
  const [pairedFiles, setPairedFiles] = useState<PairedFile[]>([]);
  const [baseUrl, setBaseUrl] = useState<string>(() => {
    return localStorage.getItem('wpColoringPageGenerator_baseUrl') || 'https://yoursite.com/wp-content/uploads/';
  });
  const [useDateFolders, setUseDateFolders] = useState<boolean>(() => {
    const saved = localStorage.getItem('wpColoringPageGenerator_useDateFolders');
    return saved !== null ? JSON.parse(saved) : true;
  });
  const [generatedContent, setGeneratedContent] = useState<GeneratedContent | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'preview' | 'html'>('preview');
  
  useEffect(() => {
    localStorage.setItem('wpColoringPageGenerator_baseUrl', baseUrl);
  }, [baseUrl]);
  
  useEffect(() => {
    localStorage.setItem('wpColoringPageGenerator_useDateFolders', JSON.stringify(useDateFolders));
  }, [useDateFolders]);

  useEffect(() => {
    // Cleanup object URLs to avoid memory leaks
    return () => {
      pairedFiles.forEach(p => URL.revokeObjectURL(p.previewUrl));
    };
  }, [pairedFiles]);


  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      const newFiles = Array.from(event.target.files);
      
      setPairedFiles(prevPaired => {
        const allFiles = [...prevPaired.map(p => p.webpFile), ...prevPaired.map(p => p.pdfFile), ...newFiles];
        const uniqueFiles = Array.from(new Map(allFiles.map(f => [f.name, f])).values());

        const webpMap = new Map<string, File>();
        const pdfMap = new Map<string, File>();

        uniqueFiles.forEach(file => {
            if (file.name.endsWith('.webp')) {
                webpMap.set(file.name.replace('.webp', ''), file);
            } else if (file.name.endsWith('.pdf')) {
                pdfMap.set(file.name.replace('.pdf', ''), file);
            }
        });
        
        const newPairs: PairedFile[] = [];
        webpMap.forEach((webpFile, baseName) => {
            if (pdfMap.has(baseName)) {
                const pdfFile = pdfMap.get(baseName)!;
                 newPairs.push({
                    id: baseName,
                    webpFile: webpFile,
                    pdfFile: pdfFile,
                    previewUrl: URL.createObjectURL(webpFile),
                    theme: cleanFilename(baseName)
                });
            }
        });

        // Clean up old previews before setting new state
        prevPaired.forEach(p => URL.revokeObjectURL(p.previewUrl));
        
        return newPairs.sort((a,b) => a.id.localeCompare(b.id));
      });

      event.target.value = '';
    }
  };

  const handleThemeChange = (id: string, newTheme: string) => {
    setPairedFiles(currentPairs => 
        currentPairs.map(p => p.id === id ? { ...p, theme: newTheme } : p)
    );
  };

  const removePair = (pairId: string) => {
      setPairedFiles(currentPairs => currentPairs.filter(p => p.id !== pairId));
  };

  const handleGenerate = useCallback(async () => {
    setError(null);
    setIsLoading(true);
    setGeneratedContent(null);
    setPreviewHtml('');

    if (pairedFiles.length === 0) {
        setError("Please upload at least one matching pair of .webp and .pdf files.");
        setIsLoading(false);
        return;
    }
    if (!baseUrl.trim() || !baseUrl.startsWith('http')) {
        setError("Please provide a valid Base Upload URL (e.g., https://example.com/uploads/).");
        setIsLoading(false);
        return;
    }
    
    const imageUrlMap = new Map<string, string>();
    let pathSuffix = '';
    if (useDateFolders) {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        pathSuffix = `${year}/${month}/`;
    }

    const pagesToGenerate: ColoringPage[] = pairedFiles.map(pair => {
        const finalBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
        const imageUrl = `${finalBaseUrl}${pathSuffix}${sanitizeFilenameForUrl(pair.webpFile.name)}`;
        const pdfUrl = `${finalBaseUrl}${pathSuffix}${sanitizeFilenameForUrl(pair.pdfFile.name)}`;
        
        imageUrlMap.set(imageUrl, pair.previewUrl);

        return {
            id: pair.id,
            filename: pair.theme,
            imageUrl: imageUrl,
            pdfUrl: pdfUrl
        };
    });
    
    try {
      const content = await generatePostContent(pagesToGenerate);
      setGeneratedContent(content);

      let localPreviewHtml = content.htmlBody;
      imageUrlMap.forEach((localUrl, remoteUrl) => {
          localPreviewHtml = localPreviewHtml.split(`src="${remoteUrl}"`).join(`src="${localUrl}"`);
      });
      setPreviewHtml(localPreviewHtml);

      setActiveTab('preview');
    } catch (err: any)      {
      setError(err.message || 'An unknown error occurred.');
    } finally {
      setIsLoading(false);
    }
  }, [pairedFiles, baseUrl, useDateFolders]);

  const previewSrcDoc = `<!DOCTYPE html><html><head><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif,"Apple Color Emoji","Segoe UI Emoji","Segoe UI Symbol";line-height:1.6;color:#333;margin:2rem;}h1,h2,h3{color:#111;margin-top:1.5em;margin-bottom:0.5em;}ul,ol{padding-left:1.5em;}</style></head><body>${previewHtml || ''}</body></html>`;

  return (
    <div className="min-h-screen bg-slate-900 text-white p-4 sm:p-8 font-sans">
      <div className="max-w-4xl mx-auto">
        <header className="text-center mb-8">
          <h1 className="text-4xl sm:text-5xl font-extrabold text-sky-400">
            WordPress Coloring Page Post Generator
          </h1>
          <p className="mt-2 text-lg text-slate-400">
            Automate your content creation. Upload your files and get post-ready HTML in seconds.
          </p>
        </header>

        <main>
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6 shadow-lg">
            <div className="space-y-8">
                <div>
                    <h2 className="text-2xl font-bold text-sky-400 mb-4">1. Configure Upload Path</h2>
                    <div>
                        <label htmlFor="baseUrl" className="block text-sm font-medium text-slate-300 mb-1">Base Upload URL</label>
                        <input
                            type="url"
                            id="baseUrl"
                            value={baseUrl}
                            onChange={(e) => setBaseUrl(e.target.value)}
                            placeholder="https://your-site.com/wp-content/uploads/"
                            className="w-full bg-slate-900 border border-slate-600 rounded-md px-3 py-2 text-white focus:ring-2 focus:ring-sky-500 focus:border-sky-500 transition"
                            aria-describedby='baseUrl-help'
                        />
                        <p id="baseUrl-help" className="text-xs text-slate-500 mt-1">The path to your WordPress uploads folder.</p>
                         <div className="flex items-center mt-3">
                            <input
                                id="dateFolders"
                                type="checkbox"
                                checked={useDateFolders}
                                onChange={(e) => setUseDateFolders(e.target.checked)}
                                className="h-4 w-4 rounded border-slate-500 bg-slate-800 text-sky-600 focus:ring-sky-500"
                            />
                            <label htmlFor="dateFolders" className="ml-2 text-sm text-slate-300">
                                Append date folders (e.g., /YYYY/MM/)
                            </label>
                        </div>
                    </div>
                </div>
                <div>
                    <h2 className="text-2xl font-bold text-sky-400 mb-4">2. Upload Coloring Pages</h2>
                     <label htmlFor="file-upload" className="relative cursor-pointer bg-slate-700 hover:bg-slate-600 rounded-md font-medium text-sky-300 text-center block border-2 border-dashed border-slate-600 p-8 transition">
                        <span>Drag & drop or click to upload</span>
                        <span className="block text-xs text-slate-400 mt-1">Supports paired .webp & .pdf files</span>
                        <input id="file-upload" name="file-upload" type="file" className="sr-only" multiple onChange={handleFileChange} accept=".webp,.pdf" />
                    </label>
                </div>
            </div>

            {pairedFiles.length > 0 && (
                <div className="mt-6 border-t border-slate-700 pt-6">
                    <h3 className="text-xl font-bold text-sky-300 mb-3">File Queue ({pairedFiles.length} pairs)</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {pairedFiles.map(pair => (
                            <div key={pair.id} className="bg-slate-800 border border-slate-700 rounded-lg p-3 relative animate-fade-in group flex flex-col">
                                <img src={pair.previewUrl} alt={`Preview of ${pair.webpFile.name}`} className="w-full h-32 object-cover rounded-md mb-2" />
                                <div className="text-xs text-slate-300 truncate mb-2">
                                    <p title={pair.webpFile.name}>📄 {pair.webpFile.name}</p>
                                    <p title={pair.pdfFile.name}>📄 {pair.pdfFile.name}</p>
                                </div>
                                <div className="mt-auto">
                                    <label htmlFor={`theme-${pair.id}`} className="block text-xs font-medium text-slate-400 mb-1">Theme</label>
                                    <input
                                        type="text"
                                        id={`theme-${pair.id}`}
                                        value={pair.theme}
                                        onChange={(e) => handleThemeChange(pair.id, e.target.value)}
                                        className="w-full bg-slate-700 border border-slate-600 rounded-md px-2 py-1 text-sm text-white focus:ring-1 focus:ring-sky-500 focus:border-sky-500 transition"
                                    />
                                </div>
                                <button onClick={() => removePair(pair.id)} className="absolute top-1 right-1 text-slate-500 bg-slate-900/50 rounded-full p-1 opacity-0 group-hover:opacity-100 hover:text-red-500 transition-all" aria-label={`Remove ${pair.id} pair`}>
                                    <TrashIcon />
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}
            
            <div className="mt-6 border-t border-slate-700 pt-6">
                 <button
                    onClick={handleGenerate}
                    disabled={isLoading || pairedFiles.length === 0}
                    className="w-full bg-sky-600 hover:bg-sky-500 disabled:bg-sky-800/50 disabled:text-slate-400 disabled:cursor-not-allowed text-white font-bold py-3 px-6 rounded-md transition-colors text-lg flex items-center justify-center"
                >
                    {isLoading ? (
                    <>
                        <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 20 20">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Generating...
                    </>
                    ) : 'Generate Post HTML'}
                </button>
            </div>
          </div>
          
          {error && (
            <div className="mt-6 bg-red-900/50 border border-red-700 text-red-300 px-4 py-3 rounded-lg" role="alert">
              <strong className="font-bold">Error: </strong>
              <span className="block sm:inline">{error}</span>
            </div>
          )}

          {generatedContent && (
            <div className="mt-8">
                <div className="border-b border-slate-700">
                    <nav className="-mb-px flex space-x-6" aria-label="Tabs">
                    <button
                        onClick={() => setActiveTab('preview')}
                        className={`whitespace-nowrap py-3 px-1 border-b-2 font-medium text-sm transition-colors ${
                        activeTab === 'preview'
                            ? 'border-sky-500 text-sky-400'
                            : 'border-transparent text-slate-400 hover:text-slate-300 hover:border-slate-500'
                        }`}
                        aria-current={activeTab === 'preview' ? 'page' : undefined}
                    >
                        Preview
                    </button>
                    <button
                        onClick={() => setActiveTab('html')}
                        className={`whitespace-nowrap py-3 px-1 border-b-2 font-medium text-sm transition-colors ${
                        activeTab === 'html'
                            ? 'border-sky-500 text-sky-400'
                            : 'border-transparent text-slate-400 hover:text-slate-300 hover:border-slate-500'
                        }`}
                        aria-current={activeTab === 'html' ? 'page' : undefined}
                    >
                        HTML Code
                    </button>
                    </nav>
                </div>

                {activeTab === 'preview' && (
                    <div className="mt-4 bg-white rounded-lg p-1 sm:p-2 shadow-inner">
                        <iframe
                            srcDoc={previewSrcDoc}
                            title="Generated HTML Preview"
                            className="w-full h-[60vh] border-0 rounded-md"
                            sandbox="allow-scripts"
                        />
                    </div>
                )}

                {activeTab === 'html' && generatedContent && (
                    <GeneratedHtmlOutput content={generatedContent} />
                )}
            </div>
          )}

        </main>
         <footer className="text-center mt-12 text-slate-500 text-sm">
            <p>Powered by Google Gemini</p>
        </footer>
      </div>
    </div>
  );
};

export default App;
