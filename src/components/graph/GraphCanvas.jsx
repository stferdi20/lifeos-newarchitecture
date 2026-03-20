import React, { useRef, useEffect, useCallback, useState } from 'react';

const NODE_RADIUS = 28;
const REPULSION = 6000;
const ATTRACTION = 0.03;
const DAMPING = 0.85;
const LINK_DISTANCE = 180;

function initLayout(nodes) {
  const placed = {};
  const cx = 600, cy = 400;
  nodes.forEach((n, i) => {
    const angle = (i / nodes.length) * 2 * Math.PI;
    const r = 150 + Math.random() * 200;
    placed[n.id] = {
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
      vx: 0, vy: 0,
    };
  });
  return placed;
}

export default function GraphCanvas({ nodes, edges, typeConfig, zoom, onZoomChange, onSelectNode, selectedNodeId, clusterTargets }) {
  const canvasRef = useRef(null);
  const posRef = useRef({});
  const rafRef = useRef(null);
  const panRef = useRef({ x: 0, y: 0 });
  const isDraggingNode = useRef(null);
  const isPanning = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });
  const [hoveredId, setHoveredId] = useState(null);
  const zoomRef = useRef(zoom);
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  const clusterTargetsRef = useRef(clusterTargets);

  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { nodesRef.current = nodes; }, [nodes]);
  useEffect(() => { edgesRef.current = edges; }, [edges]);
  useEffect(() => { clusterTargetsRef.current = clusterTargets; }, [clusterTargets]);

  // Init positions for new nodes
  useEffect(() => {
    const pos = posRef.current;
    const cx = 600, cy = 400;
    nodes.forEach((n, i) => {
      if (!pos[n.id]) {
        const angle = (i / Math.max(nodes.length, 1)) * 2 * Math.PI;
        const r = 150 + Math.random() * 200;
        pos[n.id] = { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle), vx: 0, vy: 0 };
      }
    });
    // Remove stale
    Object.keys(pos).forEach(id => {
      if (!nodes.find(n => n.id === id)) delete pos[id];
    });
  }, [nodes]);

  // Force simulation tick
  const tick = useCallback(() => {
    const pos = posRef.current;
    const ns = nodesRef.current;
    const es = edgesRef.current;
    if (!ns.length) return;

    // Repulsion
    for (let i = 0; i < ns.length; i++) {
      for (let j = i + 1; j < ns.length; j++) {
        const a = pos[ns[i].id], b = pos[ns[j].id];
        if (!a || !b) continue;
        let dx = a.x - b.x, dy = a.y - b.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = REPULSION / (dist * dist);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.vx += fx; a.vy += fy;
        b.vx -= fx; b.vy -= fy;
      }
    }

    // Attraction along edges
    es.forEach(e => {
      const a = pos[e.source], b = pos[e.target];
      if (!a || !b) return;
      const dx = b.x - a.x, dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const force = (dist - LINK_DISTANCE) * ATTRACTION;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      a.vx += fx; a.vy += fy;
      b.vx -= fx; b.vy -= fy;
    });

    // Cluster force or center gravity
    const ct = clusterTargetsRef.current;
    ns.forEach(n => {
      const p = pos[n.id];
      if (!p) return;
      if (ct && ct[n.id]) {
        p.vx += (ct[n.id].x - p.x) * 0.015;
        p.vy += (ct[n.id].y - p.y) * 0.015;
      } else {
        p.vx += (600 - p.x) * 0.002;
        p.vy += (400 - p.y) * 0.002;
      }
    });

    // Integrate + dampen (skip dragged node)
    ns.forEach(n => {
      const p = pos[n.id];
      if (!p || isDraggingNode.current === n.id) return;
      p.vx *= DAMPING; p.vy *= DAMPING;
      p.x += p.vx; p.y += p.vy;
    });
  }, []);

  // Draw
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const pos = posRef.current;
    const ns = nodesRef.current;
    const es = edgesRef.current;
    const z = zoomRef.current;
    const pan = panRef.current;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(pan.x, pan.y);
    ctx.scale(z, z);

    // Draw edges
    es.forEach(e => {
      const a = pos[e.source], b = pos[e.target];
      if (!a || !b) return;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = 'rgba(148,163,184,0.25)';
      ctx.lineWidth = 1;
      ctx.stroke();
    });

    // Draw nodes
    ns.forEach(n => {
      const p = pos[n.id];
      if (!p) return;
      const cfg = typeConfig[n.type] || typeConfig.note;
      const isSelected = n.id === selectedNodeId;
      const isHovered = n.id === hoveredId;
      const r = isSelected ? NODE_RADIUS + 5 : NODE_RADIUS;

      // Glow for selected
      if (isSelected) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 8, 0, Math.PI * 2);
        ctx.fillStyle = cfg.color + '30';
        ctx.fill();
      }

      // Node circle
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = cfg.bg;
      ctx.fill();
      ctx.strokeStyle = isSelected || isHovered ? cfg.color : cfg.color + '60';
      ctx.lineWidth = isSelected ? 2.5 : 1.5;
      ctx.stroke();

      // Label
      ctx.font = `${isSelected ? 600 : 500} 11px Inter, sans-serif`;
      ctx.fillStyle = 'rgba(248,250,252,0.9)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const maxW = r * 2 - 8;
      let label = n.label || '';
      while (ctx.measureText(label).width > maxW && label.length > 3) {
        label = label.slice(0, -1);
      }
      if (label !== n.label) label += '…';
      ctx.fillText(label, p.x, p.y);
    });

    ctx.restore();
  }, [typeConfig, selectedNodeId, hoveredId]);

  // Animation loop
  useEffect(() => {
    let running = true;
    const loop = () => {
      if (!running) return;
      tick();
      draw();
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => { running = false; cancelAnimationFrame(rafRef.current); };
  }, [tick, draw]);

  // Resize
  useEffect(() => {
    const resize = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  const getNodeAtPoint = useCallback((clientX, clientY) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const pan = panRef.current;
    const z = zoomRef.current;
    const mx = (clientX - rect.left - pan.x) / z;
    const my = (clientY - rect.top - pan.y) / z;
    const pos = posRef.current;
    return nodesRef.current.find(n => {
      const p = pos[n.id];
      if (!p) return false;
      const dx = p.x - mx, dy = p.y - my;
      return Math.sqrt(dx * dx + dy * dy) <= NODE_RADIUS + 5;
    }) || null;
  }, []);

  const onMouseDown = useCallback((e) => {
    const node = getNodeAtPoint(e.clientX, e.clientY);
    if (node) {
      isDraggingNode.current = node.id;
    } else {
      isPanning.current = true;
    }
    lastMouse.current = { x: e.clientX, y: e.clientY };
  }, [getNodeAtPoint]);

  const onMouseMove = useCallback((e) => {
    const hovNode = getNodeAtPoint(e.clientX, e.clientY);
    setHoveredId(hovNode?.id || null);

    if (isDraggingNode.current) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const z = zoomRef.current;
      const dx = (e.clientX - lastMouse.current.x) / z;
      const dy = (e.clientY - lastMouse.current.y) / z;
      const p = posRef.current[isDraggingNode.current];
      if (p) { p.x += dx; p.y += dy; p.vx = 0; p.vy = 0; }
    } else if (isPanning.current) {
      panRef.current.x += e.clientX - lastMouse.current.x;
      panRef.current.y += e.clientY - lastMouse.current.y;
    }
    lastMouse.current = { x: e.clientX, y: e.clientY };
  }, [getNodeAtPoint]);

  const onMouseUp = useCallback((e) => {
    const wasDragging = isDraggingNode.current;
    isDraggingNode.current = null;
    isPanning.current = false;
    if (!wasDragging) return;
    // If barely moved, treat as click
    const node = nodesRef.current.find(n => n.id === wasDragging);
    if (node) onSelectNode(node);
  }, [onSelectNode]);

  const onWheel = useCallback((e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    onZoomChange(z => Math.min(Math.max(z + delta, 0.3), 3));
  }, [onZoomChange]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full cursor-grab active:cursor-grabbing"
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      onWheel={onWheel}
      style={{ display: 'block' }}
    />
  );
}