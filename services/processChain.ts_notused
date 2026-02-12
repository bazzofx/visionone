
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Detection } from '../types';

interface ProcessChainProps {
  detections: Detection[];
  isActive: boolean;
}

/**
 * ProcessChain Component v1.4
 * Visualizes the execution flow using Mermaid.js with high-performance rendering.
 * Follows strict syntax: Node definitions first, then edges, all line-by-line.
 */
export const ProcessChain = React.memo(({ detections, isActive }: ProcessChainProps) => {
  const [svgContent, setSvgContent] = useState<string>('');
  const [isRendering, setIsRendering] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const mermaidDefinition = useMemo(() => {
    if (!isActive || detections.length === 0) return null;

    const edges = new Set<string>();
    const nodeDefinitions = new Map<string, string>(); // ShortID -> Definition Line
    const keyToId = new Map<string, string>();
    let idCounter = 0;

    const getSafeId = (key: string) => {
      if (!keyToId.has(key)) {
        keyToId.set(key, `n${idCounter++}`);
      }
      return keyToId.get(key)!;
    };

    const sanitizeLabel = (text: string) => {
      return text.replace(/"/g, "'").replace(/\n/g, " ").trim();
    };

    const carveString = (path: string) => sanitizeLabel(path.split(/[\\/]/).pop() || path);

    const getIcon = (path: string) => {
      const lower = path.toLowerCase();
      if (lower.endsWith('.exe')) return '⚙️ ';
      if (lower.endsWith('.dll')) return '📦 ';
      if (lower.endsWith('.ps1') || lower.endsWith('.psm1')) return '🐚 ';
      if (lower.endsWith('.js')) return '📜 ';
      return '📄 ';
    };

    // Performance Sampling: Process up to 150 events to maintain UI responsiveness
    const telemetryBatch = detections.slice(0, 150);

    telemetryBatch.forEach(d => {
      if (edges.size > 120) return; // Hard limit for visual clarity

      const user = d.objectUser || d.suser || "System";
      const parent = d.parentFilePath || d.parentProcessName || d.parentName;
      const process = d.processFilePath || d.processName;
      const object = d.objectFilePath || d.objectName;

      // 1. Identity Node
      const userId = getSafeId(`u_${user}`);
      nodeDefinitions.set(userId, `${userId}["👤 ${sanitizeLabel(user)}"]`);

      if (parent) {
        // 2. Parent Process Node
        const parentId = getSafeId(`p_${parent}`);
        nodeDefinitions.set(parentId, `${parentId}["⚙️ ${carveString(parent)}"]`);
        edges.add(`${userId} --> ${parentId}`);

        if (process) {
          // 3. Active Process Node
          const processId = getSafeId(`pr_${process}`);
          nodeDefinitions.set(processId, `${processId}["${getIcon(process)}${carveString(process)}"]`);
          edges.add(`${parentId} --> ${processId}`);

          if (object) {
            // 4. Target Object Node
            const objectId = getSafeId(`obj_${object}`);
            nodeDefinitions.set(objectId, `${objectId}["📄 ${carveString(object)}"]`);
            edges.add(`${processId} --> ${objectId}`);
          }
        }
      } else if (process) {
        const processId = getSafeId(`pr_${process}`);
        nodeDefinitions.set(processId, `${processId}["${getIcon(process)}${carveString(process)}"]`);
        edges.add(`${userId} --> ${processId}`);
      }
    });

    if (nodeDefinitions.size === 0) return null;

    // Construct final definition following Mermaid Guidelines
    let def = "graph LR\n";
    
    // Nodes first
    nodeDefinitions.forEach((line) => {
      def += `${line}\n`;
    });
    
    // Edges second
    edges.forEach(edge => {
      def += `${edge}\n`;
    });
    
    return def;
  }, [detections, isActive]);

  useEffect(() => {
    const renderDiagram = async () => {
      if (mermaidDefinition && (window as any).mermaid) {
        setIsRendering(true);
        try {
          const uniqueId = `mermaid-canvas-${Math.random().toString(36).substr(2, 9)}`;
          const { svg } = await (window as any).mermaid.render(uniqueId, mermaidDefinition);
          setSvgContent(svg);
        } catch (error) {
          console.error("Mermaid Render Critical Fault:", error);
          setSvgContent('<div class="text-red-500 font-black p-20 uppercase tracking-widest text-center">Tactical Rendering Pipeline Error</div>');
        } finally {
          setIsRendering(false);
        }
      } else {
        setSvgContent('');
      }
    };
    renderDiagram();
  }, [mermaidDefinition]);

  const copyDefinition = () => {
    if (mermaidDefinition) {
      navigator.clipboard.writeText(mermaidDefinition);
    }
  };

  if (!isActive) {
    return (
      <div className="flex flex-col items-center justify-center p-40 bg-black/40 border-b titanium-border">
        <div className="w-16 h-16 border-4 border-red-900/20 border-t-red-600 rounded-full animate-spin mb-8 opacity-30"></div>
        <p className="text-[14px] font-black uppercase tracking-[0.8em] text-gray-700">Linkage Engine Offline</p>
        <p className="text-[10px] mt-4 font-mono text-gray-800 uppercase tracking-widest">Toggle "ACTIVATE ENGINE" to render telemetry canvas</p>
      </div>
    );
  }

  if (!mermaidDefinition) {
    return (
      <div className="flex flex-col items-center justify-center p-40 opacity-20 grayscale">
        <i className="fa-solid fa-diagram-project text-7xl mb-8 text-red-900"></i>
        <p className="text-[14px] font-black uppercase tracking-[0.8em]">Linkage Logic Idle</p>
        <p className="text-[11px] mt-4 font-mono text-gray-600 italic">No valid process flow patterns detected in current buffer</p>
      </div>
    );
  }

  return (
    <div className="p-10 overflow-auto max-h-[1000px] bg-black/70 scrollbar-thin flex flex-col items-center border-b titanium-border relative min-h-[600px]">
      <div className="absolute top-6 left-10 flex items-center space-x-6 z-10">
        <div className="flex items-center space-x-3 text-[11px] font-black text-red-600/70 uppercase tracking-[0.3em] bg-black/80 px-4 py-2 border border-red-900/30 rounded">
          <i className={`fa-solid fa-network-wired ${isRendering ? 'animate-spin' : 'animate-pulse'}`}></i>
          <span>{isRendering ? 'SYNCHRONIZING CANVAS...' : 'COMMAND LINK ESTABLISHED'}</span>
        </div>
        <button 
          onClick={copyDefinition}
          className="text-[10px] font-black text-gray-500 hover:text-red-500 uppercase tracking-widest bg-black/40 px-4 py-2 border titanium-border rounded hover:border-red-600/50 transition-all"
        >
          <i className="fa-solid fa-code mr-2"></i>Export Mermaid
        </button>
      </div>
      
      <div 
        className="w-full h-full flex justify-center py-20 animate-in fade-in duration-700"
        dangerouslySetInnerHTML={{ __html: svgContent }} 
      />
    </div>
  );
});
