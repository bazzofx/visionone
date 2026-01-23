
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { TrendMicroService } from './services/trendService';
import { analyzeDetections } from './services/geminiService';
import { Detection, QueryParams, UserConfig, SearchEndpoint } from './types';

// Memoized Stat Component
const StatCard = React.memo(({ label, value, icon, color }: { label: string; value: string | number; icon: string; color: string }) => (
  <div className="titanium-black p-3 rounded border titanium-border shadow-xl hover:border-red-600/30 transition-colors duration-300">
    <div className="flex items-center justify-between mb-1.5">
      <span className="text-gray-400 text-[8px] font-bold uppercase tracking-widest">{label}</span>
      <i className={`${icon} ${color} text-base`}></i>
    </div>
    <div className="text-xl font-black font-mono tracking-tighter">{value}</div>
  </div>
));

// Memoized Severity Component
const SeverityBadge = React.memo(({ severity }: { severity?: string }) => {
  const getColors = () => {
    switch (severity?.toLowerCase()) {
      case 'critical': return 'bg-red-600 text-white border-red-400 shadow-[0_0_10px_rgba(220,38,38,0.4)]';
      case 'high': return 'bg-orange-600 text-white border-orange-400';
      case 'medium': return 'bg-yellow-600 text-black border-yellow-400';
      case 'low': return 'bg-green-600 text-white border-green-400';
      default: return 'bg-gray-800 text-gray-300 border-gray-600';
    }
  };

  return (
    <span className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded border ${getColors()}`}>
      {severity || 'INFO'}
    </span>
  );
});

// Separate Cell Renderer
const TelemetryCell = ({ det, field }: { det: Detection, field: string }) => {
  const val = det[field];
  if (field === 'severity') return <SeverityBadge severity={val} />;
  if (field === 'eventTime') return <span className="text-[10px] text-gray-400 font-mono tracking-tighter">{new Date(val).toLocaleString()}</span>;
  if (field === 'eventName') return <span className="text-[9px] font-black text-red-500 mono bg-red-950/20 px-1.5 py-0.5 rounded border border-red-900/30 uppercase">{val}</span>;
  if (typeof val === 'object') return <span className="text-[9px] text-gray-500 mono italic">{JSON.stringify(val).substring(0, 30)}...</span>;
  return <span className="text-[11px] text-gray-300 font-semibold tracking-tight whitespace-nowrap overflow-hidden text-ellipsis max-w-[200px] block">{val || '---'}</span>;
};

// Process Chain Visualization Component v1.3 (Automated Mermaid Engine)
const ProcessChain = React.memo(({ detections, isActive }: { detections: Detection[], isActive: boolean }) => {
  const [svgContent, setSvgContent] = useState<string>('');
  const [isRendering, setIsRendering] = useState(false);

  const mermaidDefinition = useMemo(() => {
    if (!isActive || detections.length === 0) return null;

    const edges = new Set<string>();
    const nodes = new Map<string, string>(); // NodeID -> Label
    const keyToId = new Map<string, string>();
    let idCounter = 0;

    const getSafeId = (key: string) => {
      if (!keyToId.has(key)) {
        keyToId.set(key, `node_${idCounter++}`);
      }
      return keyToId.get(key)!;
    };

    const carveString = (path: string) => (path.split(/[\\/]/).pop() || path).replace(/"/g, "'").trim();

    const getIcon = (path: string) => {
      const lower = path.toLowerCase();
      if (lower.endsWith('.exe')) return '⚙️ ';
      if (lower.endsWith('.dll')) return '📦 ';
      if (lower.endsWith('.ps1') || lower.endsWith('.psm1')) return '🐚 ';
      if (lower.endsWith('.js')) return '📜 ';
      return '📄 ';
    };

    // Performance Limit: Max 100 relationships
    const telemetryBatch = detections.slice(0, 150);

    telemetryBatch.forEach(d => {
      if (edges.size > 100) return;

      const user = d.objectUser || d.suser || "System";
      const parent = d.parentFilePath || d.parentProcessName || d.parentName;
      const process = d.processFilePath || d.processName;
      const object = d.objectFilePath || d.objectName;
      const objectCmd = d.objectCmd || d.processCmd

      // Identity -> Parent -> Process -> Object
      const userId = getSafeId(`u_${user}`);
      // Fixed: nodes.set(userId) was incorrect because it expects 2 arguments. 
      // The subsequent line already correctly sets the node label.
      nodes.set(userId, `👤 ${user}`);

      if (parent) {
        const parentId = getSafeId(`p_${parent}`);
        nodes.set(parentId, `⚙️ ${carveString(parent)}`);
        edges.add(`${userId} --> ${parentId}`);

        if (process) {
          const processId = getSafeId(`pr_${process}`);
          nodes.set(processId, `${getIcon(process)}${carveString(process)}`);
          edges.add(`${parentId} --> ${processId}`);

          if (object) {
            const objectId = getSafeId(`obj_${object}`);
            nodes.set(objectId, `📄 ${carveString(object)}`);
            edges.add(`${processId} --> ${objectId}`);
          }
          if(objectCmd){
            const objectCmdId = getSafeId(`obj_${objectCmd}`);
            nodes.set(objectCmdId, `📄 ${carveString(objectCmd)}`);
            edges.add(`${processId} --> ${objectCmdId}`);
          }

        }
      } else if (process) {
        const processId = getSafeId(`pr_${process}`);
        nodes.set(processId, `${getIcon(process)}${carveString(process)}`);
        edges.add(`${userId} --> ${processId}`);
      }
    });

    if (nodes.size === 0) return null;

    let def = "graph LR\n";
    nodes.forEach((label, id) => {
      def += `${id}["${label}"]\n`;
    });
    edges.forEach(edge => {
      def += `${edge}\n`;
    });
    
    return def;
  }, [detections, isActive]);

  useEffect(() => {
    const render = async () => {
      if (mermaidDefinition && (window as any).mermaid) {
        setIsRendering(true);
        try {
          const id = `mermaid-render-${Math.random().toString(36).substr(2, 9)}`;
          const { svg } = await (window as any).mermaid.render(id, mermaidDefinition);
          setSvgContent(svg);
        } catch (e) {
          console.error("Mermaid Render Error:", e);
          setSvgContent('<div class="text-red-500 font-black p-16 uppercase text-sm">Tactical Rendering Pipeline Faulted</div>');
        } finally {
          setIsRendering(false);
        }
      } else {
        setSvgContent('');
      }
    };
    render();
  }, [mermaidDefinition]);

  const copyDefinition = () => {
    if (mermaidDefinition) {
      navigator.clipboard.writeText(mermaidDefinition);
      alert("Tactical definition copied to buffer.");
    }
  };

  if (!isActive) {
    return (
      <div className="flex flex-col items-center justify-center p-32 bg-black/40 border-b titanium-border text-center">
        <div className="w-12 h-12 border-4 border-red-900/20 border-t-red-600 rounded-full animate-spin mb-6 opacity-30"></div>
        <p className="text-[11px] font-black uppercase tracking-[0.6em] text-gray-700">Linkage Engine Offline</p>
        <p className="text-[9px] mt-3 font-mono text-gray-800 uppercase tracking-widest">Toggle "ACTIVATE ENGINE" to render telemetry canvas</p>
      </div>
    );
  }

  if (!mermaidDefinition) {
    return (
      <div className="flex flex-col items-center justify-center p-32 opacity-20 grayscale text-center">
        <i className="fa-solid fa-diagram-project text-5xl mb-6 text-red-900"></i>
        <p className="text-[11px] font-black uppercase tracking-[0.6em]">Linkage Logic Idle</p>
        <p className="text-[9px] mt-3 font-mono text-gray-600 italic">No parent/process paths detected in current buffer</p>
      </div>
    );
  }

  return (
    <div className="p-8 overflow-auto max-h-[800px] bg-black/70 scrollbar-thin flex flex-col items-center border-b titanium-border relative min-h-[480px]">
      <div className="absolute top-5 left-8 flex items-center space-x-5 z-10">
        <div className="flex items-center space-x-2.5 text-[9px] font-black text-red-600/70 uppercase tracking-[0.2em] bg-black/80 px-3 py-1.5 border border-red-900/30 rounded">
          <i className={`fa-solid fa-network-wired ${isRendering ? 'animate-spin' : 'animate-pulse'}`}></i>
          <span>{isRendering ? 'SYNCHRONIZING CANVAS...' : 'COMMAND LINK ESTABLISHED'}</span>
        </div>
        <button 
          onClick={copyDefinition}
          className="text-[8px] font-black text-gray-500 hover:text-red-500 uppercase tracking-widest bg-black/40 px-3 py-1.5 border titanium-border rounded hover:border-red-600/50 transition-all"
        >
          <i className="fa-solid fa-code mr-1.5"></i>Export Mermaid
        </button>
      </div>
      
      <div 
        className="w-full h-full flex justify-center py-16"
        dangerouslySetInnerHTML={{ __html: svgContent }} 
      />
    </div>
  );
});

// Tactical HUD Preview Component
const TacticalHUD = React.memo(({ det, columns, position }: { det: Detection, columns: string[], position: { y: number } }) => {
  if (!det) return null;
  return (
    <div 
      className="fixed z-[100] w-72 bg-black/95 border border-red-600/70 rounded shadow-[0_0_50px_rgba(239,68,68,0.4)] p-5 pointer-events-none animate-in fade-in zoom-in-95 duration-200 backdrop-blur-2xl"
      style={{ 
        top: Math.min(position.y, window.innerHeight - 450), 
        right: '25%' 
      }}
    >
      <div className="absolute -top-1 -left-1 w-4 h-4 border-t-2 border-l-2 border-red-600"></div>
      <div className="absolute -top-1 -right-1 w-4 h-4 border-t-2 border-r-2 border-red-600"></div>
      <div className="absolute -bottom-1 -left-1 w-4 h-4 border-b-2 border-l-2 border-red-600"></div>
      <div className="absolute -bottom-1 -right-1 w-4 h-4 border-b-2 border-r-2 border-red-600"></div>

      <div className="text-[11px] font-black text-red-500 uppercase tracking-[0.4em] mb-4 border-b border-red-900/60 pb-1.5 flex items-center justify-between">
        <span>Tactical Intel</span>
        <i className="fa-solid fa-bullseye text-red-600 text-sm"></i>
      </div>
      
      <div className="space-y-4 max-h-[400px] overflow-y-auto scrollbar-none">
        {columns.length > 0 ? columns.map(col => (
          <div key={col} className="border-l border-gray-900 pl-3 hover:border-red-600 transition-colors">
            <span className="text-[9px] font-black text-gray-600 uppercase block mb-0.5 tracking-[0.15em]">{col.replace(/([A-Z])/g, ' $1')}</span>
            <span className="text-[12px] text-gray-100 font-mono break-all leading-tight block">
              {typeof det[col] === 'object' ? '[STRUCTURED_DATA]' : String(det[col] || 'NULL_VALUE')}
            </span>
          </div>
        )) : (
          <div className="text-center py-5 opacity-40 grayscale">
             <i className="fa-solid fa-ghost text-3xl mb-3 block"></i>
             <p className="text-[10px] font-black uppercase tracking-[0.3em]">Empty Schema Projection</p>
          </div>
        )}
      </div>
      
      <div className="mt-5 pt-3 border-t border-red-900/60 flex justify-between items-center opacity-50">
        <span className="text-[8px] font-black text-gray-500 font-mono">NODE_HASH: {det.uuid?.substring(0,12).toUpperCase() || 'UNKNOWN'}</span>
        <span className="text-[8px] font-black text-red-600 uppercase tracking-widest">HUD_v1.3</span>
      </div>
    </div>
  );
});

// Memoized Row component
const DetectionRow = React.memo(({ 
  det, 
  columns, 
  isExpanded, 
  onToggle, 
  onHover,
  onHoverEnd,
  idx 
}: { 
  det: Detection; 
  columns: string[]; 
  isExpanded: boolean; 
  onToggle: (idx: number) => void;
  onHover: (idx: number, e: React.MouseEvent) => void;
  onHoverEnd: () => void;
  idx: number;
}) => {
  return (
    <React.Fragment>
      <tr 
        className={`hover:bg-red-600/10 transition-all duration-150 cursor-pointer group ${isExpanded ? 'bg-red-600/15' : 'odd:bg-white/[0.01]'}`} 
        onClick={() => onToggle(idx)}
        onMouseEnter={(e) => onHover(idx, e)}
        onMouseLeave={onHoverEnd}
      >
        <td className="p-3 text-center w-12 border-r titanium-border/50">
          <i className={`fa-solid fa-chevron-right transition-transform text-[9px] ${isExpanded ? 'rotate-90 text-red-500' : 'text-gray-700 group-hover:text-red-500'}`}></i>
        </td>
        {columns.map(col => (
          <td key={col} className="p-3">
            <TelemetryCell det={det} field={col} />
          </td>
        ))}
      </tr>
      {isExpanded && (
        <tr className="bg-black/95">
          <td colSpan={columns.length + 1} className="p-0 border-b border-red-900/40 shadow-inner">
            <div className="p-6 relative">
              <div className="absolute top-0 left-0 w-1 h-full bg-red-600 shadow-[2px_0_15px_rgba(239,68,68,0.5)]"></div>
              <div className="flex items-center justify-between mb-4">
                <div className="text-[11px] font-black text-red-500 uppercase tracking-[0.2em] flex items-center space-x-2.5">
                  <i className="fa-solid fa-box-open text-red-700"></i>
                  <span>Decoded Telemetry Packet: {det.uuid}</span>
                </div>
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    navigator.clipboard.writeText(JSON.stringify(det, null, 2));
                  }}
                  className="px-4 py-1.5 bg-neutral-900/80 border titanium-border rounded text-[10px] font-black text-gray-500 hover:text-red-500 hover:border-red-600 transition-all uppercase shadow-md active:scale-95"
                >
                  <i className="fa-solid fa-clone mr-2"></i>Export Object
                </button>
              </div>
              <pre className="mono text-[11px] text-gray-400 bg-[#080808] p-5 rounded border border-red-900/30 overflow-x-auto scrollbar-thin leading-relaxed selection:bg-red-600/40">
                {JSON.stringify(det, null, 2)}
              </pre>
            </div>
          </td>
        </tr>
      )}
    </React.Fragment>
  );
});

const TelemetryGraph = React.memo(({ 
  detections, 
  loading, 
  onDateClick, 
  selectedDate,
  isCollapsed,
  onToggleCollapse
}: { 
  detections: Detection[]; 
  loading: boolean; 
  onDateClick: (date: string | null) => void;
  selectedDate: string | null;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}) => {
  const chartData = useMemo(() => {
    const groups: Record<string, number> = {};
    detections.forEach(d => {
      const date = new Date(d.eventTime).toLocaleDateString();
      groups[date] = (groups[date] || 0) + 1;
    });
    return Object.entries(groups)
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .slice(-30);
  }, [detections]);

  const maxCount = Math.max(...chartData.map(d => d.count), 1);

  return (
    <div className={`titanium-black border-y titanium-border relative overflow-hidden transition-all duration-500 ease-in-out bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] ${isCollapsed ? 'h-12' : 'h-40'}`}>
      <div className="absolute inset-0 bg-gradient-to-b from-black/95 via-transparent to-black/95 pointer-events-none"></div>
      <div className="absolute inset-0 opacity-10 pointer-events-none" 
           style={{ backgroundImage: 'linear-gradient(#666 1.5px, transparent 1.5px), linear-gradient(90deg, #666 1.5px, transparent 1.5px)', backgroundSize: '48px 48px' }}>
      </div>

      <div className="relative h-full px-8 py-4 flex flex-col">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4 cursor-pointer group" onClick={onToggleCollapse}>
             <div className="w-2 h-8 bg-red-600 shadow-[0_0_15px_rgba(239,68,68,0.7)]"></div>
             <div>
               <h3 className="text-[19px] font-black uppercase tracking-[0.4em] text-gray-100 group-hover:text-red-500 transition-colors flex items-center">
                 Telemetry Density
                 <i className={`fa-solid fa-chevron-down ml-4 text-[9px] transition-transform duration-700 ${isCollapsed ? '-rotate-90 text-gray-800' : 'rotate-0 text-red-600'}`}></i>
               </h3>
               {!isCollapsed && <p className="text-[11px] text-gray-500 font-black uppercase tracking-[0.2em] mt-1 opacity-60">Temporal Logs Distribution</p>}
             </div>
          </div>
          
          <div className="flex items-center space-x-8 text-[11px] font-mono">
             {selectedDate && !isCollapsed && (
               <button 
                onClick={() => onDateClick(null)}
                className="text-[14px] text-red-500 hover:text-red-400 font-black uppercase border-b border-red-600/60 pb-1 transition-all animate-pulse"
               >
                 <i className="fa-solid fa-filter-circle-xmark mr-2.5 "></i>
                 RESET FILTER: {selectedDate}
               </button>
             )}
             <div className="flex flex-col items-end">
                <span className="text-[11px] text-gray-700 uppercase font-black tracking-widest">Log Count</span>
                <span className="text-2xl text-red-600 font-black tracking-tighter shadow-sm">{detections.length}</span>
             </div>
          </div>
        </div>

        {!isCollapsed && (
          <div className="flex-1 flex items-end space-x-2.5 mt-6 pb-2 animate-in fade-in duration-1000">
            {loading ? (
              <div className="w-full h-full flex items-center justify-center space-x-5">
                 <i className="fa-solid fa-satellite fa-spin text-red-600 text-2xl opacity-80"></i>
                 <span className="text-[11px] font-black uppercase tracking-[0.8em] animate-pulse text-red-500">Fetching Data from Trend Servers...</span>
              </div>
            ) : chartData.length === 0 ? (
              <div className="w-full h-full flex items-center justify-center">
                 <span className="text-[11px] text-gray-800 font-black uppercase tracking-[0.8em] opacity-30">No Data Found</span>
              </div>
            ) : (
              chartData.map((data, i) => {
                const isActive = selectedDate === data.date;
                return (
                  <div 
                    key={i} 
                    onClick={() => onDateClick(isActive ? null : data.date)}
                    className={`flex-1 group relative transition-all duration-700 cursor-pointer rounded-t border-x border-t ${
                      isActive 
                        ? 'bg-red-600 border-red-400 shadow-[0_0_25px_rgba(239,68,68,1)]' 
                        : 'bg-red-900/30 border-red-900/40 hover:bg-red-600/70 hover:shadow-[0_0_15px_rgba(239,68,68,0.5)]'
                    }`}
                    style={{ 
                      height: `calc(10px + ${(data.count / maxCount) * 85}%)`,
                      minWidth: '12px'
                    }}
                  >
                    <div className={`absolute -top-12 left-1/2 -translate-x-1/2 bg-black border border-red-600/80 text-red-500 text-[10px] px-4 py-2 rounded-sm opacity-0 group-hover:opacity-100 transition-opacity font-black whitespace-nowrap z-50 pointer-events-none shadow-[0_0_30px_rgba(0,0,0,0.8)] backdrop-blur-lg`}>
                      {data.date} <span className="text-gray-700 mx-2.5">|</span> {data.count} DETS
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
});

const TABS: { id: SearchEndpoint; label: string; icon: string }[] = [
  { id: 'search/endpointActivities', label: 'Endpoint', icon: 'fa-solid fa-laptop' },
  { id: 'search/detections', label: 'Detections', icon: 'fa-solid fa-shield-halved' },
  { id: 'search/mobileActivities', label: 'Mobile', icon: 'fa-solid fa-mobile-screen-button' },
  { id: 'search/networkActivities', label: 'Network', icon: 'fa-solid fa-network-wired' },
  { id: 'search/emailActivities', label: 'Email', icon: 'fa-solid fa-envelope-open-text' },
  { id: 'search/cloudActivities', label: 'Cloud', icon: 'fa-solid fa-cloud' },
  { id: 'search/containerActivities', label: 'Container', icon: 'fa-solid fa-box-archive' },
];

const App: React.FC = () => {
  const [detections, setDetections] = useState<Detection[]>([]);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<SearchEndpoint>('search/endpointActivities');
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [dateFilter, setDateFilter] = useState<string | null>(null);
  const [displayLimit, setDisplayLimit] = useState(200);
  const [isGraphCollapsed, setIsGraphCollapsed] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'chain'>('grid');
  const [isEngineActive, setIsEngineActive] = useState(true);
  
  // HUD State
  const [hoveredRowIdx, setHoveredRowIdx] = useState<number | null>(null);
  const [hudPosition, setHudPosition] = useState({ y: 0 });

  const [config, setConfig] = useState<UserConfig>(() => {
    const saved = localStorage.getItem('tmv1_config');
    return saved ? JSON.parse(saved) : { apiKey: '', region: 'eu' };
  });

  const [tmv1Query, setTmv1Query] = useState('endpointHostName:"*"');
  const [selectFields, setSelectFields] = useState('objectUser,parentFilePath,processFilePath,objectFilePath,eventName,eventTime,severity');
  
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 16);
  });
  const [endDate, setEndDate] = useState(() => {
    return new Date().toISOString().slice(0, 16);
  });

  useEffect(() => {
    localStorage.setItem('tmv1_config', JSON.stringify(config));
  }, [config]);

  const toggleRow = useCallback((idx: number) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }, []);

  const handleHover = useCallback((idx: number, e: React.MouseEvent) => {
    setHoveredRowIdx(idx);
    setHudPosition({ y: e.clientY });
  }, []);

  const handleHoverEnd = useCallback(() => {
    setHoveredRowIdx(null);
  }, []);

  const handleFetch = async () => {
    setLoading(true);
    setShowAdvanced(false);
    setError(null);
    setAnalysis(null);
    setExpandedRows(new Set());
    setDateFilter(null);
    setDisplayLimit(200);
    
    try {
      const service = new TrendMicroService(config);
      const params: QueryParams = {
        startDateTime: new Date(startDate).toISOString(),
        endDateTime: new Date(endDate).toISOString(),
        top: 5000,
        mode: "default",
        select: selectFields
      };

      const data = await service.search(activeTab, tmv1Query, params);
      setDetections(data.items || []);
    } catch (err: any) {
      setError(err.message || "XDR API Transmission Error");
    } finally {
      setLoading(false);
    }
  };

  const filteredDetections = useMemo(() => {
    if (!dateFilter) return detections;
    return detections.filter(d => new Date(d.eventTime).toLocaleDateString() === dateFilter);
  }, [detections, dateFilter]);

  const visibleDetections = useMemo(() => {
    return filteredDetections.slice(0, displayLimit);
  }, [filteredDetections, displayLimit]);

  const handleAnalyze = async () => {
    if (filteredDetections.length === 0) return;
    setAnalyzing(true);
    setError(null);
    try {
      const result = await analyzeDetections(filteredDetections);
      setAnalysis(result);
    } catch (err: any) {
      console.error("Analysis Failed:", err);
      setError(`Gemini Intelligence Error: ${err.message || 'Check connection to model.'}`);
    } finally {
      setAnalyzing(false);
    }
  };

  const columns = useMemo(() => selectFields.split(',').map(f => f.trim()).filter(f => f.length > 0), [selectFields]);

  return (
    <div className="min-h-screen flex flex-col bg-[#050505] text-gray-100 overflow-x-hidden">
      {/* Header */}
      <header className="h-16 bg-black border-b border-red-900/50 flex items-center justify-between px-8 z-50">
        <div className="flex items-center space-x-5">
          <div className="w-10 h-10 bg-red-700 rounded-sm flex items-center justify-center rotate-45 shadow-[0_0_20px_rgba(239,68,68,0.6)] border border-white/30 group cursor-pointer hover:scale-110 transition-transform">
            <i className="fa-solid fa-shield-virus text-white text-lg -rotate-45 group-hover:animate-pulse"></i>
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tighter leading-none">
              VISION <span className="text-red-600">ONE - XDR</span>
            </h1>
            <p className="text-[8px] font-black tracking-[0.5em] text-gray-500 uppercase mt-1.5">The Search you need when shit goes down</p>
          </div>
        </div>
        
        <div className="flex items-center space-x-6">
          <div className={`hidden md:flex items-center space-x-3.5 px-4 py-1.5 bg-neutral-900/90 rounded-sm border border-titanium-border backdrop-blur-xl shadow-inner`}>
            <div className={`w-2 h-2 rounded-full ${loading ? 'bg-orange-500 animate-pulse' : 'bg-green-600 shadow-[0_0_10px_#16a34a]'}`}></div>
            <span className="text-[9px] font-black font-mono text-gray-400 uppercase tracking-[0.15em]">{loading ? 'Fetching Data' : 'Data Ready '}</span>
          </div>
          <button 
            onClick={() => {
              const region = prompt("Select Node Region (eu, us, sg, jp, au):", config.region);
              if (region) setConfig(prev => ({ ...prev, region: region as any }));
            }}
            className="text-[10px] font-black text-red-500 border border-red-900/60 bg-red-950/20 px-5 py-2 rounded hover:bg-red-600 hover:text-white transition-all uppercase tracking-[0.15em] shadow-[0_0_12px_rgba(239,68,68,0.2)]"
          >
            NODE: {config.region.toUpperCase()}
          </button>
        </div>
      </header>

      {/* Primary Navigation Tabs */}
      <div className="bg-[#080808] border-b border-titanium-border px-8 py-1 flex space-x-2.5 overflow-x-auto scrollbar-none shadow-2xl relative">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center space-x-3 px-6 py-4 text-[12px] font-black uppercase tracking-[0.15em] transition-all relative group ${
              activeTab === tab.id ? 'text-red-500' : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            <i className={`${tab.icon} text-lg ${activeTab === tab.id ? 'text-red-500' : 'text-gray-700 group-hover:text-red-400'}`}></i>
            <span>{tab.label}</span>
            {activeTab === tab.id && <div className="absolute bottom-0 left-0 w-full h-0.5 bg-red-600 shadow-[0_0_15px_#ef4444]"></div>}
          </button>
        ))}
      </div>

      {/* Command Bar / Tactical Input */}
      <div className="bg-[#101010] border-b titanium-border shadow-2xl relative z-40">
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center px-8">
          <div className="flex items-center space-x-6 border-r titanium-border pr-8 py-5">
             <div className="flex flex-col">
               <span className="text-[14px] font-black text-gray-600 uppercase mb-1.5 tracking-[0.2em]">Start Date</span>
               <input 
                  type="datetime-local" 
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="bg-black border-red-900/50 border rounded-sm px-4 py-2.5 text-[14px] font-mono text-gray-200 focus:border-red-600 outline-none transition-all shadow-inner"
                />
             </div>
             <i className="fa-solid fa-arrow-right-long text-red-900 mt-5 text-lg"></i>
             <div className="flex flex-col">
               <span className="text-[14px] font-black text-gray-600 uppercase mb-1.5 tracking-[0.2em]">End Date</span>
               <input 
                  type="datetime-local" 
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="bg-black border-red-900/50 border rounded-sm px-4 py-2.5 text-[14px] font-mono text-gray-200 focus:border-red-600 outline-none transition-all shadow-inner"
                />
             </div>
          </div>

          <div className="flex-1 flex items-center px-8 py-5">
             <div className="w-full relative group">
                <i className="fa-solid fa-crosshairs absolute left-4 top-1/2 -translate-y-1/2 text-gray-700 group-focus-within:text-red-500 transition-colors text-base"></i>
                <input 
                  type="text"
                  placeholder="EXECUTE SCAN PROTOCOL..."
                  value={tmv1Query.substring(0, 80) + (tmv1Query.length > 80 ? '...' : '')}
                  readOnly
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="w-full bg-black border titanium-border rounded-sm pl-12 pr-5 py-4 text-[15px] text-gray-400 font-mono cursor-pointer hover:border-red-600/60 transition-all shadow-2xl"
                />
                <button 
                   onClick={() => setShowAdvanced(!showAdvanced)}
                   className="absolute right-5 top-1/2 -translate-y-1/2 text-[9px] font-black text-red-500 hover:text-red-400 uppercase tracking-[0.15em] border border-red-900/60 px-3 py-1 bg-red-950/30 rounded-sm"
                >
                   {showAdvanced ? 'Close Matrix' : 'Open Matrix'}
                </button>
             </div>
          </div>

          <div className="py-5 pl-8 border-l titanium-border flex items-center">
             <div className="flex flex-col items-end">

                <button 
                  onClick={handleFetch}
                  disabled={loading}
                  className="h-13 px-11 bg-red-800 hover:bg-red-600 disabled:bg-red-950/60 text-white font-black rounded-sm shadow-[0_0_25px_rgba(239,68,68,0.5)] transition-all active:scale-95 flex items-center space-x-4 uppercase text-[15px] tracking-[0.2em] border border-red-500/50"
                >
                  {loading ? (
                    <><i className="fa-solid fa-sync fa-spin"></i><span>SEARCHING...</span></>
                  ) : (
                    <><i className="fa-solid fa-satellite text-2xl"></i><span>SEARCH</span></>
                  )}
                </button>
             </div>
          </div>
        </div>

        {showAdvanced && (
          <div className="bg-black border-t titanium-border px-8 py-10 animate-in slide-in-from-top-6 duration-400 shadow-2xl">
             <div className="grid grid-cols-2 gap-12">
                <div className="space-y-4">
                  <label className="text-[14px] font-black text-red-500 uppercase tracking-[0.2em] flex items-center">
                    <i className="fa-solid fa-terminal mr-3"></i> Search Query Logic
                  </label>
                  <textarea 
                    value={tmv1Query}
                    onChange={(e) => setTmv1Query(e.target.value)}
                    className="w-full h-32 bg-[#050505] border border-red-900/60 rounded-sm p-5 font-mono text-[14px] text-red-100 focus:border-red-600 outline-none transition-all leading-relaxed shadow-inner"
                    placeholder='endpointHostName:"*"'
                  />
                </div>
                <div className="space-y-4">
                  <label className="text-[14px] font-black text-gray-500 uppercase tracking-[0.2em] flex items-center">
                    <i className="fa-solid fa-layer-group mr-3"></i> Schema Project Matrix
                  </label>
                  <textarea 
                    value={selectFields}
                    onChange={(e) => setSelectFields(e.target.value)}
                    className="w-full h-32 bg-[#050505] border titanium-border rounded-sm p-5 font-mono text-[14px] text-gray-400 focus:border-red-600 outline-none transition-all leading-relaxed shadow-inner"
                    placeholder="objectUser, parentFilePath, processFilePath, objectFilePath, eventName, severity..."
                  />
                </div>
             </div>
          </div>
        )}
      </div>

      <TelemetryGraph 
        detections={detections} 
        loading={loading} 
        onDateClick={setDateFilter} 
        selectedDate={dateFilter}
        isCollapsed={isGraphCollapsed}
        onToggleCollapse={() => setIsGraphCollapsed(!isGraphCollapsed)}
      />

      <main className="mt-4 flex-1 p-8 overflow-y-auto relative bg-[#050505]">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-10">
          <div className="lg:col-span-3">
            <div className="titanium-black rounded-sm border titanium-border overflow-hidden shadow-[0_0_40px_rgba(0,0,0,0.8)] bg-[#0a0a0a]">
              
              {/* Strategic Navigation Controller */}
              <div className="bg-[#0f0f0f] border-b titanium-border px-6 py-3.5 flex items-center justify-between shadow-lg">
                <div className="flex items-center space-x-2.5">
                  <button 
                    onClick={() => setViewMode('grid')}
                    className={`px-6 py-2.5 text-[12px] font-black uppercase tracking-[0.2em] rounded-sm transition-all flex items-center space-x-3.5 ${viewMode === 'grid' ? 'bg-red-800 text-white shadow-[0_0_15px_rgba(239,68,68,0.6)] border border-red-500' : 'text-gray-500 hover:text-gray-300 hover:bg-neutral-900'}`}
                  >
                    <i className="fa-solid fa-table-list"></i>
                    <span>Telemetry Grid</span>
                  </button>
                  <button 
                    onClick={() => setViewMode('chain')}
                    className={`px-6 py-2.5 text-[12px] font-black uppercase tracking-[0.2em] rounded-sm transition-all flex items-center space-x-3.5 ${viewMode === 'chain' ? 'bg-red-800 text-white shadow-[0_0_15px_rgba(239,68,68,0.6)] border border-red-500' : 'text-gray-500 hover:text-gray-300 hover:bg-neutral-900'}`}
                  >
                    <i className="fa-solid fa-diagram-successor"></i>
                    <span>Process Chain</span>
                  </button>
                  {viewMode === 'chain' && (
                    <button 
                      onClick={() => setIsEngineActive(!isEngineActive)}
                      className={`ml-3 px-5 py-1.5 text-[9px] font-black uppercase tracking-widest rounded-sm border transition-all ${isEngineActive ? 'bg-red-600/10 border-red-600 text-red-500 hover:bg-red-600 hover:text-white' : 'bg-gray-800/20 border-gray-700 text-gray-500 hover:border-red-600'}`}
                    >
                      <i className={`fa-solid ${isEngineActive ? 'fa-power-off' : 'fa-play'} mr-1.5`}></i>
                      {isEngineActive ? 'ENGINE_ACTIVE' : 'ACTIVATE ENGINE'}
                    </button>
                  )}
                </div>
                <div className="flex items-center space-x-5">
                  <span className="text-[10px] font-black text-gray-700 uppercase tracking-[0.3em] border-r titanium-border pr-5">VIEW: {viewMode.toUpperCase()}</span>
                  <span className="text-[10px] font-black text-red-600/70 uppercase tracking-[0.3em] animate-pulse">Logs Scope: {filteredDetections.length} NODES</span>
                </div>
              </div>

              <div className="overflow-x-auto max-h-[1100px] scrollbar-thin">
                {viewMode === 'grid' ? (
                  <table className="w-full text-left border-separate border-spacing-0 table-fixed">
                    <thead className="sticky top-0 bg-[#0d0d0d] z-10 shadow-2xl border-b titanium-border">
                      <tr>
                        <th className="p-5 w-14 border-b titanium-border text-center">
                          <i className="fa-solid fa-fingerprint text-gray-800 text-[12px]"></i>
                        </th>
                        {columns.map(col => (
                          <th key={col} className="p-5 text-[11px] font-black text-gray-500 uppercase tracking-[0.2em] border-b titanium-border bg-[#0d0d0d]">
                            {col.replace(/([A-Z])/g, ' $1')}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y titanium-border">
                      {visibleDetections.length === 0 ? (
                        <tr>
                          <td colSpan={columns.length + 1} className="p-52 text-center bg-black/30">
                            <div className="flex flex-col items-center opacity-20 grayscale group">
                              {loading ? (
                                <div className="flex flex-col items-center">
                                  <i className="fa-solid fa-satellite-dish fa-spin text-7xl mb-8 text-red-600"></i>
                                  <p className="text-[14px] font-black uppercase tracking-[0.8em] animate-pulse text-red-500">Establishing Connection...</p>
                                </div>
                              ) : (
                                <>
                                  <i className="fa-solid fa-database text-7xl mb-8 text-red-900"></i>
                                  <p className="text-[14px] font-black uppercase tracking-[0.8em]">DATA Pipeline Empty</p>
                                  <p className="text-[10px] mt-5 font-mono text-gray-600 uppercase tracking-widest">Re-calculate search matrix parameters</p>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      ) : (
                        visibleDetections.map((det, idx) => (
                          <DetectionRow 
                            key={det.uuid || idx} 
                            det={det} 
                            columns={columns} 
                            isExpanded={expandedRows.has(idx)}
                            onToggle={toggleRow}
                            onHover={handleHover}
                            onHoverEnd={handleHoverEnd}
                            idx={idx}
                          />
                        ))
                      )}
                    </tbody>
                  </table>
                ) : (
                  <ProcessChain detections={filteredDetections} isActive={isEngineActive} />
                )}
              </div>
              
              {viewMode === 'grid' && filteredDetections.length > displayLimit && (
                <div className="p-8 bg-black border-t titanium-border text-center shadow-inner">
                  <button 
                    onClick={() => setDisplayLimit(prev => prev + 200)}
                    className="text-[12px] font-black text-gray-500 hover:text-red-500 uppercase tracking-[0.4em] border border-titanium-border px-12 py-4 rounded-sm transition-all hover:bg-red-950/20 hover:border-red-600/60 shadow-lg active:scale-95"
                  >
                    Fetch remaining Logs (Showing {displayLimit} / {filteredDetections.length})
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-8">


            {filteredDetections.length > 0 && (
              <div className="titanium-black border border-red-900/50 rounded-sm p-8 space-y-5 shadow-2xl relative overflow-hidden bg-gradient-to-br from-[#141414] to-[#080808]">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-red-600 to-transparent shadow-[0_0_15px_#ef4444]"></div>
                <div className="flex items-center space-x-3 text-red-500 mb-3">
                  <i className="fa-solid fa-microchip text-xl"></i>
                  <span className="text-[25px] font-black uppercase tracking-[0.25em]">ASK AI</span>
                </div>
                <p className="text-[12px] text-gray-400 uppercase font-black leading-relaxed tracking-widest opacity-80">
                  Generate a comprehensive analysis of the {filteredDetections.length} telemetry clusters using Gemini 3.
                </p>
                <button 
                  onClick={handleAnalyze}
                  disabled={analyzing}
                  className="w-full py-5 bg-red-700/10 border border-red-600/50 text-red-500 hover:bg-red-700 hover:text-white font-black text-[12px] uppercase tracking-[0.3em] rounded-sm transition-all shadow-2xl active:scale-95 group"
                >
                  {analyzing ? (
                    <><i className="fa-solid fa-sync fa-spin mr-3"></i><span>ANALYZING...</span></>
                  ) : (
                    <><i className="fa-solid fa-sparkles mr-3 group-hover:animate-bounce"></i><span>DECODE THREATS</span></>
                  )}
                </button>
              </div>
            )}

            {analysis && (
              <div className="titanium-black border border-red-900/60 rounded-sm p-8 relative overflow-hidden animate-in fade-in slide-in-from-bottom-10 duration-600 shadow-2xl bg-[#060606]">
                <div className="absolute top-0 right-0 p-5 opacity-5 pointer-events-none">
                   <i className="fa-solid fa-shield-halved text-8xl text-red-600"></i>
                </div>
                <h3 className="text-[14px] font-black text-red-500 uppercase tracking-[0.4em] mb-6 flex items-center">
                  <span className="w-2 h-2 bg-red-600 rounded-full mr-3 shadow-[0_0_10px_#ef4444] animate-pulse"></span>
                  TACTICAL INTEL REPORT
                </h3>
                <div className="prose prose-invert max-w-none text-[13px] leading-loose text-gray-300 font-medium max-h-[640px] overflow-y-auto scrollbar-thin pr-5 selection:bg-red-700/40">
                   <ReactMarkdown remarkPlugins={[remarkGfm]}>{analysis}</ReactMarkdown>
                </div>
              </div>
            )}

            {error && (
              <div className="bg-red-950/50 border-l-4 border-red-600 p-6 rounded-sm shadow-2xl animate-in slide-in-from-right-8 duration-400">
                <div className="flex items-center space-x-3 text-red-500 mb-4">
                  <i className="fa-solid fa-triangle-exclamation text-xl"></i>
                  <span className="text-[14px] font-black uppercase tracking-[0.3em]">SYSTEM_FAULT</span>
                </div>
                <p className="text-[12px] text-red-200/90 font-mono leading-loose bg-black/80 p-5 rounded-sm border border-red-900/40 shadow-inner">{error}</p>
                <p className="text-[9px] text-gray-600 mt-6 uppercase font-black tracking-widest">Action Required: Reset Protocol Uplink. Check Bearer Token.</p>
              </div>
            )}
          </div>
        </div>

        {/* Floating HUD Preview v1.2 */}
        {viewMode === 'grid' && hoveredRowIdx !== null && visibleDetections[hoveredRowIdx] && (
          <TacticalHUD 
            det={visibleDetections[hoveredRowIdx]} 
            columns={columns} 
            position={hudPosition} 
          />
        )}
      </main>

      <footer className="h-12 border-t titanium-border bg-black flex justify-between items-center px-8 text-[9px] font-black text-gray-700 uppercase tracking-[0.5em]">
        <div className="flex items-center space-x-10">
          <span className="text-red-800 flex items-center space-x-3">
             <span className="w-2 h-2 bg-red-800 rounded-full animate-pulse shadow-[0_0_8px_#b91c1c]"></span>
             <span className="font-black">UPLINK_STABLE</span>
          </span>
          <span className="border-l titanium-border pl-10">STRATEGIC COMMAND // VERSION 1.3</span>
        </div>
        <div className="flex items-center space-x-8">
           <span className="text-gray-900 font-black">CORE_SHIELD: NOMINAL</span>
           <span className="text-gray-600 font-black border border-gray-900 px-3 py-1 rounded-sm">AUTH: SECURE_LINK</span>
        </div>
      </footer>
    </div>
  );
};

export default App;
