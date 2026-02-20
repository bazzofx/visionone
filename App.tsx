import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { TrendMicroService } from './services/trendService';
import { analyzeDetections } from './services/localLLMService';
import { NetworkChain } from './services/NetworkChain';
import { Detection, QueryParams, UserConfig, SearchEndpoint } from './types';

// Backend internal server
const API_BASE_URL = 'http://localhost:3001/api';

// Constants - Move outside component to prevent recreation
const TABS: { id: SearchEndpoint; label: string; icon: string }[] = [
  { id: 'search/endpointActivities', label: 'Endpoint', icon: 'fa-solid fa-laptop' },
  { id: 'search/networkActivities', label: 'Network', icon: 'fa-solid fa-network-wired' },
  { id: 'search/detections', label: 'Detections', icon: 'fa-solid fa-shield-halved' },
  { id: 'search/mobileActivities', label: 'Mobile', icon: 'fa-solid fa-mobile-screen-button' },
  { id: 'search/emailActivities', label: 'Email', icon: 'fa-solid fa-envelope-open-text' },
  { id: 'search/cloudActivities', label: 'Cloud', icon: 'fa-solid fa-cloud' },
  { id: 'search/containerActivities', label: 'Container', icon: 'fa-solid fa-box-archive' },
];

// Severity color map - Cache for badge colors
const SEVERITY_COLORS = {
  critical: 'bg-red-600 text-white border-red-400 shadow-[0_0_10px_rgba(220,38,38,0.4)]',
  high: 'bg-orange-600 text-white border-orange-400',
  medium: 'bg-yellow-600 text-black border-yellow-400',
  low: 'bg-green-600 text-white border-green-400',
  default: 'bg-gray-800 text-gray-300 border-gray-600'
};

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

// Memoized Severity Badge
const SeverityBadge = React.memo(({ severity }: { severity?: string }) => {
  const getColors = () => {
    const key = severity?.toLowerCase() || 'default';
    return SEVERITY_COLORS[key as keyof typeof SEVERITY_COLORS] || SEVERITY_COLORS.default;
  };

  return (
    <span className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded border ${getColors()}`}>
      {severity || 'INFO'}
    </span>
  );
});

// Telemetry Cell Renderer - Memoized with custom comparison
const TelemetryCell = React.memo(({ det, field }: { det: Detection, field: string }) => {
  const val = det[field];
  
  if (field === 'severity') return <SeverityBadge severity={val} />;
  if (field === 'eventTime') {
    const dateStr = useMemo(() => new Date(val).toLocaleString(), [val]);
    return <span className="text-[12px] text-gray-400 font-mono tracking-tighter">{dateStr}</span>;
  }
  if (field === 'eventName') return <span className="text-[11px] font-black text-red-500 mono bg-red-950/20 px-1.5 py-0.5 rounded border border-red-900/30 uppercase">{val}</span>;
  if (typeof val === 'object') return <span className="text-[12px] text-gray-500 mono italic">{JSON.stringify(val).substring(0, 30)}...</span>;
  return <span className="text-[14px] text-gray-300 font-semibold tracking-tight whitespace-nowrap overflow-hidden text-ellipsis max-w-[200px] block">{val || '---'}</span>;
}, (prev, next) => {
  // Custom comparison to prevent unnecessary re-renders
  return prev.det === next.det && prev.field === next.field;
});

// Process Chain Component - Extracted helper functions outside
const carveString = (path: string) => (path.split(/[\\/]/).pop() || path).replace(/"/g, "'").trim();

const getIcon = (path: string) => {
  const lower = path.toLowerCase();
  if (lower.endsWith('.exe')) return '⚙️ ';
  if (lower.endsWith('.dll')) return '📦 ';
  if (lower.endsWith('.ps1') || lower.endsWith('.psm1')) return '🐚 ';
  if (lower.endsWith('.js')) return '📜 ';
  return '📄 ';
};

const ProcessChain = React.memo(({ detections, isActive }: { detections: Detection[], isActive: boolean }) => {
  const [svgContent, setSvgContent] = useState<string>('');
  const [isRendering, setIsRendering] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [panPosition, setPanPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const svgContainerRef = useRef<HTMLDivElement>(null);
  
  // Cache for getSafeId - reset when detections change
  const idCache = useRef<Map<string, string>>(new Map());
  const idCounter = useRef(0);

  const getSafeId = useCallback((key: string) => {
    if (!idCache.current.has(key)) {
      idCache.current.set(key, `n${idCounter.current++}`);
    }
    return idCache.current.get(key)!;
  }, []);

  // Reset cache when detections change
  useEffect(() => {
    idCache.current.clear();
    idCounter.current = 0;
  }, [detections]);

  const mermaidDefinition = useMemo(() => {
    if (!isActive || detections.length === 0) return null;
    
    const edges = new Set<string>();
    const nodes = new Map<string, string>();
    const telemetryBatch = detections.slice(0, 150);
//  ------------ Calculate Connections start
    telemetryBatch.forEach(d => {
      if (edges.size > 100) return;

      const user = d.objectUser || d.suser || "System";
      const parent = d.parentFilePath || d.parentProcessName || d.parentName;
      const process = d.processName;
      const object = d.objectFilePath || d.objectName;
      const objectCmd = d.objectCmd || d.processCmd;

      const userId = getSafeId(`u_${user}`);
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
          
          if (objectCmd) {
            const objectCmdId = getSafeId(`cmd_${objectCmd}`);
            nodes.set(objectCmdId, `⚙️ ${carveString(objectCmd)}`);
            edges.add(`${processId} --> ${objectCmdId}`);
          }
        }
      } else if (process) {
        const processId = getSafeId(`pr_${process}`);
        nodes.set(processId, `${getIcon(process)}${carveString(process)}`);
        edges.add(`${userId} --> ${processId}`);

        if (object) {
          const objectId = getSafeId(`obj_${object}`);
          nodes.set(objectId, `📄 ${carveString(object)}`);
          edges.add(`${processId} --> ${objectId}`);
        }
        
        if (objectCmd) {
          const objectCmdId = getSafeId(`cmd_${objectCmd}`);
          nodes.set(objectCmdId, `⚙️ ${carveString(objectCmd)}`);
          edges.add(`${processId} --> ${objectCmdId}`);
        }
      }
    });
// ------------ Calculate Connections end
    if (nodes.size === 0) return null;
    
    let def = "graph LR\n";
    
    nodes.forEach((label, id) => {
      def += `    ${id}["${label}"]\n`;
    });
    
    edges.forEach(edge => {
      def += `    ${edge}\n`;
    });
    
    return def;
  }, [detections, isActive, getSafeId]);

  useEffect(() => {
    let isMounted = true;
    
    const render = async () => {
      if (mermaidDefinition && (window as any).mermaid) {
        setIsRendering(true);
        try {
          const id = `mermaid-proc-${Math.random().toString(36).substr(2, 9)}`;
          const { svg } = await (window as any).mermaid.render(id, mermaidDefinition);
          if (isMounted) {
            setSvgContent(svg);
            setZoomLevel(1);
            setPanPosition({ x: 0, y: 0 });
          }
        } catch (e) {
          if (isMounted) {
            console.error('Mermaid render error:', e);
            setSvgContent('<div class="text-red-500 font-black p-16">Render Faulted</div>');
          }
        } finally {
          if (isMounted) setIsRendering(false);
        }
      }
    };
    
    render();
    return () => { isMounted = false; };
  }, [mermaidDefinition]);

  // Memoize handlers
  const handleZoomIn = useCallback(() => {
    setZoomLevel(prev => Math.min(prev + 0.25, 3));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoomLevel(prev => Math.max(prev - 0.25, 0.5));
  }, []);

  const handleReset = useCallback(() => {
    setZoomLevel(1);
    setPanPosition({ x: 0, y: 0 });
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 0) {
      setIsDragging(true);
      setDragStart({ 
        x: e.clientX - panPosition.x, 
        y: e.clientY - panPosition.y 
      });
    }
  }, [panPosition.x, panPosition.y]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isDragging) {
      setPanPosition({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y
      });
    }
  }, [isDragging, dragStart.x, dragStart.y]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setZoomLevel(prev => Math.max(0.5, Math.min(3, prev + delta)));
  }, []);

  // Memoize export functions
  const exportAsPNG = useCallback(() => {
    const svgElement = svgContainerRef.current?.querySelector('svg');
    if (!svgElement) return;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const svgData = new XMLSerializer().serializeToString(svgElement);
    const img = new Image();

    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx?.drawImage(img, 0, 0);
      
      const pngData = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.download = `process-chain-${new Date().toISOString().slice(0, 10)}.png`;
      link.href = pngData;
      link.click();
    };

    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
  }, []);

  const exportAsSVG = useCallback(() => {
    const svgElement = svgContainerRef.current?.querySelector('svg');
    if (!svgElement) return;

    const svgData = new XMLSerializer().serializeToString(svgElement);
    const blob = new Blob([svgData], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.download = `process-chain-${new Date().toISOString().slice(0, 10)}.svg`;
    link.href = url;
    link.click();
    
    URL.revokeObjectURL(url);
  }, []);

  const exportAsMermaid = useCallback(() => {
    if (mermaidDefinition) {
      const blob = new Blob([mermaidDefinition], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      
      const link = document.createElement('a');
      link.download = `process-chain-${new Date().toISOString().slice(0, 10)}.mmd`;
      link.href = url;
      link.click();
      
      URL.revokeObjectURL(url);
    }
  }, [mermaidDefinition]);

  if (!isActive) return null;
  
  return (
    <div className="flex flex-col w-full h-full bg-black/70 relative min-h-[600px]">
      <div className="flex items-center justify-between p-4 border-b border-red-900/30 bg-black/90 sticky top-0 z-20">
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2 bg-black/50 rounded-lg border border-red-900/30 p-1">
            <button onClick={handleZoomOut} className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-950/30 rounded transition-all" title="Zoom Out">
              <i className="fa-solid fa-minus"></i>
            </button>
            <span className="text-[12px] font-mono text-gray-400 w-16 text-center">{Math.round(zoomLevel * 100)}%</span>
            <button onClick={handleZoomIn} className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-950/30 rounded transition-all" title="Zoom In">
              <i className="fa-solid fa-plus"></i>
            </button>
            <button onClick={handleReset} className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-950/30 rounded transition-all ml-2" title="Reset View">
              <i className="fa-solid fa-arrows-to-circle"></i>
            </button>
          </div>
          
          <div className="flex items-center space-x-2 border-l border-red-900/30 pl-4">
            <button onClick={exportAsPNG} className="px-3 py-1.5 text-[11px] font-black text-gray-400 hover:text-red-500 border border-red-900/30 hover:border-red-600/50 rounded flex items-center space-x-2 transition-all">
              <i className="fa-solid fa-camera"></i><span>PNG</span>
            </button>
            <button onClick={exportAsSVG} className="px-3 py-1.5 text-[11px] font-black text-gray-400 hover:text-red-500 border border-red-900/30 hover:border-red-600/50 rounded flex items-center space-x-2 transition-all">
              <i className="fa-solid fa-code"></i><span>SVG</span>
            </button>
            <button onClick={exportAsMermaid} className="px-3 py-1.5 text-[11px] font-black text-gray-400 hover:text-red-500 border border-red-900/30 hover:border-red-600/50 rounded flex items-center space-x-2 transition-all">
              <i className="fa-solid fa-diagram-project"></i><span>MMD</span>
            </button>
          </div>
        </div>
        
        <div className="flex items-center space-x-3 text-[10px] text-gray-600">
          <i className="fa-solid fa-arrows-up-down-left-right"></i><span>Drag to pan</span>
          <span className="mx-2">|</span>
          <i className="fa-solid fa-mouse-pointer"></i><span>Scroll to zoom</span>
        </div>
      </div>

      <div ref={containerRef} className="flex-1 overflow-hidden relative cursor-grab active:cursor-grabbing min-h-[500px]" 
           style={{ overscrollBehavior: 'none' }}
           onMouseDown={handleMouseDown}
           onMouseMove={handleMouseMove}
           onMouseUp={handleMouseUp}
           onMouseLeave={handleMouseUp}
           onWheel={handleWheel}>
        <div ref={svgContainerRef} className="absolute inset-0 flex items-center justify-center"
             style={{ transform: `scale(${zoomLevel}) translate(${panPosition.x}px, ${panPosition.y}px)`,
                      transformOrigin: 'center center',
                      transition: isDragging ? 'none' : 'transform 0.1s ease' }}
             dangerouslySetInnerHTML={{ __html: svgContent }} />
      </div>

      {isRendering && (
        <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-30">
          <div className="text-center">
            <i className="fa-solid fa-spinner fa-spin text-4xl text-red-600 mb-4"></i>
            <p className="text-[12px] font-black text-red-500 uppercase tracking-[0.3em]">Rendering Process Chain...</p>
          </div>
        </div>
      )}

      {!isRendering && (!svgContent || svgContent.includes('Render Faulted')) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center p-20 opacity-20 grayscale">
          <i className="fa-solid fa-diagram-project text-7xl mb-8 text-red-900"></i>
          <p className="text-[14px] font-black uppercase tracking-[0.8em]">No Process Chain Available</p>
          <p className="text-[11px] mt-4 font-mono text-gray-600 italic">No valid process flow patterns detected</p>
        </div>
      )}
    </div>
  );
});

// Tactical HUD Preview
const TacticalHUD = React.memo(({ det, columns, position }: { det: Detection, columns: string[], position: { y: number } }) => {
  if (!det) return null;
  
  const top = useMemo(() => Math.min(position.y, window.innerHeight - 450), [position.y]);
  
  return (
    <div className="fixed z-[100] w-72 bg-black/95 border border-red-600/70 rounded shadow-[0_0_50px_rgba(239,68,68,0.4)] p-5 pointer-events-none animate-in fade-in zoom-in-95 duration-200 backdrop-blur-2xl"
         style={{ top, right: '25%' }}>
      <div className="text-[11px] font-black text-red-500 uppercase tracking-[0.4em] mb-4 border-b border-red-900/60 pb-1.5 flex items-center justify-between">
        <span>Tactical Intel</span>
        <i className="fa-solid fa-bullseye text-red-600 text-sm"></i>
      </div>
      <div className="space-y-4 max-h-[400px] overflow-y-auto scrollbar-none">
        {columns.map(col => (
          <div key={col} className="border-l border-gray-900 pl-3 hover:border-red-600 transition-colors">
            <span className="text-[12px] font-black text-gray-600 uppercase block mb-0.5 tracking-[0.15em]">{col.replace(/([A-Z])/g, ' $1')}</span>
            <span className="text-[14px] text-gray-100 font-mono break-all leading-tight block">
              {typeof det[col] === 'object' ? '[STRUCTURED_DATA]' : String(det[col] || 'NULL_VALUE')}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
});

// Telemetry Density Graph
const TelemetryGraph = React.memo(({ detections, loading, onDateClick, selectedDate, isCollapsed, onToggleCollapse, uniqueStats }: any) => {
  const chartData = useMemo(() => {
    const groups: Record<string, number> = {};
    const now = Date.now();
    
    detections.forEach((d: any) => {
      const date = new Date(d.eventTime).toLocaleDateString();
      groups[date] = (groups[date] || 0) + 1;
    });
    
    return Object.entries(groups)
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .slice(-30);
  }, [detections]);

  const maxCount = useMemo(() => Math.max(...chartData.map(d => d.count), 1), [chartData]);

  const handleDateClick = useCallback((date: string | null) => {
    onDateClick(date);
  }, [onDateClick]);

  return (
    <div className={`titanium-black border-y titanium-border relative overflow-hidden transition-all duration-500 ease-in-out bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] ${isCollapsed ? 'h-12' : 'h-40'}`}>
      <div className="absolute inset-0 bg-gradient-to-b from-black/95 via-transparent to-black/95 pointer-events-none"></div>
      <div className="absolute inset-0 opacity-10 pointer-events-none" 
           style={{ backgroundImage: 'linear-gradient(#666 1.5px, transparent 1.5px), linear-gradient(90deg, #666 1.5px, transparent 1.5px)', backgroundSize: '48px 48px' }} />
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
              <button onClick={() => handleDateClick(null)} 
                      className="text-[14px] text-red-500 hover:text-red-400 font-black uppercase border-b border-red-600/60 pb-1 transition-all animate-pulse">
                <i className="fa-solid fa-filter-circle-xmark mr-2.5"></i>RESET FILTER: {selectedDate}
              </button>
            )}
            <div className="flex flex-col items-end">
              <span className="text-[11px] text-gray-700 uppercase font-black tracking-widest">Log Count</span>
              <div className="flex items-center space-x-3">
                {uniqueStats && uniqueStats.enabled && (
                  <>
                    <span className="text-sm text-gray-500">Unique:</span>
                    <span className="text-2xl text-green-500 font-black tracking-tighter shadow-sm">{uniqueStats.unique}</span>
                    <span className="text-xs text-gray-700">/</span>
                  </>
                )}
                <span className="text-2xl text-red-600 font-black tracking-tighter shadow-sm">{detections.length}</span>
              </div>
            </div>
          </div>
        </div>
        
        {!isCollapsed && (
          <div className="flex-1 flex items-end space-x-2.5 mt-6 pb-2">
            {chartData.map((data, i) => (
              <div key={i} onClick={() => handleDateClick(selectedDate === data.date ? null : data.date)}
                   className={`flex-1 group relative transition-all cursor-pointer rounded-t border-x border-t ${selectedDate === data.date ? 'bg-red-600 border-red-400' : 'bg-red-900/30 border-red-900/40 hover:bg-red-600'}`}
                   style={{ height: `calc(10px + ${(data.count / maxCount) * 85}%)` }} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
});

// Detection Row
const DetectionRow = React.memo(({ det, columns, isExpanded, onToggle, onHover, onHoverEnd, idx }: any) => {
  const handleToggle = useCallback(() => onToggle(idx), [onToggle, idx]);
  const handleHover = useCallback((e: any) => onHover(idx, e), [onHover, idx]);
  
  return (
    <React.Fragment>
      <tr className={`hover:bg-red-600/10 transition-all cursor-pointer group ${isExpanded ? 'bg-red-600/15' : 'odd:bg-white/[0.01]'}`}
          onClick={handleToggle} onMouseEnter={handleHover} onMouseLeave={onHoverEnd}>
        <td className="p-3 text-center w-12 border-r titanium-border/50">
          <i className={`fa-solid fa-chevron-right transition-transform text-[9px] ${isExpanded ? 'rotate-90 text-red-500' : 'text-gray-700'}`}></i>
        </td>
        {columns.map((col: any) => <td key={col} className="p-3"><TelemetryCell det={det} field={col} /></td>)}
      </tr>
      {isExpanded && (
        <tr className="bg-black/95">
          <td colSpan={columns.length + 1} className="p-6 border-b border-red-900/40">
            <div className="text-[11px] font-black text-red-500 uppercase tracking-[0.2em] mb-4">JSON Log Packet: {det.uuid}</div>
            <pre className="mono text-[15px] text-gray-400 bg-[#080808] p-5 rounded border border-red-900/30 overflow-x-auto">{JSON.stringify(det, null, 2)}</pre>
          </td>
        </tr>
      )}
    </React.Fragment>
  );
}, (prev, next) => {
  return prev.det === next.det && 
         prev.columns === next.columns && 
         prev.isExpanded === next.isExpanded && 
         prev.idx === next.idx;
});

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
  const [isGraphCollapsed, setIsGraphCollapsed] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'chain' | 'network'>('grid');
  const [hoveredRowIdx, setHoveredRowIdx] = useState<number | null>(null);
  const [hudPosition, setHudPosition] = useState({ y: 0 });

  // UNIQUE FILTER STATES - OPTION 1
  const [uniqueFilterEnabled, setUniqueFilterEnabled] = useState(false);
  const [uniqueField, setUniqueField] = useState('processFilePath');

  const [tmv1Query, setTmv1Query] = useState('');
  const [selectFields, setSelectFields] = useState('');
  const [startDate, setStartDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().slice(0, 16);
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 16));
  
  const [config, setConfig] = useState<UserConfig>(() => {
    const saved = localStorage.getItem('tmv1_config');
    return saved ? JSON.parse(saved) : { apiKey: '', region: 'eu' };
  });

  // Memoize tab configurations
  const tabConfigs = useMemo(() => ({
    'search/networkActivities': {
      selectFields: 'principalName,endpointHostName,userAgent,osName,request,requestBase,dst,dstLocation,act,ruleName,urlCat,score,serverTls,eventTime',
      query: 'act:"*"',
      viewMode: 'network' as const
    },
    'search/detections': {
      selectFields: 'eventName,processFilePath,platformAssetTags,objectFilePath,endpointHostName,channel,tags',
      query: 'eventName:"*" AND NOT eventName:("APPLICATION_CONTROL_VIOLATION") AND endpointHostName:"*" AND objectFilePath:RunOnce',
      viewMode: 'grid' as const
    },
    'search/emailActivities': {
      selectFields: 'mailUrlsRealLink: ":" AND (attachmentSha256:"*")  OR mailSourceDomain:(gmail or outlook or sky)',
      query: 'mailToAddresses,mailFromAddresses,mailMsgSubject,mailSenderIp,mailWholeHeader,mailReturnPath,mailUrlsRealLink',
      viewMode: 'grid' as const
    },
    'default': {
      selectFields: 'endpointHostName,parentFilePath,parentProcessName,processFilePath,processName,objectUser,processCmd,severity',
      query: 'endpointHostName:"*"',
      viewMode: 'grid' as const
    }
  }), []);

  // Automatically update defaults via Effect
  useEffect(() => {
    const config = tabConfigs[activeTab as keyof typeof tabConfigs] || tabConfigs.default;
    setSelectFields(config.selectFields);
    setTmv1Query(config.query);
    setViewMode(config.viewMode);
  }, [activeTab, tabConfigs]);

  const toggleRow = useCallback((idx: number) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  }, []);

  const handleFetch = useCallback(async () => {
    setLoading(true); setError(null); setAnalysis(null);
    try {
      const service = new TrendMicroService(config);
      const data = await service.search(activeTab, tmv1Query, {
        startDateTime: new Date(startDate).toISOString(),
        endDateTime: new Date(endDate).toISOString(),
        top: 1000,
        mode: "default",
        select: selectFields
      });
      setDetections(data.items || []);
    } catch (err: any) { 
      setError(err.message); 
    } finally { 
      setLoading(false); 
    }
  }, [config, activeTab, tmv1Query, startDate, endDate, selectFields]);

  const handleAnalyze = useCallback(async () => {
    if (!detections.length) return;
    setAnalyzing(true);
    try { 
      setAnalysis(await analyzeDetections(detections)); 
    } catch (err: any) { 
      setError(err.message); 
    } finally { 
      setAnalyzing(false); 
    }
  }, [detections]);

  const handleHover = useCallback((idx: number, e: any) => {
    setHoveredRowIdx(idx);
    setHudPosition({ y: e.clientY });
  }, []);

  const handleHoverEnd = useCallback(() => {
    setHoveredRowIdx(null);
  }, []);

  const columns = useMemo(() => 
    selectFields.split(',').map(f => f.trim()).filter(f => f.length > 0), 
    [selectFields]
  );
  
  const filteredDetections = useMemo(() => 
    dateFilter 
      ? detections.filter(d => new Date(d.eventTime).toLocaleDateString() === dateFilter) 
      : detections, 
    [detections, dateFilter]
  );

  // UNIQUE FILTER MEMO - OPTION 1
  const uniqueDetections = useMemo(() => {
    if (!uniqueFilterEnabled || !uniqueField) return filteredDetections;
    
    const seen = new Set();
    const unique = [];
    
    for (const detection of filteredDetections) {
      // Get the value to dedupe by
      const value = detection[uniqueField as keyof Detection];
      if (!value) continue; // Skip if field doesn't exist
      
      // Create a unique key
      const key = String(value).toLowerCase().trim();
      
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(detection);
      }
    }
    
    console.log(`[Unique Filter] Reduced from ${filteredDetections.length} to ${unique.length} unique by ${uniqueField}`);
    return unique;
  }, [filteredDetections, uniqueFilterEnabled, uniqueField]);

  // Get display detections based on filter state
  const displayDetections = useMemo(() => {
    return uniqueFilterEnabled ? uniqueDetections : filteredDetections;
  }, [uniqueFilterEnabled, uniqueDetections, filteredDetections]);

  // Unique stats for display
  const uniqueStats = useMemo(() => {
    if (!uniqueFilterEnabled) return null;
    return {
      enabled: true,
      unique: uniqueDetections.length,
      total: filteredDetections.length,
      field: uniqueField,
      removed: filteredDetections.length - uniqueDetections.length
    };
  }, [uniqueFilterEnabled, uniqueDetections, filteredDetections, uniqueField]);

  const setConfigRegion = useCallback(() => {
    setConfig({ ...config, region: (prompt('Region (eu, us, sg, jp, au):') as any) || config.region });
  }, [config]);

  const toggleGraphCollapse = useCallback(() => {
    setIsGraphCollapsed(prev => !prev);
  }, []);

  const setViewModeGrid = useCallback(() => setViewMode('grid'), []);
  const setViewModeChain = useCallback(() => setViewMode('chain'), []);
  const setViewModeNetwork = useCallback(() => setViewMode('network'), []);

  const handleUniqueFieldChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setUniqueField(e.target.value);
  }, []);

  const handleUniqueFilterToggle = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setUniqueFilterEnabled(e.target.checked);
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-[#050505] text-gray-100 overflow-x-hidden">
      <header className="h-16 bg-black border-b border-red-900/50 flex items-center justify-between px-8 z-50">
        <div className="flex items-center space-x-5">
          <div className="w-10 h-10 bg-red-700 rounded-sm flex items-center justify-center rotate-45 border border-white/30 shadow-[0_0_20px_rgba(239,68,68,0.6)]">
            <i className="fa-solid fa-shield-virus text-white text-3xl -rotate-45"></i>
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tighter">VISION <span className="text-red-600">DONE</span></h1>
            <p className="text-[11px] font-black tracking-[0.5em] text-gray-500 uppercase mt-1.5">The Search you need when shit hits the fan</p>
          </div>
        </div>
        <button onClick={setConfigRegion} 
                className="text-[10px] font-black text-red-500 border border-red-900/60 bg-red-950/20 px-5 py-2 rounded">
          NODE: {config.region.toUpperCase()}
        </button>
      </header>

      <div className="bg-[#080808] border-b border-titanium-border px-8 py-1 flex space-x-2.5 overflow-x-auto scrollbar-none">
        {TABS.map((tab) => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`flex items-center space-x-3 px-6 py-4 text-[12px] font-black uppercase tracking-[0.15em] transition-all relative ${activeTab === tab.id ? 'text-red-500' : 'text-gray-500 hover:text-gray-300'}`}>
            <i className={tab.icon}></i><span>{tab.label}</span>
            {activeTab === tab.id && <div className="absolute bottom-0 left-0 w-full h-0.5 bg-red-600 shadow-[0_0_15px_#ef4444]"></div>}
          </button>
        ))}
      </div>

      <div className="bg-[#101010] border-b titanium-border flex flex-col lg:flex-row items-center px-8 py-5 space-y-4 lg:space-y-0 lg:space-x-8 shadow-2xl">
        <div className="flex space-x-4">
          <input type="datetime-local" value={startDate} onChange={(e) => setStartDate(e.target.value)} 
                 className="bg-black border border-red-900/50 rounded px-4 py-2 text-[16px] font-mono focus:border-red-600 outline-none" />
          <input type="datetime-local" value={endDate} onChange={(e) => setEndDate(e.target.value)} 
                 className="bg-black border border-red-900/50 rounded px-4 py-2 text-[16px] font-mono focus:border-red-600 outline-none" />
        </div>
        <div className="flex-1 relative w-full">
          <input type="text" placeholder="EXECUTE SCAN PROTOCOL..." value={tmv1Query} onChange={(e) => setTmv1Query(e.target.value)}
                 className="w-full bg-black border titanium-border rounded pl-5 pr-24 py-4 text-[15px] text-gray-400 font-mono focus:border-red-600 outline-none" />
          <button onClick={() => setShowAdvanced(!showAdvanced)} 
                  className="absolute right-5 top-1/2 -translate-y-1/2 text-[9px] font-black text-red-500 uppercase border border-red-900/60 px-3 py-1 bg-red-950/30 rounded">
            Advanced
          </button>
        </div>
        <button onClick={handleFetch} disabled={loading} 
                className="h-13 px-11 bg-red-800 hover:bg-red-600 disabled:bg-red-950/60 text-white font-black rounded-sm shadow-[0_0_25px_rgba(239,68,68,0.5)] transition-all active:scale-95 flex items-center space-x-4 uppercase text-[15px] tracking-[0.2em] border border-red-500/50">
          {loading ? <i className="fa-solid fa-sync fa-spin text-2xl"></i> : <span>SEARCH</span>}
        </button>
      </div>

      {showAdvanced && (
        <div className="bg-black border-b titanium-border px-8 py-10 animate-in slide-in-from-top-6 duration-400 shadow-2xl">
          <div className="grid grid-cols-2 gap-12">
            <div className="space-y-4">
              <label className="text-[17px] font-black text-red-500 uppercase tracking-widest flex items-center">
                <i className="fa-solid fa-terminal mr-3"></i>Search Logic
              </label>
              <textarea value={tmv1Query} onChange={(e) => setTmv1Query(e.target.value)} 
                        className="text-[16px] w-full h-32 bg-[#050505] border border-red-900/60 rounded p-5 font-mono text-red-100 outline-none focus:border-red-600" />
            </div>
            <div className="space-y-4">
              <label className="text-[17px] font-black text-gray-500 uppercase tracking-widest flex items-center">
                <i className="fa-solid fa-layer-group mr-3"></i>Field Selector - Leave it BLANK to capture ALL fields
              </label>
              <textarea value={selectFields} onChange={(e) => setSelectFields(e.target.value)} 
                        className="w-full h-32 bg-[#050505] border titanium-border rounded p-5 font-mono text-[16px] text-gray-400 outline-none focus:border-red-600" />
            </div>
          </div>
          
        {/* UNIQUE FILTER SECTION - OPTION 1 with Dynamic Fields */}
        <div className="mt-8 pt-8 border-t border-red-900/30">
          <h3 className="text-[17px] font-black text-red-500 uppercase tracking-widest flex items-center mb-4">
            <i className="fa-solid fa-filter-circle-xmark mr-3"></i>
            Result Deduplication
          </h3>
          
          <div className="grid grid-cols-3 gap-6">
            <div className="space-y-2">
              <label className="flex items-center space-x-2 cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={uniqueFilterEnabled}
                  onChange={handleUniqueFilterToggle}
                  className="form-checkbox h-5 w-5 text-red-600 bg-black border-red-900/50 rounded focus:ring-red-600"
                />
                <span className="text-[14px] font-black text-gray-300">Enable Unique Filter</span>
              </label>
              <p className="text-[10px] text-gray-600 font-mono">
                Remove duplicate results based on selected field
              </p>
            </div>
            
            {uniqueFilterEnabled && (
              <>
                <div className="space-y-2">
                  <label className="text-[12px] font-black text-gray-500 uppercase block">Deduplicate By</label>
                  <select 
                    value={uniqueField}
                    onChange={handleUniqueFieldChange}
                    className="w-full bg-black border border-red-900/50 rounded px-4 py-2 text-[14px] font-mono focus:border-red-600 outline-none"
                  >
                    {/* DYNAMIC OPTIONS from selectFields */}
                    {columns.map((field) => (
                      <option key={field} value={field}>
                        {field.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}
                      </option>
                    ))}
                  </select>
                  <p className="text-[9px] text-gray-700 font-mono">
                    Fields from your selector: {columns.join(', ')}
                  </p>
                </div>
                
                <div className="space-y-2">
                  <label className="text-[12px] font-black text-gray-500 uppercase block">Statistics</label>
                  <div className="bg-black/50 border border-red-900/30 rounded p-3">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-gray-500">Total Results:</span>
                      <span className="text-red-400 font-mono">{filteredDetections.length}</span>
                    </div>
                    <div className="flex justify-between text-[11px] mt-1">
                      <span className="text-gray-500">Unique Results:</span>
                      <span className="text-green-400 font-mono">{uniqueDetections.length}</span>
                    </div>
                    <div className="flex justify-between text-[11px] mt-1">
                      <span className="text-gray-500">Duplicates Removed:</span>
                      <span className="text-yellow-400 font-mono">{filteredDetections.length - uniqueDetections.length}</span>
                    </div>
                    <div className="flex justify-between text-[11px] mt-1 pt-1 border-t border-red-900/20">
                      <span className="text-gray-500">Reduction:</span>
                      <span className="text-blue-400 font-mono">
                        {filteredDetections.length ? 
                          `${Math.round((1 - uniqueDetections.length / filteredDetections.length) * 100)}%` : 
                          '0%'}
                      </span>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
        </div>
      )}

      <TelemetryGraph 
        detections={filteredDetections} 
        loading={loading} 
        onDateClick={setDateFilter} 
        selectedDate={dateFilter} 
        isCollapsed={isGraphCollapsed} 
        onToggleCollapse={toggleGraphCollapse}
        uniqueStats={uniqueStats}
      />

      <main className="flex-1 p-8 grid grid-cols-1 lg:grid-cols-4 gap-10 bg-[#050505]">
        <div className="lg:col-span-3 titanium-black rounded-sm border titanium-border overflow-hidden bg-[#0a0a0a] shadow-2xl">
          <div className="bg-[#0f0f0f] border-b titanium-border px-6 py-3.5 flex items-center space-x-3">
            <button onClick={setViewModeGrid} 
                    className={`px-6 py-2.5 text-[16px] font-black uppercase tracking-widest rounded ${viewMode === 'grid' ? 'bg-red-800 shadow-[0_0_15px_rgba(239,68,68,0.6)]' : 'bg-neutral-900'}`}>
              Telemetry Logs
            </button>
            <button onClick={setViewModeChain} 
                    className={`px-6 py-2.5 text-[16px] font-black uppercase tracking-widest rounded ${viewMode === 'chain' ? 'bg-red-800 shadow-[0_0_15px_rgba(239,68,68,0.6)]' : 'bg-neutral-900'}`}>
              Process Chain
            </button>
            <button onClick={setViewModeNetwork} 
                    className={`px-6 py-2.5 text-[16px] font-black uppercase tracking-widest rounded ${viewMode === 'network' ? 'bg-red-800 shadow-[0_0_15px_rgba(239,68,68,0.6)]' : 'bg-neutral-900'}`}>
              Network Chain
            </button>
            
            {/* UNIQUE FILTER INDICATOR - Now shows the actual field name */}
            {uniqueFilterEnabled && (
              <div className="ml-auto flex items-center space-x-2 text-[11px] bg-green-950/30 border border-green-900/50 px-3 py-1.5 rounded">
                <i className="fa-solid fa-filter-circle-check text-green-500"></i>
                <span className="text-green-400 font-mono">
                  Unique by {uniqueField.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}
                </span>
                <span className="text-gray-600">({uniqueDetections.length}/{filteredDetections.length})</span>
              </div>
            )}
          </div>
          <div className="overflow-x-auto max-h-[800px] scrollbar-thin">
            {viewMode === 'grid' ? (
              <table className="w-full text-left table-fixed">
                <thead className="sticky top-0 bg-[#0d0d0d] z-10 border-b titanium-border text-[16px]">
                  <tr>
                    <th className="p-5 w-3 text-center text-gray-500">
                      <span className="fa-solid fa-database text-base"></span>
                    </th>
                    {columns.map(col => <th key={col} className="p-5 text-[14px] font-black text-gray-400 uppercase tracking-widest">
                      {col.replace(/([A-Z])/g, ' $1')}
                    </th>)}
                  </tr>
                </thead>
                <tbody>
                  {displayDetections.length === 0 ? (
                    <tr><td colSpan={columns.length + 1} className="p-20 text-center text-gray-700 font-black uppercase tracking-[0.5em] opacity-30">No Telemetry Recorded</td></tr>
                  ) : (
                    displayDetections.map((det, idx) => (
                      <DetectionRow key={idx} det={det} columns={columns} 
                                    isExpanded={expandedRows.has(idx)} 
                                    onToggle={toggleRow} 
                                    onHover={handleHover} 
                                    onHoverEnd={handleHoverEnd} 
                                    idx={idx} />
                    ))
                  )}
                </tbody>
              </table>
            ) : viewMode === 'chain' ? (
              <ProcessChain detections={displayDetections} isActive={true} />
            ) : (
              <NetworkChain detections={displayDetections} isActive={true} />
            )}
          </div>
        </div>

        <div className="space-y-8">
          {displayDetections.length > 0 && (
            <div className="titanium-black border border-red-900/50 rounded p-8 space-y-5 shadow-2xl relative overflow-hidden bg-gradient-to-br from-[#141414] to-[#080808]">
              <div className="text-red-500 flex items-center space-x-3 mb-3">
                <i className="fa-solid fa-microchip text-xl"></i>
                <span className="text-[25px] font-black uppercase tracking-widest">Analyse with Local AI</span>
              </div>
              <div>
                <p className="text-[14px] text-gray-400 uppercase font-black leading-relaxed tracking-widest opacity-80">
                  Generate a comprehensive analysis of the <span className="text-red-500 text-xl">{displayDetections.length}</span> Telemetry clusters using Local LLM.
                  {uniqueFilterEnabled && (
                    <span className="block text-green-500 text-[10px] mt-1">
                      (Unique by {uniqueField.replace(/([A-Z])/g, ' $1').toLowerCase()} - {uniqueDetections.length} unique from {filteredDetections.length} total)
                    </span>
                  )}
                </p>
              </div>
              <button onClick={handleAnalyze} disabled={analyzing} 
                      className="w-full py-5 bg-red-700/10 border border-red-600/50 text-red-500 hover:bg-red-700 hover:text-white font-black uppercase rounded tracking-[0.3em] transition-all active:scale-95">
                {analyzing ? <><i className="fa-solid fa-sync fa-spin mr-3"></i>ANALYZING...</> : <><i className="fa-solid fa-sparkles mr-3"></i>ASK AI</>}
              </button>
            </div>
          )}
          {analysis && (
            <div className="titanium-black border border-red-900/60 rounded p-8 bg-[#060606] shadow-2xl animate-in fade-in duration-500">
              <h3 className="text-[14px] font-black text-red-500 uppercase tracking-[0.4em] mb-6 flex items-center">
                <span className="w-2 h-2 bg-red-600 rounded-full mr-3 animate-pulse"></span>TACTICAL INTEL REPORT
              </h3>
              <div className="prose prose-invert max-w-none text-[13px] leading-loose text-gray-300 font-medium">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{analysis}</ReactMarkdown>
              </div>
            </div>
          )}
          {error && <div className="bg-red-950/50 border-l-4 border-red-600 p-6 rounded shadow-2xl text-red-200 text-sm font-mono border border-red-900/30 animate-in slide-in-from-right duration-300">{error}</div>}
        </div>
      </main>

      {viewMode === 'grid' && hoveredRowIdx !== null && displayDetections[hoveredRowIdx] && (
        <TacticalHUD det={displayDetections[hoveredRowIdx]} columns={columns} position={hudPosition} />
      )}

      <footer className="h-10 border-t titanium-border bg-black flex justify-between items-center px-8 text-[9px] font-black text-gray-700 uppercase tracking-[0.5em]">
        <span>UPLINK_STABLE</span>
        <span>STRATEGIC COMMAND // VISION ONE // V1.4</span>
      </footer>
    </div>
  );
};

export default App;