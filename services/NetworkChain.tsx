
import React, { useState, useEffect, useMemo } from 'react';
import { Detection } from '../types';

interface NetworkChainProps {
  detections: Detection[];
  isActive: boolean;
}

export const NetworkChain: React.FC<NetworkChainProps> = ({ detections, isActive }) => {
  const [svgContent, setSvgContent] = useState<string>('');
  const [isRendering, setIsRendering] = useState(false);

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
    
    // Style Definitions
    def += "classDef userNode fill:#e1f5fe,stroke:#01579b,stroke-width:2px,color:#333\n";
    def += "classDef browserNode fill:#f3e5f5,stroke:#4a148c,stroke-width:2px,color:#333\n";
    def += "classDef requestNode fill:#e8f5e8,stroke:#1b5e20,stroke-width:2px,color:#333\n";
    def += "classDef destNode fill:#fff3e0,stroke:#e65100,stroke-width:2px,color:#333\n";
    def += "classDef policyNode fill:#eeeeee,stroke:#616161,stroke-width:2px,color:#333\n";
    def += "classDef allowNode fill:#c8e6c9,stroke:#2e7d32,stroke-width:3px,color:#333\n";
    def += "classDef blockNode fill:#ffcdd2,stroke:#c62828,stroke-width:3px,color:#333\n";
    def += "classDef alertNode fill:#fff9c4,stroke:#fbc02d,stroke-width:3px,color:#333\n";

    nodes.forEach((label, id) => {
      def += `${id}["${label}"]\n`;
      const cls = nodeClasses.get(id);
      if (cls) def += `class ${id} ${cls}\n`;
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
          const id = `network-mermaid-${Math.random().toString(36).substr(2, 9)}`;
          const { svg } = await (window as any).mermaid.render(id, mermaidDefinition);
          setSvgContent(svg);
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
    <div className="p-8 overflow-auto max-h-[800px] bg-black/70 scrollbar-thin flex flex-col items-center border-b titanium-border relative min-h-[480px]">
      <div className="absolute top-5 left-8 flex items-center space-x-5 z-10">
        <div className="flex items-center space-x-2.5 text-[9px] font-black text-red-600/70 uppercase tracking-[0.2em] bg-black/80 px-3 py-1.5 border border-red-900/30 rounded">
          <i className={`fa-solid fa-globe ${isRendering ? 'animate-spin' : 'animate-pulse'}`}></i>
          <span>{isRendering ? 'MAPPING NETWORK FLOW...' : 'TRAFFIC UPLINK ESTABLISHED'}</span>
        </div>
      </div>
      
      <div 
        className="w-full h-full flex justify-center py-16"
        dangerouslySetInnerHTML={{ __html: svgContent }} 
      />
    </div>
  );
};
