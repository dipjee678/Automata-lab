/**
 * Interactive automaton canvas built on React Flow.
 *
 * The component owns the canvas state. It is initialised from `initial` when
 * it mounts and reports every change through `onChange`; to REPLACE the
 * document (open a file, load an example) the parent remounts it with a new
 * `key`. Simulation highlights arrive through context so that stepping a
 * simulation never rebuilds the nodes.
 */
import {
  Background,
  BackgroundVariant,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useInternalNode,
  useNodesState,
  useReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ArrowRight, CircleDot, LayoutGrid, MousePointer2, Redo2, Trash2, Undo2 } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { layeredLayout, parseTransitionLabel, transitionLabel } from '@automata/algorithms';
import type { Automaton, AutomatonType, Transition } from '@automata/shared';
import { Button, cx, IconButton, Modal } from '../components/ui';
import { useTheme } from '../lib/stores';
import { boxAt, edgeGeometry, edgeLabelLines, NODE_H, nodeWidth } from './geometry';

/* ------------------------------------------------------------------ */
/* Flow <-> automaton conversion                                       */
/* ------------------------------------------------------------------ */

type StateData = { label: string; initial: boolean; accepting: boolean };
type StateNodeT = Node<StateData, 'state'>;
type EdgeData = { transitions: Transition[]; machine: AutomatonType };
type TransitionEdgeT = Edge<EdgeData, 'transition'>;

const edgeId = (from: string, to: string) => `e:${from}:${to}`;

function toFlow(a: Automaton): { nodes: StateNodeT[]; edges: TransitionEdgeT[] } {
  const ids = new Set(a.states.map((s) => s.id));
  const nodes: StateNodeT[] = a.states.map((s) => ({
    id: s.id,
    type: 'state',
    position: { x: s.x, y: s.y },
    data: { label: s.label, initial: !!s.initial, accepting: !!s.accepting },
  }));
  const map = new Map<string, TransitionEdgeT>();
  for (const t of a.transitions) {
    if (!ids.has(t.from) || !ids.has(t.to)) continue; // ignore dangling transitions
    const id = edgeId(t.from, t.to);
    const edge = map.get(id) ?? { id, source: t.from, target: t.to, type: 'transition' as const, data: { transitions: [], machine: a.type } };
    edge.data!.transitions.push(t);
    map.set(id, edge);
  }
  return { nodes, edges: [...map.values()] };
}

function fromFlow(type: AutomatonType, nodes: StateNodeT[], edges: TransitionEdgeT[], alphabet?: string[]): Automaton {
  return {
    type,
    states: nodes.map((n) => ({
      id: n.id,
      label: n.data.label,
      x: Math.round(n.position.x),
      y: Math.round(n.position.y),
      initial: n.data.initial,
      accepting: n.data.accepting,
    })),
    transitions: edges.flatMap((e) => e.data?.transitions ?? []),
    ...(alphabet ? { alphabet } : {}),
  };
}

/* ------------------------------------------------------------------ */
/* Context: highlights + interaction state shared with nodes/edges     */
/* ------------------------------------------------------------------ */

interface CanvasContext {
  activeStates: Set<string>;
  activeTransitions: Set<string>;
  pendingSource: string | null;
  /** "from:to" keys of all edges, to detect anti-parallel pairs. */
  pairs: Set<string>;
  selectEdge: (id: string) => void;
}
const Ctx = createContext<CanvasContext>({ activeStates: new Set(), activeTransitions: new Set(), pendingSource: null, pairs: new Set(), selectEdge: () => undefined });

function StateNode({ id, data, selected }: NodeProps<StateNodeT>) {
  const ctx = useContext(Ctx);
  const active = ctx.activeStates.has(id);
  const pending = ctx.pendingSource === id;
  const stroke = selected || pending ? 'var(--select)' : active ? 'var(--active)' : 'var(--state-stroke)';
  return (
    <div className="relative" style={{ width: nodeWidth(data.label), height: NODE_H }} aria-label={`State ${data.label}${data.initial ? ', initial' : ''}${data.accepting ? ', accepting' : ''}`}>
      {data.initial && (
        <svg className="pointer-events-none absolute" style={{ left: -36, top: NODE_H / 2 - 6 }} width="36" height="12" aria-hidden>
          <path d="M 2 6 L 26 6" stroke="var(--edge)" strokeWidth="1.6" />
          <polygon points="35,6 25,1.5 25,10.5" fill="var(--edge)" />
        </svg>
      )}
      <div
        className="flex h-full w-full items-center justify-center rounded-full text-[13px] font-semibold"
        style={{
          background: active ? 'var(--active-fill)' : 'var(--state-fill)',
          border: `2px solid ${stroke}`,
          boxShadow: selected || pending ? '0 0 0 4px rgb(var(--accent) / 0.22)' : undefined,
        }}
      >
        {data.accepting && <div className="pointer-events-none absolute rounded-full" style={{ inset: 5, border: `1.5px solid ${stroke}` }} />}
        <span className="relative select-none whitespace-nowrap">{data.label}</span>
      </div>
      {/* React Flow needs handles to attach edges to; ours are invisible because edges float. */}
      <Handle type="source" position={Position.Top} className="ghost-handle" isConnectable={false} />
      <Handle type="target" position={Position.Top} className="ghost-handle" isConnectable={false} />
    </div>
  );
}

function TransitionEdge({ id, source, target, data, selected }: EdgeProps<TransitionEdgeT>) {
  const ctx = useContext(Ctx);
  const s = useInternalNode<StateNodeT>(source);
  const t = useInternalNode<StateNodeT>(target);
  if (!s || !t || !data) return null;
  const geo = edgeGeometry(
    boxAt(s.internals.positionAbsolute.x, s.internals.positionAbsolute.y, s.data.label),
    boxAt(t.internals.positionAbsolute.x, t.internals.positionAbsolute.y, t.data.label),
    source === target,
    source !== target && ctx.pairs.has(`${target}:${source}`),
  );
  const active = data.transitions.some((tr) => ctx.activeTransitions.has(tr.id));
  const color = active ? 'var(--active)' : selected ? 'var(--select)' : 'var(--edge)';
  return (
    <>
      <path d={geo.path} fill="none" style={{ stroke: color, strokeWidth: active || selected ? 2.6 : 1.6 }} />
      <polygon points={geo.arrow} style={{ fill: color }} />
      <path d={geo.path} fill="none" stroke="transparent" strokeWidth={20} className="react-flow__edge-interaction" />
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan absolute cursor-pointer rounded px-1 py-px text-center font-mono text-[12.5px] leading-tight"
          style={{
            transform: `translate(-50%, -50%) translate(${geo.label.x}px, ${geo.label.y}px)`,
            pointerEvents: 'all',
            background: 'rgb(var(--panel) / 0.92)',
            color: active ? 'var(--active)' : selected ? 'var(--select)' : 'rgb(var(--ink))',
            fontWeight: active || selected ? 700 : 500,
            zIndex: selected ? 5 : 1,
          }}
          onClick={(e) => {
            e.stopPropagation();
            ctx.selectEdge(id);
          }}
        >
          {edgeLabelLines(data.machine, data.transitions).map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

const nodeTypes = { state: StateNode };
const edgeTypes = { transition: TransitionEdge };

/* ------------------------------------------------------------------ */
/* Editor                                                              */
/* ------------------------------------------------------------------ */

export interface EditorProps {
  initial: Automaton;
  onChange?: (automaton: Automaton) => void;
  readOnly?: boolean;
  highlight?: { states: string[]; transitions: string[] };
  className?: string;
  minimap?: boolean;
}

type Tool = 'select' | 'state' | 'transition';

const LABEL_HELP: Record<AutomatonType, { placeholder: string; help: string }> = {
  DFA: { placeholder: '0, 1', help: 'One or more input symbols, separated by commas.' },
  NFA: { placeholder: '0, 1', help: 'One or more input symbols, separated by commas.' },
  ENFA: { placeholder: 'a, ε', help: 'Input symbols separated by commas. Type ε or eps (or leave empty) for an ε-transition.' },
  PDA: { placeholder: 'a, Z → AZ', help: 'read, pop → push. Use ε for "nothing". The leftmost pushed symbol ends on top. Separate several rules with ;' },
  TM: { placeholder: 'a → b, R', help: 'read → write, move (L, R or S). Use _ for the blank symbol. Separate several rules with ;' },
};

let idCounter = 0;
const newId = (prefix: string) => `${prefix}${Date.now().toString(36)}${(idCounter++).toString(36)}`;

function EditorInner({ initial, onChange, readOnly = false, highlight, className, minimap = false }: EditorProps) {
  const type = initial.type;
  const start = useMemo(() => toFlow(initial), []); // eslint-disable-line react-hooks/exhaustive-deps -- initial is read once per mount
  const [nodes, setNodes, onNodesChange] = useNodesState<StateNodeT>(start.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<TransitionEdgeT>(start.edges);
  const [tool, setTool] = useState<Tool>('select');
  const [pendingSource, setPendingSource] = useState<string | null>(null);
  const [labelDialog, setLabelDialog] = useState<{ from: string; to: string } | null>(null);
  const flow = useReactFlow<StateNodeT, TransitionEdgeT>();
  const dark = useTheme((s) => s.dark);
  const wrapper = useRef<HTMLDivElement>(null);

  /* ---- change reporting + undo/redo ---- */
  const lastJson = useRef(JSON.stringify(fromFlow(type, start.nodes, start.edges, initial.alphabet)));
  const undoStack = useRef<string[]>([]);
  const redoStack = useRef<string[]>([]);
  const lastPush = useRef(0);
  const restoring = useRef(false);
  const [, bump] = useState(0);

  useEffect(() => {
    const automaton = fromFlow(type, nodes, edges, initial.alphabet);
    const json = JSON.stringify(automaton);
    if (json === lastJson.current) return; // selection / measurement changes only
    if (!restoring.current) {
      const now = Date.now();
      // A burst of changes (dragging a state) becomes a single undo step.
      if (now - lastPush.current > 500) {
        undoStack.current.push(lastJson.current);
        if (undoStack.current.length > 100) undoStack.current.shift();
      }
      lastPush.current = now;
      redoStack.current = [];
    }
    restoring.current = false;
    lastJson.current = json;
    bump((n) => n + 1);
    onChange?.(automaton);
  }, [nodes, edges]); // eslint-disable-line react-hooks/exhaustive-deps

  const restore = useCallback(
    (from: string[], to: string[]) => {
      const snapshot = from.pop();
      if (snapshot === undefined) return;
      to.push(lastJson.current);
      restoring.current = true;
      const next = toFlow(JSON.parse(snapshot) as Automaton);
      setNodes(next.nodes);
      setEdges(next.edges);
    },
    [setNodes, setEdges],
  );
  const undo = useCallback(() => restore(undoStack.current, redoStack.current), [restore]);
  const redo = useCallback(() => restore(redoStack.current, undoStack.current), [restore]);

  /* ---- editing actions ---- */
  const addState = useCallback(
    (x: number, y: number) => {
      setNodes((current) => {
        const used = new Set(current.map((n) => n.data.label));
        let n = 0;
        while (used.has(`q${n}`)) n++;
        const node: StateNodeT = {
          id: newId('s'),
          type: 'state',
          position: { x: x - NODE_H / 2, y: y - NODE_H / 2 },
          data: { label: `q${n}`, initial: current.length === 0, accepting: false },
          selected: true,
        };
        return [...current.map((c) => ({ ...c, selected: false })), node];
      });
      setEdges((current) => current.map((e) => (e.selected ? { ...e, selected: false } : e)));
    },
    [setNodes, setEdges],
  );

  const updateNode = useCallback(
    (id: string, patch: Partial<StateData>) => {
      setNodes((current) =>
        current.map((n) => {
          if (n.id === id) return { ...n, data: { ...n.data, ...patch } };
          // There is exactly one initial state: setting it elsewhere clears the old one.
          if (patch.initial && n.data.initial) return { ...n, data: { ...n.data, initial: false } };
          return n;
        }),
      );
    },
    [setNodes],
  );

  /** Add transitions between two states, merging into an existing edge. */
  const addTransitions = useCallback(
    (from: string, to: string, parts: Array<Omit<Transition, 'id' | 'from' | 'to'>>) => {
      setEdges((current) => {
        const id = edgeId(from, to);
        const existing = current.find((e) => e.id === id);
        const key = (t: Omit<Transition, 'id' | 'from' | 'to'>) => JSON.stringify([t.symbol, t.pop ?? null, t.push ?? null, t.write ?? null, t.move ?? null]);
        const have = new Set((existing?.data?.transitions ?? []).map(key));
        const fresh = parts.filter((p) => !have.has(key(p))).map((p) => ({ ...p, id: newId('t'), from, to }));
        const transitions = [...(existing?.data?.transitions ?? []), ...fresh];
        const others = current.filter((e) => e.id !== id).map((e) => (e.selected ? { ...e, selected: false } : e));
        return [...others, { id, source: from, target: to, type: 'transition' as const, data: { transitions, machine: type }, selected: true }];
      });
      setNodes((current) => current.map((n) => (n.selected ? { ...n, selected: false } : n)));
    },
    [setEdges, setNodes, type],
  );

  /** Replace all transitions of an edge from its label text. Returns an error message or null. */
  const setEdgeLabel = useCallback(
    (id: string, text: string): string | null => {
      const { parts, error } = parseTransitionLabel(type, text);
      if (error) return error;
      setEdges((current) =>
        current.map((e) =>
          e.id === id
            ? { ...e, data: { machine: type, transitions: parts.map((p, i) => ({ ...p, id: e.data?.transitions[i]?.id ?? newId('t'), from: e.source, to: e.target })) } }
            : e,
        ),
      );
      return null;
    },
    [setEdges, type],
  );

  const selectedNodes = nodes.filter((n) => n.selected);
  const selectedEdges = edges.filter((e) => e.selected);
  const deleteSelected = useCallback(() => {
    void flow.deleteElements({ nodes: selectedNodes, edges: selectedEdges });
  }, [flow, selectedNodes, selectedEdges]);

  const autoLayout = useCallback(() => {
    const index = new Map(nodes.map((n, i) => [n.id, i]));
    const startIndex = Math.max(0, nodes.findIndex((n) => n.data.initial));
    const pos = layeredLayout(nodes.length, edges.map((e) => [index.get(e.source)!, index.get(e.target)!] as [number, number]), startIndex);
    setNodes((current) => current.map((n, i) => ({ ...n, position: pos[i]! })));
    setTimeout(() => void flow.fitView({ padding: 0.25, maxZoom: 1.2, duration: 200 }), 30);
  }, [nodes, edges, setNodes, flow]);

  const selectEdge = useCallback(
    (id: string) => {
      if (readOnly) return;
      setEdges((current) => current.map((e) => ({ ...e, selected: e.id === id })));
      setNodes((current) => current.map((n) => (n.selected ? { ...n, selected: false } : n)));
    },
    [readOnly, setEdges, setNodes],
  );

  /* ---- canvas events ---- */
  const onPaneClick = useCallback(
    (e: ReactMouseEvent) => {
      if (readOnly) return;
      if (tool === 'state') {
        const p = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
        addState(p.x, p.y);
      }
      setPendingSource(null);
    },
    [readOnly, tool, flow, addState],
  );

  const onNodeClick = useCallback(
    (_e: ReactMouseEvent, node: StateNodeT) => {
      if (readOnly || tool !== 'transition') return;
      if (pendingSource === null) setPendingSource(node.id);
      else {
        setLabelDialog({ from: pendingSource, to: node.id });
        setPendingSource(null);
      }
    },
    [readOnly, tool, pendingSource],
  );

  const onDoubleClick = useCallback(
    (e: ReactMouseEvent) => {
      // Double-click on empty canvas adds a state (in any tool).
      if (readOnly || !(e.target as HTMLElement).classList.contains('react-flow__pane')) return;
      const p = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      addState(p.x, p.y);
    },
    [readOnly, flow, addState],
  );

  const onKeyDown = (e: ReactKeyboardEvent) => {
    const el = e.target as HTMLElement;
    if (readOnly || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    } else if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      redo();
    } else if (!mod && e.key.toLowerCase() === 'v') setTool('select');
    else if (!mod && e.key.toLowerCase() === 's') setTool('state');
    else if (!mod && e.key.toLowerCase() === 't') setTool('transition');
    else if (e.key === 'Escape') {
      setPendingSource(null);
      setTool('select');
    }
  };

  useEffect(() => {
    if (tool !== 'transition') setPendingSource(null);
  }, [tool]);

  const ctx = useMemo<CanvasContext>(
    () => ({
      activeStates: new Set(highlight?.states ?? []),
      activeTransitions: new Set(highlight?.transitions ?? []),
      pendingSource,
      pairs: new Set(edges.map((e) => `${e.source}:${e.target}`)),
      selectEdge,
    }),
    [highlight, pendingSource, edges, selectEdge],
  );

  const labelOf = (id: string) => nodes.find((n) => n.id === id)?.data.label ?? '?';
  const single = selectedNodes.length === 1 && selectedEdges.length === 0 ? selectedNodes[0]! : null;
  const singleEdge = selectedEdges.length === 1 && selectedNodes.length === 0 ? selectedEdges[0]! : null;
  const hint = readOnly
    ? null
    : tool === 'state'
      ? 'Click anywhere on the canvas to add a state.'
      : tool === 'transition'
        ? pendingSource
          ? `From ${labelOf(pendingSource)} — now click the target state (click ${labelOf(pendingSource)} again for a loop).`
          : 'Click the source state, then the target state.'
        : nodes.length === 0
          ? 'Empty canvas — double-click to add your first state, or pick the State tool.'
          : null;

  return (
    <div ref={wrapper} className={cx('relative h-full w-full outline-none', `tool-${tool}`, className)} onKeyDown={onKeyDown} onDoubleClick={onDoubleClick} tabIndex={0} data-testid="automaton-canvas">
      <Ctx.Provider value={ctx}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onPaneClick={onPaneClick}
          onNodeClick={onNodeClick}
          onNodeDoubleClick={(_e, node) => !readOnly && tool === 'select' && updateNode(node.id, { accepting: !node.data.accepting })}
          nodesDraggable={tool === 'select'}
          nodesConnectable={false}
          elementsSelectable={!readOnly && tool === 'select'}
          deleteKeyCode={readOnly ? null : ['Delete', 'Backspace']}
          zoomOnDoubleClick={false}
          minZoom={0.2}
          maxZoom={2.5}
          fitView
          fitViewOptions={{ padding: 0.25, maxZoom: 1.2 }}
          colorMode={dark ? 'dark' : 'light'}
          proOptions={{ hideAttribution: false }}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} color={dark ? '#3a4050' : '#cfd5de'} />
          <Controls showInteractive={false} position="bottom-left" />
          {minimap && <MiniMap pannable zoomable className="!hidden lg:!block" nodeColor={dark ? '#64748b' : '#94a3b8'} maskColor={dark ? 'rgba(0,0,0,.5)' : 'rgba(240,242,245,.6)'} />}

          {!readOnly && (
            <Panel position="top-left">
              <div className="card flex items-center gap-0.5 p-1 shadow-sm" role="toolbar" aria-label="Canvas tools">
                <IconButton label="Select and move (V)" active={tool === 'select'} onClick={() => setTool('select')}>
                  <MousePointer2 className="h-4 w-4" />
                </IconButton>
                <IconButton label="Add state (S)" active={tool === 'state'} onClick={() => setTool('state')}>
                  <CircleDot className="h-4 w-4" />
                </IconButton>
                <IconButton label="Add transition (T)" active={tool === 'transition'} onClick={() => setTool('transition')}>
                  <ArrowRight className="h-4 w-4" />
                </IconButton>
                <span className="mx-1 h-5 w-px bg-line" />
                <IconButton label="Undo (Ctrl+Z)" disabled={undoStack.current.length === 0} onClick={undo}>
                  <Undo2 className="h-4 w-4" />
                </IconButton>
                <IconButton label="Redo (Ctrl+Y)" disabled={redoStack.current.length === 0} onClick={redo}>
                  <Redo2 className="h-4 w-4" />
                </IconButton>
                <IconButton label="Delete selection (Del)" disabled={selectedNodes.length + selectedEdges.length === 0} onClick={deleteSelected}>
                  <Trash2 className="h-4 w-4" />
                </IconButton>
                <IconButton label="Tidy layout" disabled={nodes.length === 0} onClick={autoLayout}>
                  <LayoutGrid className="h-4 w-4" />
                </IconButton>
              </div>
            </Panel>
          )}

          {hint && (
            <Panel position="bottom-center">
              <div className="rounded-full border border-line bg-panel/95 px-3 py-1 text-xs text-muted shadow-sm">{hint}</div>
            </Panel>
          )}

          {!readOnly && single && (
            <Panel position="top-right">
              <StateProperties key={single.id} node={single} onChange={(patch) => updateNode(single.id, patch)} onDelete={deleteSelected} />
            </Panel>
          )}
          {!readOnly && singleEdge && (
            <Panel position="top-right">
              <EdgeProperties
                key={singleEdge.id + (singleEdge.data?.transitions.length ?? 0)}
                type={type}
                title={`${labelOf(singleEdge.source)} → ${labelOf(singleEdge.target)}`}
                transitions={singleEdge.data?.transitions ?? []}
                onApply={(text) => setEdgeLabel(singleEdge.id, text)}
                onDelete={deleteSelected}
              />
            </Panel>
          )}
        </ReactFlow>
      </Ctx.Provider>

      {labelDialog && (
        <LabelDialog
          type={type}
          title={`New transition ${labelOf(labelDialog.from)} → ${labelOf(labelDialog.to)}`}
          onCancel={() => setLabelDialog(null)}
          onSubmit={(text) => {
            const { parts, error } = parseTransitionLabel(type, text);
            if (error) return error;
            addTransitions(labelDialog.from, labelDialog.to, parts);
            setLabelDialog(null);
            return null;
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Side panels and dialogs                                             */
/* ------------------------------------------------------------------ */

function StateProperties({ node, onChange, onDelete }: { node: StateNodeT; onChange: (patch: Partial<StateData>) => void; onDelete: () => void }) {
  const [label, setLabel] = useState(node.data.label);
  const commit = () => {
    const clean = label.trim().slice(0, 40);
    if (clean && clean !== node.data.label) onChange({ label: clean });
    else setLabel(node.data.label);
  };
  return (
    <div className="card w-52 space-y-2.5 p-3 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted">State</div>
      <label className="block">
        <span className="label">Name</span>
        <input className="input" value={label} maxLength={40} aria-label="State name" onChange={(e) => setLabel(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={node.data.initial} onChange={(e) => onChange({ initial: e.target.checked })} /> Initial state
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={node.data.accepting} onChange={(e) => onChange({ accepting: e.target.checked })} /> Accepting state
      </label>
      <Button size="sm" variant="ghost" className="w-full !justify-start text-red-600 dark:text-red-400" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={onDelete}>
        Delete state
      </Button>
    </div>
  );
}

function EdgeProperties({ type, title, transitions, onApply, onDelete }: { type: AutomatonType; title: string; transitions: Transition[]; onApply: (text: string) => string | null; onDelete: () => void }) {
  const initialText = transitions.map((t) => transitionLabel(type, t)).join(type === 'PDA' || type === 'TM' ? ' ; ' : ', ');
  const [text, setText] = useState(initialText);
  const [error, setError] = useState<string | null>(null);
  const apply = () => setError(text === initialText ? null : onApply(text));
  return (
    <div className="card w-60 space-y-2.5 p-3 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted">Transition {title}</div>
      <label className="block">
        <span className="label">Label</span>
        <input className="input font-mono" value={text} aria-label="Transition label" placeholder={LABEL_HELP[type].placeholder} onChange={(e) => setText(e.target.value)} onBlur={apply} onKeyDown={(e) => e.key === 'Enter' && apply()} />
      </label>
      {error ? <p className="text-xs text-red-600 dark:text-red-400">{error}</p> : <p className="text-xs text-muted">{LABEL_HELP[type].help}</p>}
      <Button size="sm" variant="ghost" className="w-full !justify-start text-red-600 dark:text-red-400" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={onDelete}>
        Delete transition
      </Button>
    </div>
  );
}

function LabelDialog({ type, title, onSubmit, onCancel }: { type: AutomatonType; title: string; onSubmit: (text: string) => string | null; onCancel: () => void }) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = () => setError(onSubmit(text));
  return (
    <Modal
      title={title}
      onClose={onCancel}
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" onClick={submit}>
            Add transition
          </Button>
        </>
      }
    >
      <label className="block">
        <span className="label">Label</span>
        <input
          className="input font-mono"
          value={text}
          placeholder={LABEL_HELP[type].placeholder}
          aria-label="Transition label"
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
      </label>
      {error ? <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p> : <p className="mt-2 text-sm text-muted">{LABEL_HELP[type].help}</p>}
      {(type === 'ENFA' || type === 'PDA') && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Button size="sm" onClick={() => setText((t) => t + 'ε')}>
            Insert ε
          </Button>
          {type === 'PDA' && (
            <Button size="sm" onClick={() => setText((t) => t + ' → ')}>
              Insert →
            </Button>
          )}
        </div>
      )}
      {type === 'TM' && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Button size="sm" onClick={() => setText((t) => t + ' → ')}>
            Insert →
          </Button>
          <Button size="sm" onClick={() => setText((t) => t + '_')}>
            Insert blank _
          </Button>
        </div>
      )}
    </Modal>
  );
}

/** The automaton canvas. Remount with a new `key` to load a different document. */
export function AutomatonEditor(props: EditorProps) {
  return (
    <ReactFlowProvider>
      <EditorInner {...props} />
    </ReactFlowProvider>
  );
}
