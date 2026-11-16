import { Download, FilePlus2, FolderOpen, Save, Trash2, Upload } from 'lucide-react';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { alphabetOf, isDeterministic, validateAutomaton } from '@automata/algorithms';
import { automatonSchema, automatonTypeSchema, emptyAutomaton, type AutomatonType, type SavedAutomaton } from '@automata/shared';
import { Badge, Button, cx, EmptyState, ErrorState, formatDate, Modal, Notice, Spinner, Tabs, useFetch } from '../components/ui';
import { AutomatonEditor } from '../editor/AutomatonEditor';
import { downloadJson, downloadPng, downloadSvg } from '../editor/exportImage';
import { BatchTester, SimulationPanel, type Highlight } from '../editor/SimulationPanel';
import { api, errorMessage } from '../lib/api';
import { EXAMPLES, TYPE_NAMES } from '../lib/examples';
import { convertType, toast, useTheme, useWorkspace } from '../lib/stores';

const NO_HIGHLIGHT: Highlight = { states: [], transitions: [] };

export function EditorPage() {
  const ws = useWorkspace();
  const dark = useTheme((s) => s.dark);
  const [highlight, setHighlight] = useState<Highlight>(NO_HIGHLIGHT);
  const [tab, setTab] = useState<'simulate' | 'batch' | 'check'>('simulate');
  const [openDialog, setOpenDialog] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const { automaton } = ws;
  const check = useMemo(() => validateAutomaton(automaton), [automaton]);

  const confirmDiscard = () => !ws.dirty || automaton.states.length === 0 || window.confirm('Discard the unsaved changes to the current automaton?');

  const changeType = (type: AutomatonType) => {
    if (type === automaton.type) return;
    const next = convertType(automaton, type);
    const dropped = automaton.transitions.length - next.transitions.length;
    if (dropped > 0 && !window.confirm(`${dropped} ε-transition(s) are not allowed in a ${TYPE_NAMES[type]} and will be removed. Continue?`)) return;
    ws.load(next, ws.name, ws.savedId);
    useWorkspace.setState({ dirty: true });
    setHighlight(NO_HIGHLIGHT);
  };

  const save = async () => {
    if (automaton.states.length === 0) return toast('error', 'Add at least one state before saving.');
    if (!ws.name.trim()) return toast('error', 'Give the automaton a name first.');
    setSaving(true);
    try {
      const body = { name: ws.name.trim(), data: automaton };
      const res = ws.savedId
        ? await api.put<{ automaton: SavedAutomaton }>(`/automata/${ws.savedId}`, body).catch(async (e) => {
            // The saved copy was deleted elsewhere: save as a new one instead.
            if ((e as { status?: number }).status === 404) return api.post<{ automaton: SavedAutomaton }>('/automata', body);
            throw e;
          })
        : await api.post<{ automaton: SavedAutomaton }>('/automata', body);
      ws.markSaved(res.automaton.id);
      toast('success', `Saved "${res.automaton.name}".`);
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const importJson = async (file: File) => {
    try {
      const parsed = automatonSchema.safeParse(JSON.parse(await file.text()));
      if (!parsed.success) throw new Error(`This file is not a valid automaton: ${parsed.error.issues[0]?.message ?? 'unknown format'}`);
      ws.load(parsed.data, file.name.replace(/\.json$/i, ''), null);
      toast('success', 'Automaton imported.');
    } catch (e) {
      toast('error', e instanceof SyntaxError ? 'This file is not valid JSON.' : errorMessage(e));
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* ---- document toolbar ---- */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-panel px-3 py-2">
        <input className="input !w-44 !py-1.5 font-medium" aria-label="Automaton name" value={ws.name} maxLength={120} onChange={(e) => ws.setName(e.target.value)} />
        <select className="input !w-auto !py-1.5" aria-label="Machine type" value={automaton.type} onChange={(e) => changeType(automatonTypeSchema.parse(e.target.value))}>
          {automatonTypeSchema.options.map((t) => (
            <option key={t} value={t}>
              {TYPE_NAMES[t]}
            </option>
          ))}
        </select>
        {ws.dirty && <Badge tone="amber">Unsaved</Badge>}
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <select
            className="input !w-32 !py-1.5"
            aria-label="Load an example"
            value=""
            onChange={(e) => {
              const ex = EXAMPLES.find((x) => x.id === e.target.value);
              if (ex && confirmDiscard()) {
                ws.load(ex.automaton, ex.name, null);
                setHighlight(NO_HIGHLIGHT);
              }
            }}
          >
            <option value="">Examples…</option>
            {EXAMPLES.map((ex) => (
              <option key={ex.id} value={ex.id}>
                {ex.name}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            icon={<FilePlus2 className="h-3.5 w-3.5" />}
            onClick={() => {
              if (confirmDiscard()) {
                ws.load(emptyAutomaton(automaton.type), 'Untitled automaton', null);
                setHighlight(NO_HIGHLIGHT);
              }
            }}
          >
            New
          </Button>
          <Button size="sm" icon={<FolderOpen className="h-3.5 w-3.5" />} onClick={() => setOpenDialog(true)}>
            Open
          </Button>
          <Button size="sm" variant="primary" icon={<Save className="h-3.5 w-3.5" />} loading={saving} onClick={save}>
            Save
          </Button>
          <ExportMenu
            disabled={automaton.states.length === 0}
            onSvg={() => downloadSvg(automaton, ws.name, dark)}
            onPng={() => downloadPng(automaton, ws.name, dark).catch((e) => toast('error', errorMessage(e)))}
            onJson={() => downloadJson(automaton, ws.name)}
          />
          <Button size="sm" icon={<Upload className="h-3.5 w-3.5" />} onClick={() => fileInput.current?.click()}>
            Import
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file && confirmDiscard()) void importJson(file);
              e.target.value = '';
            }}
          />
        </div>
      </div>

      {/* ---- canvas + side panel ---- */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="min-h-[45vh] flex-1 lg:min-h-0">
          <AutomatonEditor key={ws.docKey} initial={automaton} onChange={ws.edit} highlight={highlight} minimap />
        </div>
        <aside className="max-h-[50vh] w-full shrink-0 overflow-y-auto border-t border-line bg-panel p-4 lg:max-h-none lg:w-[22rem] lg:border-l lg:border-t-0">
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { id: 'simulate', label: 'Simulate' },
              { id: 'batch', label: 'Test strings' },
              {
                id: 'check',
                label: (
                  <span className="flex items-center gap-1.5">
                    Check {check.errors.length > 0 ? <Badge tone="red">{check.errors.length}</Badge> : check.warnings.length > 0 ? <Badge tone="amber">{check.warnings.length}</Badge> : null}
                  </span>
                ),
              },
            ]}
          />
          {tab === 'simulate' && <SimulationPanel automaton={automaton} onHighlight={setHighlight} />}
          {tab === 'batch' && <BatchTester automaton={automaton} />}
          {tab === 'check' && (
            <div className="space-y-3 text-sm">
              <dl className="grid grid-cols-2 gap-2">
                <Info label="Type" value={TYPE_NAMES[automaton.type]} />
                <Info label="States" value={automaton.states.length} />
                <Info label="Transitions" value={automaton.transitions.length} />
                <Info label={automaton.type === 'TM' ? 'Tape symbols' : 'Input alphabet'} value={alphabetOf(automaton).join(', ') || '—'} />
                {(automaton.type === 'NFA' || automaton.type === 'ENFA') && <Info label="Deterministic" value={isDeterministic(automaton) ? 'yes' : 'no'} />}
              </dl>
              {check.errors.length === 0 && check.warnings.length === 0 && automaton.states.length > 0 && <Notice tone="success">No problems found. This is a well-formed {TYPE_NAMES[automaton.type]}.</Notice>}
              {check.errors.map((e, i) => (
                <Notice key={`e${i}`} tone="error">
                  {e}
                </Notice>
              ))}
              {check.warnings.map((w, i) => (
                <Notice key={`w${i}`} tone="warn">
                  {w}
                </Notice>
              ))}
              {automaton.type === 'PDA' && <p className="text-xs text-muted">PDA conventions: the stack starts with Z, acceptance is by final state, and the leftmost pushed symbol becomes the new top.</p>}
              {automaton.type === 'TM' && <p className="text-xs text-muted">Turing machine conventions: single tape, deterministic, blank symbol _, accepts on entering an accepting state.</p>}
            </div>
          )}
        </aside>
      </div>

      {openDialog && (
        <OpenDialog
          onClose={() => setOpenDialog(false)}
          onOpen={(saved) => {
            if (!confirmDiscard()) return;
            ws.load(saved.data, saved.name, saved.id);
            setHighlight(NO_HIGHLIGHT);
            setOpenDialog(false);
          }}
        />
      )}
    </div>
  );
}

const Info = ({ label, value }: { label: string; value: ReactNode }) => (
  <div className="rounded-md border border-line px-2.5 py-1.5">
    <dt className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</dt>
    <dd className="truncate font-medium">{value}</dd>
  </div>
);

function ExportMenu({ disabled, onSvg, onPng, onJson }: { disabled: boolean; onSvg: () => void; onPng: () => void; onJson: () => void }) {
  const [open, setOpen] = useState(false);
  const pick = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  return (
    <div className="relative" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}>
      <Button size="sm" disabled={disabled} aria-haspopup="menu" aria-expanded={open} icon={<Download className="h-3.5 w-3.5" />} onClick={() => setOpen((o) => !o)}>
        Export
      </Button>
      {open && (
        <div role="menu" className="card absolute right-0 z-20 mt-1 w-40 overflow-hidden py-1 shadow-lg">
          {[
            ['SVG image', onSvg],
            ['PNG image', onPng],
            ['JSON file', onJson],
          ].map(([label, fn]) => (
            <button key={label as string} role="menuitem" type="button" className="block w-full px-3 py-1.5 text-left text-sm hover:bg-raised" onClick={pick(fn as () => void)}>
              {label as string}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function OpenDialog({ onClose, onOpen }: { onClose: () => void; onOpen: (a: SavedAutomaton) => void }) {
  const { data, error, loading, reload } = useFetch<{ automata: SavedAutomaton[] }>('/automata');
  const remove = async (a: SavedAutomaton) => {
    if (!window.confirm(`Delete "${a.name}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/automata/${a.id}`);
      if (useWorkspace.getState().savedId === a.id) useWorkspace.setState({ savedId: null, dirty: true });
      reload();
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  return (
    <Modal title="Open a saved automaton" onClose={onClose}>
      {loading && !data ? (
        <Spinner />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : data!.automata.length === 0 ? (
        <EmptyState title="Nothing saved yet">Draw an automaton and press Save to keep it in your account.</EmptyState>
      ) : (
        <ul className="divide-y divide-line">
          {data!.automata.map((a) => (
            <li key={a.id} className="flex items-center gap-2 py-2">
              <button type="button" className={cx('min-w-0 flex-1 rounded px-1 py-0.5 text-left hover:bg-raised')} onClick={() => onOpen(a)}>
                <div className="truncate text-sm font-medium">{a.name}</div>
                <div className="text-xs text-muted">
                  {TYPE_NAMES[a.type]} · {a.data.states.length} states · updated {formatDate(a.updated_at)}
                </div>
              </button>
              <Button size="sm" variant="ghost" aria-label={`Delete ${a.name}`} icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => remove(a)} />
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
