import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Detection } from '../types';

interface NetworkChainProps {
  detections: Detection[];
  isActive: boolean;
}

export const NetworkChain: React.FC<NetworkChainProps> = ({ detections, isActive }) => {
  const [svgContent, setSvgContent] = useState<string>('');
  const [isRendering, setIsRendering] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [panPosition, setPanPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const svgContainerRef = useRef<HTMLDivElement>(null);

  const mermaidDefinition = useMemo(() => {
    if (!isActive || detections.length === 0) return null;

    const edges = new Set<string>();
    const nodes = new Map<string, string>(); // NodeID -> Label
    const nodeClasses = new Map<string, string>(); // NodeID -> Class
    const keyToId = new Map<string, string>();
    let idCounter = 0;

    const getSafeId = (key: string) => {
      if (!keyToId.has(key)) {
        keyToId.set(key, `n${idCounter++}`);
      }
      return keyToId.get(key)!;
    };

    const getBrowser = (ua: string) => {
      if (ua.includes("Edg")) return "Edge Browser";
      if (ua.includes("Chrome")) return "Chrome Browser";
      if (ua.includes("Firefox")) return "Firefox";
      if (ua.includes("Safari")) return "Safari";
      return "Generic Browser";
    };

    const getRisk = (score: number) => {
      if (score >= 90) return "🔴 High Risk";
      if (score >= 70) return "🟡 Medium Risk";
      return "🟢 Low Risk";
    };

    const getActLabel = (act: string) => {
      const a = act?.toLowerCase() || "";
      if (a === "allow") return "✅ ALLOWED";
      if (a === "block") return "❌ BLOCKED";
      if (a === "alert") return "⚠️ ALERTED";
      return act?.toUpperCase() || "UNKNOWN";
    };

    const getPolicyClass = (act: string) => {
      const a = act?.toLowerCase() || "";
      if (a === "allow") return "allowNode";
      if (a === "block") return "blockNode";
      if (a === "alert") return "alertNode";
      return "policyNode";
    };

    // Filter and process only network/SWG logs (up to 50 for clarity)
    const networkBatch = detections
      .filter(d => d.request || d.dst || d.principalName)
      .slice(0, 50);

    if (networkBatch.length === 0) return null;

    networkBatch.forEach(d => {
      const userStr = d.principalName || d.suid || "Anonymous";
      const hostStr = d.endpointHostName || "Unknown Host";
      const uaStr = d.userAgent || "";
      const osStr = d.osName || "Unknown OS";
      const reqBase = d.requestBase || "unknown.domain";
      const reqMethod = d.requestMethod || "GET";
      const dstIp = d.dst || "0.0.0.0";
      const dstLoc = d.dstLocation || "INT";
      const tls = d.serverTls || "No TLS";
      const action = d.act || "Allow";
      const rule = d.ruleName || "Default Rule";
      const cat = d.urlCat || "Miscellaneous";
      const score = d.score || 0;

      // Identity Node
      const userId = getSafeId(`u_${userStr}_${hostStr}`);
      nodes.set(userId, `👤 ${userStr}<br/>${hostStr}`);
      nodeClasses.set(userId, "userNode");

      // Browser Node
      const browserId = getSafeId(`b_${uaStr}_${osStr}`);
      nodes.set(browserId, `🌐 ${getBrowser(uaStr)}<br/>${osStr}`);
      nodeClasses.set(browserId, "browserNode");

      // Request Node
      const reqId = getSafeId(`r_${reqMethod}_${reqBase}`);
      nodes.set(reqId, `📨 ${reqMethod} ${reqBase}`);
      nodeClasses.set(reqId, "requestNode");

      // Destination Node
      const destId = getSafeId(`d_${dstIp}`);
      nodes.set(destId, `📍 ${dstIp}<br/>${dstLoc} · ${tls}`);
      nodeClasses.set(destId, "destNode");

      // Policy Node (Specific per event if rule/score differs)
      const policyId = getSafeId(`p_${action}_${rule}_${score}_${cat}`);
      nodes.set(policyId, `🛡️ ${getActLabel(action)}<br/>${rule}<br/>${cat} · Score: ${score} (${getRisk(score)})`);
      nodeClasses.set(policyId, getPolicyClass(action));

      // Edges
      edges.add(`${userId} -->|User Activity| ${browserId}`);
      edges.add(`${browserId} -->|Browser Request| ${reqId}`);
      edges.add(`${reqId} -->|Network Traffic| ${destId}`);
      edges.add(`${destId} -->|Policy Evaluation| ${policyId}`);
    });

    let def = "graph TD\n";
    
    // Style Definitions - KEEPING ORIGINAL COLORS
    def += "    classDef userNode fill:#e1f5fe,stroke:#01579b,stroke-width:2px,color:#333\n";
    def += "    classDef browserNode fill:#f3e5f5,stroke:#4a148c,stroke-width:2px,color:#333\n";
    def += "    classDef requestNode fill:#e8f5e8,stroke:#1b5e20,stroke-width:2px,color:#333\n";
    def += "    classDef destNode fill:#fff3e0,stroke:#e65100,stroke-width:2px,color:#333\n";
    def += "    classDef policyNode fill:#eeeeee,stroke:#616161,stroke-width:2px,color:#333\n";
    def += "    classDef allowNode fill:#c8e6c9,stroke:#2e7d32,stroke-width:3px,color:#333\n";
    def += "    classDef blockNode fill:#ffcdd2,stroke:#c62828,stroke-width:3px,color:#333\n";
    def += "    classDef alertNode fill:#fff9c4,stroke:#fbc02d,stroke-width:3px,color:#333\n";

    // Add nodes with proper syntax
    nodes.forEach((label, id) => {
      def += `    ${id}["${label}"]\n`;
    });

    // Add node classes
    nodes.forEach((_, id) => {
      const cls = nodeClasses.get(id);
      if (cls) def += `    class ${id} ${cls};\n`;
    });
    
    // Add edges
    edges.forEach(edge => {
      def += `    ${edge}\n`;
    });
    
    return def;
  }, [detections, isActive]);

  useEffect(() => {
    const render = async () => {
      if (mermaidDefinition && (window as any).mermaid) {
        setIsRendering(true);
        try {
          const id = `network-mermaid-${Math.random().toString(36).substr(2, 9)}`;
          const { svg } = await (window as any).mermaid.render(id, mermaidDefinition);
          setSvgContent(svg);
          // Reset zoom and pan on new render
          setZoomLevel(1);
          setPanPosition({ x: 0, y: 0 });
        } catch (e) {
          console.error("Network Mermaid Render Error:", e);
          setSvgContent('<div class="text-red-500 font-black p-16 uppercase text-sm">Network Canvas Rendering Pipeline Faulted</div>');
        } finally {
          setIsRendering(false);
        }
      } else {
        setSvgContent('');
      }
    };
    render();
  }, [mermaidDefinition]);

  // Zoom controls
  const handleZoomIn = () => {
    setZoomLevel(prev => Math.min(prev + 0.25, 20));
  };

  const handleZoomOut = () => {
    setZoomLevel(prev => Math.max(prev - 0.25, 0.5));
  };

  const handleReset = () => {
    setZoomLevel(1);
    setPanPosition({ x: 0, y: 0 });
  };

  // Pan handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 0) {
      setIsDragging(true);
      setDragStart({ 
        x: e.clientX - panPosition.x, 
        y: e.clientY - panPosition.y 
      });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging) {
      setPanPosition({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Export functions
  const exportAsPNG = () => {
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
      link.download = `network-chain-${new Date().toISOString().slice(0, 10)}.png`;
      link.href = pngData;
      link.click();
    };

    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
  };

  const exportAsSVG = () => {
    const svgElement = svgContainerRef.current?.querySelector('svg');
    if (!svgElement) return;

    const svgData = new XMLSerializer().serializeToString(svgElement);
    const blob = new Blob([svgData], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.download = `network-chain-${new Date().toISOString().slice(0, 10)}.svg`;
    link.href = url;
    link.click();
    
    URL.revokeObjectURL(url);
  };

  const exportAsMermaid = () => {
    if (mermaidDefinition) {
      const blob = new Blob([mermaidDefinition], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      
      const link = document.createElement('a');
      link.download = `network-chain-${new Date().toISOString().slice(0, 10)}.mmd`;
      link.href = url;
      link.click();
      
      URL.revokeObjectURL(url);
    }
  };

  if (!isActive) return null;

  if (!mermaidDefinition) {
    return (
      <div className="flex flex-col items-center justify-center p-32 opacity-20 grayscale text-center">
        <i className="fa-solid fa-network-wired text-5xl mb-6 text-red-900"></i>
        <p className="text-[11px] font-black uppercase tracking-[0.6em]">Network Pattern Engine Idle</p>
        <p className="text-[9px] mt-3 font-mono text-gray-600 italic">No SWG or Network Activities detected in current buffer</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full h-full bg-black/70 relative min-h-[600px]">
      {/* Zoom and Export Controls */}
      <div className="flex items-center justify-between p-4 border-b border-red-900/30 bg-black/90 sticky top-0 z-20">
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2 bg-black/50 rounded-lg border border-red-900/30 p-1">
            <button 
              onClick={handleZoomOut}
              className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-950/30 rounded transition-all"
              title="Zoom Out"
            >
              <i className="fa-solid fa-minus"></i>
            </button>
            <span className="text-[12px] font-mono text-gray-400 w-16 text-center">
              {Math.round(zoomLevel * 100)}%
            </span>
            <button 
              onClick={handleZoomIn}
              className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-950/30 rounded transition-all"
              title="Zoom In"
            >
              <i className="fa-solid fa-plus"></i>
            </button>
            <button 
              onClick={handleReset}
              className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-950/30 rounded transition-all ml-2"
              title="Reset View"
            >
              <i className="fa-solid fa-arrows-to-circle"></i>
            </button>
          </div>
          
          <div className="flex items-center space-x-2 border-l border-red-900/30 pl-4">
            <button 
              onClick={exportAsPNG}
              className="px-3 py-1.5 text-[11px] font-black text-gray-400 hover:text-red-500 border border-red-900/30 hover:border-red-600/50 rounded flex items-center space-x-2 transition-all"
              title="Export as PNG"
            >
              <i className="fa-solid fa-camera"></i>
              <span>PNG</span>
            </button>
            <button 
              onClick={exportAsSVG}
              className="px-3 py-1.5 text-[11px] font-black text-gray-400 hover:text-red-500 border border-red-900/30 hover:border-red-600/50 rounded flex items-center space-x-2 transition-all"
              title="Export as SVG"
            >
              <i className="fa-solid fa-code"></i>
              <span>SVG</span>
            </button>
            <button 
              onClick={exportAsMermaid}
              className="px-3 py-1.5 text-[11px] font-black text-gray-400 hover:text-red-500 border border-red-900/30 hover:border-red-600/50 rounded flex items-center space-x-2 transition-all"
              title="Export as Mermaid"
            >
              <i className="fa-solid fa-diagram-project"></i>
              <span>MMD</span>
            </button>
          </div>
        </div>
        
        <div className="flex items-center space-x-3 text-[10px] text-gray-600">
          <i className="fa-solid fa-arrows-up-down-left-right"></i>
          <span>Drag to pan</span>
          <span className="mx-2">|</span>
          <i className="fa-solid fa-mouse-pointer"></i>
          <span>Scroll to zoom</span>
        </div>
      </div>

      {/* SVG Container with Zoom and Pan */}
      <div 
        ref={containerRef}
        className="flex-1 overflow-hidden relative cursor-grab active:cursor-grabbing min-h-[500px]"
        style={{ overscrollBehavior: 'none' }} // 👈 ADD THIS prevent scrolling up and down the page
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={(e) => {
          e.preventDefault();
           e.stopPropagation(); // 👈  ADD THIS prevent scrolling up and down the page
          const delta = e.deltaY > 0 ? -0.1 : 0.1;
          setZoomLevel(prev => Math.max(0.5, Math.min(20, prev + delta)));
        }}
      >
        <div 
          ref={svgContainerRef}
          className="absolute inset-0 flex items-center justify-center"
          style={{
            transform: `scale(${zoomLevel}) translate(${panPosition.x}px, ${panPosition.y}px)`,
            transformOrigin: 'center center',
            transition: isDragging ? 'none' : 'transform 0.1s ease'
          }}
          dangerouslySetInnerHTML={{ __html: svgContent }} 
        />
      </div>

      {/* Loading Overlay */}
      {isRendering && (
        <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-30">
          <div className="text-center">
            <i className="fa-solid fa-spinner fa-spin text-4xl text-red-600 mb-4"></i>
            <p className="text-[12px] font-black text-red-500 uppercase tracking-[0.3em]">Mapping Network Flow...</p>
          </div>
        </div>
      )}
    </div>
  );
};