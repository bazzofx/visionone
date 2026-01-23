import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { TrendMicroService } from './services/trendService';
import { analyzeDetections } from './services/geminiService';
import { NetworkChain } from './services/NetworkChain';
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

// Memoized Severity Badge
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

// Telemetry Cell Renderer
const TelemetryCell = ({ det, field }: { det: Detection, field: string }) => {
  const val = det[field];
  if (field === 'severity') return <SeverityBadge severity={val} />;
  if (field === 'eventTime') return <span className="text-[12px] text-gray-400 font-mono tracking-tighter">{new Date(val).toLocaleString()}</span>;
  if (field === 'eventName') return <span className="text-[11px] font-black text-red-500 mono bg-red-950/20 px-1.5 py-0.5 rounded border border-red-900/30 uppercase">{val}</span>;
  if (typeof val === 'object') return <span className="text-[12px] text-gray-500 mono italic">{JSON.stringify(val).substring(0, 30)}...</span>;
  return <span className="text-[14px] text-gray-300 font-semibold tracking-tight whitespace-nowrap overflow-hidden text-ellipsis max-w-[200px] block">{val || '---'}</span>;
};

// Process Chain Component
const ProcessChain = React.memo(({ detections, isActive }: { detections: Detection[], isActive: boolean }) => {
  const [svgContent, setSvgContent] = useState<string>('');
  const [isRendering, setIsRendering] = useState(false);

  const mermaidDefinition = useMemo(() => {
    if (!isActive || detections.length === 0) return null;
    const edges = new Set<string>();
    const nodes = new Map<string, string>();
    const keyToId = new Map<string, string>();
    let idCounter = 0;
    const getSafeId = (key: string) => {
      if (!keyToId.has(key)) keyToId.set(key, `node_${idCounter++}`);
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
    nodes.forEach((l, i) => def += `${i}["${l}"]\n`);
    edges.forEach(e => def += `${e}\n`);
    return def;
  }, [detections, isActive]);

  useEffect(() => {
    const render = async () => {
      if (mermaidDefinition && (window as any).mermaid) {
        setIsRendering(true);
        try {
          const id = `mermaid-proc-${Math.random().toString(36).substr(2, 9)}`;
          const { svg } = await (window as any).mermaid.render(id, mermaidDefinition);
          setSvgContent(svg);
        } catch (e) {
          setSvgContent('<div class="text-red-500 font-black p-16">Render Faulted</div>');
        } finally {
          setIsRendering(false);
        }
      }
    };
    render();
  }, [mermaidDefinition]);

  if (!isActive) return null;
  return (
    <div className="p-8 overflow-auto max-h-[800px] bg-black/70 flex flex-col items-center border-b titanium-border min-h-[480px]">
      <div dangerouslySetInnerHTML={{ __html: svgContent }} />
    </div>
  );
});

// Tactical HUD Preview
const TacticalHUD = React.memo(({ det, columns, position }: { det: Detection, columns: string[], position: { y: number } }) => {
  if (!det) return null;
  return (
    <div 
      className="fixed z-[100] w-72 bg-black/95 border border-red-600/70 rounded shadow-[0_0_50px_rgba(239,68,68,0.4)] p-5 pointer-events-none animate-in fade-in zoom-in-95 duration-200 backdrop-blur-2xl"
      style={{ top: Math.min(position.y, window.innerHeight - 450), right: '25%' }}
    >
      <div className="text-[11px] font-black text-red-500 uppercase tracking-[0.4em] mb-4 border-b border-red-900/60 pb-1.5 flex items-center justify-between">
        <span>Tactical Intel</span>
        <i className="fa-solid fa-bullseye text-red-600 text-sm"></i>
      </div>
      <div className="space-y-4 max-h-[400px] overflow-y-auto scrollbar-none">
        {columns.map(col => (
          <div key={col} className="border-l border-gray-900 pl-3 hover:border-red-600 transition-colors">
            <span className="text-[9px] font-black text-gray-600 uppercase block mb-0.5 tracking-[0.15em]">{col.replace(/([A-Z])/g, ' $1')}</span>
            <span className="text-[12px] text-gray-100 font-mono break-all leading-tight block">
              {typeof det[col] === 'object' ? '[STRUCTURED_DATA]' : String(det[col] || 'NULL_VALUE')}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
});

// Telemetry Density Graph
const TelemetryGraph = React.memo(({ detections, loading, onDateClick, selectedDate, isCollapsed, onToggleCollapse }: any) => {
  const chartData = useMemo(() => {
    const groups: Record<string, number> = {};
    detections.forEach((d: any) => {
      const date = new Date(d.eventTime).toLocaleDateString();
      groups[date] = (groups[date] || 0) + 1;
    });
    return Object.entries(groups).map(([date, count]) => ({ date, count }))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()).slice(-30);
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
            <button onClick={() => onDateClick(null)} 
            className="text-[14px] text-red-500 hover:text-red-400 font-black uppercase border-b border-red-600/60 pb-1 transition-all animate-pulse"
            >
            <i className="fa-solid fa-filter-circle-xmark mr-2.5 "></i>
              RESET FILTER: {selectedDate}</button>
          )}
          <div className="flex flex-col items-end">
                <span className="text-[11px] text-gray-700 uppercase font-black tracking-widest">Log Count</span>
                <span className="text-2xl text-red-600 font-black tracking-tighter shadow-sm">{detections.length}</span>
             </div>
          </div>

        </div>
        {!isCollapsed && (
          <div className="flex-1 flex items-end space-x-2.5 mt-6 pb-2">
            {chartData.map((data, i) => (
              <div key={i} onClick={() => onDateClick(selectedDate === data.date ? null : data.date)}
                className={`flex-1 group relative transition-all cursor-pointer rounded-t border-x border-t ${selectedDate === data.date ? 'bg-red-600 border-red-400' : 'bg-red-900/30 border-red-900/40 hover:bg-red-600'}`}
                style={{ height: `calc(10px + ${(data.count / maxCount) * 85}%)` }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
});

// Detection Row
const DetectionRow = React.memo(({ det, columns, isExpanded, onToggle, onHover, onHoverEnd, idx }: any) => (
  <React.Fragment>
    <tr className={`hover:bg-red-600/10 transition-all cursor-pointer group ${isExpanded ? 'bg-red-600/15' : 'odd:bg-white/[0.01]'}`}
        onClick={() => onToggle(idx)} onMouseEnter={(e) => onHover(idx, e)} onMouseLeave={onHoverEnd}>
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
));

const TABS: { id: SearchEndpoint; label: string; icon: string }[] = [
  { id: 'search/endpointActivities', label: 'Endpoint', icon: 'fa-solid fa-laptop' },
  { id: 'search/networkActivities', label: 'Network', icon: 'fa-solid fa-network-wired' },
  { id: 'search/detections', label: 'Detections', icon: 'fa-solid fa-shield-halved' },
  { id: 'search/mobileActivities', label: 'Mobile', icon: 'fa-solid fa-mobile-screen-button' },
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
  const [isGraphCollapsed, setIsGraphCollapsed] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'chain' | 'network'>('grid');
  const [hoveredRowIdx, setHoveredRowIdx] = useState<number | null>(null);
  const [hudPosition, setHudPosition] = useState({ y: 0 });

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

  // Automatically update defaults via Effect
  useEffect(() => {
    if (activeTab === 'search/networkActivities') {
      setSelectFields('principalName,endpointHostName,userAgent,osName,request,requestBase,dst,dstLocation,act,ruleName,urlCat,score,serverTls,eventTime');
      setTmv1Query('act:"*"');
      setViewMode('network');
    }
     else if (activeTab === 'search/detections') {
    setSelectFields('eventName,processFilePath,platformAssetTags,objectFilePath,endpointHostName,channel,tags');
    setTmv1Query('eventName:"*" AND NOT eventName:("APPLICATION_CONTROL_VIOLATION") AND endpointHostName:"*" AND objectFilePath:RunOnce');
    setViewMode('grid');
  }
    else if (activeTab === 'search/emailActivities'){
      setSelectFields('mailUrlsRealLink: ":" AND (attachmentSha256:"*")  OR mailSourceDomain:(gmail or outlook or sky)')
      setTmv1Query('mailToAddresses,mailFromAddresses,mailMsgSubject,mailSenderIp,mailWholeHeader,mailReturnPath,mailUrlsRealLink')
      setViewMode('grid');
    }
    
    else {
      setSelectFields('endpointHostName,parentFilePath,parentProcessName,processFilePath,processName,objectUser,processCmd,severity');
      setTmv1Query('endpointHostName:"*"');
      setViewMode('grid');
    }
  }, [activeTab]);

  const toggleRow = useCallback((idx: number) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  }, []);

  const handleFetch = async () => {
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
    } catch (err: any) { setError(err.message); } finally { setLoading(false); }
  };

  const handleAnalyze = async () => {
    if (!detections.length) return;
    setAnalyzing(true);
    try { setAnalysis(await analyzeDetections(detections)); }
    catch (err: any) { setError(err.message); } finally { setAnalyzing(false); }
  };

  const columns = useMemo(() => selectFields.split(',').map(f => f.trim()).filter(f => f.length > 0), [selectFields]);
  const filteredDetections = useMemo(() => dateFilter ? detections.filter(d => new Date(d.eventTime).toLocaleDateString() === dateFilter) : detections, [detections, dateFilter]);

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
        <button onClick={() => setConfig({ ...config, region: (prompt('Region (eu, us, sg, jp, au):') as any) || config.region })} 
                className="text-[10px] font-black text-red-500 border border-red-900/60 bg-red-950/20 px-5 py-2 rounded">NODE: {config.region.toUpperCase()}</button>
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
          <input type="datetime-local" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="bg-black border border-red-900/50 rounded px-4 py-2 text-[16px] font-mono focus:border-red-600 outline-none" />
          <input type="datetime-local" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="bg-black border border-red-900/50 rounded px-4 py-2 text-[16px] font-mono focus:border-red-600 outline-none" />
        </div>
        <div className="flex-1 relative w-full">
           <input type="text" placeholder="EXECUTE SCAN PROTOCOL..." value={tmv1Query} onChange={(e) => setTmv1Query(e.target.value)}
                  className="w-full bg-black border titanium-border rounded pl-5 pr-24 py-4 text-[15px] text-gray-400 font-mono focus:border-red-600 outline-none" />
           <button onClick={() => setShowAdvanced(!showAdvanced)} className="absolute right-5 top-1/2 -translate-y-1/2 text-[9px] font-black text-red-500 uppercase border border-red-900/60 px-3 py-1 bg-red-950/30 rounded">Advanced</button>
        </div>
        <button onClick={handleFetch} disabled={loading} className="h-13 px-11 bg-red-800 hover:bg-red-600 disabled:bg-red-950/60 text-white font-black rounded-sm shadow-[0_0_25px_rgba(239,68,68,0.5)] transition-all active:scale-95 flex items-center space-x-4 uppercase text-[15px] tracking-[0.2em] border border-red-500/50">
          {loading ? <i className="fa-solid fa-sync fa-spin text-2xl "></i> : <span>SEARCH</span>}
        </button>
      </div>

      {showAdvanced && (
        <div className="bg-black border-b titanium-border px-8 py-10 grid grid-cols-2 gap-12 animate-in slide-in-from-top-6 duration-400 shadow-2xl">
          <div className="space-y-4">
            <label className="text-[17px] font-black text-red-500 uppercase tracking-widest flex items-center"><i className="fa-solid fa-terminal mr-3"></i>Search Logic</label>
            <textarea value={tmv1Query} onChange={(e) => setTmv1Query(e.target.value)} className="text-[16px] w-full h-32 bg-[#050505] border border-red-900/60 rounded p-5 font-mono  text-red-100 outline-none focus:border-red-600" />
          </div>
          <div className="space-y-4">
            <label className="text-[17px] font-black text-gray-500 uppercase tracking-widest flex items-center"><i className="fa-solid fa-layer-group mr-3"></i>Field Selector - Leave it BLANK to capture ALL fields</label>
            <textarea value={selectFields} onChange={(e) => setSelectFields(e.target.value)} className="w-full h-32 bg-[#050505] border titanium-border rounded p-5 font-mono text-[16px] text-gray-400 outline-none focus:border-red-600" />
          </div>
        </div>
      )}

      <TelemetryGraph detections={detections} loading={loading} onDateClick={setDateFilter} selectedDate={dateFilter} isCollapsed={isGraphCollapsed} onToggleCollapse={() => setIsGraphCollapsed(!isGraphCollapsed)} />

      <main className="flex-1 p-8 grid grid-cols-1 lg:grid-cols-4 gap-10 bg-[#050505]">
        <div className="lg:col-span-3 titanium-black rounded-sm border titanium-border overflow-hidden bg-[#0a0a0a] shadow-2xl ">
          <div className="bg-[#0f0f0f] border-b titanium-border px-6 py-3.5 flex items-center space-x-3">
            <button onClick={() => setViewMode('grid')} className={`px-6 py-2.5 text-[16px] font-black uppercase tracking-widest rounded ${viewMode === 'grid' ? 'bg-red-800 shadow-[0_0_15px_rgba(239,68,68,0.6)]' : 'bg-neutral-900'}`}>Telemetry Logs</button>
            <button onClick={() => setViewMode('chain')} className={`px-6 py-2.5 text-[16px] font-black uppercase tracking-widest rounded ${viewMode === 'chain' ? 'bg-red-800 shadow-[0_0_15px_rgba(239,68,68,0.6)]' : 'bg-neutral-900'}`}>Process Chain</button>
            <button onClick={() => setViewMode('network')} className={`px-6 py-2.5 text-[16px] font-black uppercase tracking-widest rounded ${viewMode === 'network' ? 'bg-red-800 shadow-[0_0_15px_rgba(239,68,68,0.6)]' : 'bg-neutral-900'}`}>Network Chain</button>
          </div>
          <div className="overflow-x-auto max-h-[800px] scrollbar-thin">
            {viewMode === 'grid' ? (
              <table className="w-full text-left table-fixed ">
                <thead className="sticky top-0 bg-[#0d0d0d] z-10 border-b titanium-border text-[16px] ">
                  <tr>
                    <th className="p-5 w-3 text-center text-gray-500 "><span className="fa-solid fa-database text-base text-gray-00"></span></th>
                    {columns.map(col => <th key={col} className="p-5 text-[14px] font-black text-gray-400 uppercase tracking-widest">{col.replace(/([A-Z])/g, ' $1')}</th>)}
                  </tr>
                </thead>
                <tbody className="">
                  {filteredDetections.length === 0 ? (
                    <tr><td colSpan={columns.length + 1} className=" p-20 text-center text-gray-700 font-black uppercase tracking-[0.5em] opacity-30">No Telemetry Recorded</td></tr>
                  ) : (
                    filteredDetections.map((det, idx) => (
                      <DetectionRow key={idx} det={det} columns={columns} isExpanded={expandedRows.has(idx)} onToggle={toggleRow} onHover={(i: any, e: any) => {setHoveredRowIdx(i); setHudPosition({y: e.clientY});}} onHoverEnd={() => setHoveredRowIdx(null)} idx={idx} />
                    ))
                  )}
                </tbody>
              </table>
            ) : viewMode === 'chain' ? (
              <ProcessChain detections={filteredDetections} isActive={true} />
            ) : (
              <NetworkChain detections={filteredDetections} isActive={true} />
            )}
          </div>
        </div>

        <div className="space-y-8">
          {filteredDetections.length > 0 && (
            <div className="titanium-black border border-red-900/50 rounded p-8 space-y-5 shadow-2xl relative overflow-hidden bg-gradient-to-br from-[#141414] to-[#080808]">
              <div className="text-red-500 flex items-center space-x-3 mb-3">
                <i className="fa-solid fa-microchip text-xl"></i>
                <span className="text-[25px] font-black uppercase tracking-widest">Analyse with Gemini</span>
              </div>
              <div>
                <p className="text-[14px] text-gray-400 uppercase font-black leading-relaxed tracking-widest opacity-80">
                  Generate a comprehensive analysis of the <span className="text-red-500 text-xl">{filteredDetections.length}</span> Telemetry clusters using Gemini 3.
                </p>
              </div>
              <button onClick={handleAnalyze} disabled={analyzing} className="w-full py-5 bg-red-700/10 border border-red-600/50 text-red-500 hover:bg-red-700 hover:text-white font-black uppercase rounded tracking-[0.3em] transition-all active:scale-95">
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

      {viewMode === 'grid' && hoveredRowIdx !== null && filteredDetections[hoveredRowIdx] && (
        <TacticalHUD det={filteredDetections[hoveredRowIdx]} columns={columns} position={hudPosition} />
      )}

      <footer className="h-10 border-t titanium-border bg-black flex justify-between items-center px-8 text-[9px] font-black text-gray-700 uppercase tracking-[0.5em]">
        <span>UPLINK_STABLE</span>
        <span>STRATEGIC COMMAND // VISION ONE // V1.4</span>
      </footer>
    </div>
  );
};

export default App;
