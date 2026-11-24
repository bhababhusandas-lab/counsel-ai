import { useEffect, useState } from 'react';
import { FileText, Download, Loader2, Sparkles } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { invokeFunction, getFunction } from '@/lib/api';

type FieldDef = { key: string; label: string; required: boolean; hint?: string };
type TemplateDef = { id: string; label: string; category: string; formats: string[]; fields: FieldDef[] };

const FORMAT_LABEL: Record<string, string> = { pdf: 'PDF', docx: 'Word', xlsx: 'Excel', pptx: 'PowerPoint' };
const FORMAT_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};
const FORMAT_EXT: Record<string, string> = { pdf: 'pdf', docx: 'docx', xlsx: 'xlsx', pptx: 'pptx' };

function downloadBase64(b64: string, mime: string, filename: string) {
  const bytes = atob(b64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([arr], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

type Preset = { templateId?: string; values?: Record<string, string>; request?: string } | null;

export function DocumentDialog({ open, onOpenChange, preset }: { open: boolean; onOpenChange: (v: boolean) => void; preset?: Preset }) {
  const [templates, setTemplates] = useState<TemplateDef[] | null>(null);
  const [customAvailable, setCustomAvailable] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [templateId, setTemplateId] = useState<string | null>(null);
  const [isCustom, setIsCustom] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [customReq, setCustomReq] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || templates) return;
    getFunction('document-templates')
      .then(({ data }) => { setTemplates(data.templates); setCustomAvailable(!!data.custom); })
      .catch((e) => setLoadError(e instanceof Error ? e.message : 'Could not load document types.'));
  }, [open, templates]);

  // Apply a preset from the chat: pre-select the template (keeping only the
  // fields that template actually has) or open the custom box with the request.
  useEffect(() => {
    if (!open || !preset || !templates) return;
    if (preset.templateId) {
      const t = templates.find((x) => x.id === preset.templateId);
      if (t) {
        const keys = new Set(t.fields.map((f) => f.key));
        const vals: Record<string, string> = {};
        for (const [k, v] of Object.entries(preset.values || {})) if (keys.has(k) && v) vals[k] = v;
        setTemplateId(t.id); setValues(vals); setIsCustom(false);
      }
    } else if (preset.request) {
      setIsCustom(true); setCustomReq(preset.request);
    }
  }, [open, preset, templates]);

  const template = templates?.find((t) => t.id === templateId) || null;
  const reset = () => { setTemplateId(null); setIsCustom(false); setValues({}); setCustomReq(''); setError(null); };
  const close = () => { onOpenChange(false); reset(); };

  const generate = async (format: string) => {
    setBusy(format); setError(null);
    try {
      let body: Record<string, unknown>;
      if (isCustom) {
        if (!customReq.trim()) { setError('Describe the document you want.'); setBusy(null); return; }
        body = { templateId: 'custom', request: customReq, formats: [format] };
      } else {
        if (!template) return;
        const missing = template.fields.filter((f) => f.required && !(values[f.key] || '').trim());
        if (missing.length) { setError(`Please fill: ${missing.map((m) => m.label).join(', ')}`); setBusy(null); return; }
        body = { templateId: template.id, fields: values, formats: [format] };
      }
      const { data } = await invokeFunction('generate-document', { body });
      const base = (data.filenameBase as string) || 'document';
      if (data[format]) {
        downloadBase64(data[format], FORMAT_MIME[format], `${base}.${FORMAT_EXT[format]}`);
      } else {
        setError('The server did not return that format.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not generate the document.');
    } finally {
      setBusy(null);
    }
  };

  // Group templates by category for the picker.
  const grouped: Record<string, TemplateDef[]> = {};
  for (const t of templates || []) (grouped[t.category] ||= []).push(t);

  const activeFormats = isCustom ? ['pdf', 'docx'] : (template?.formats || []);

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? onOpenChange(true) : close())}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText size={18} /> Generate a legal document
          </DialogTitle>
          <DialogDescription>
            A starting draft grounded in Indian law. Have an advocate review it before you rely on it.
          </DialogDescription>
        </DialogHeader>

        {loadError && <div className="text-sm text-destructive py-2">{loadError}</div>}
        {!templates && !loadError && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
            <Loader2 className="animate-spin" size={16} /> Loading document types…
          </div>
        )}

        {/* Picker */}
        {templates && !template && !isCustom && (
          <div className="flex flex-col gap-4 py-1">
            {Object.entries(grouped).map(([cat, items]) => (
              <div key={cat} className="flex flex-col gap-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{cat}</div>
                {items.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => { setTemplateId(t.id); setError(null); }}
                    className="text-left rounded-lg border border-border p-3 hover:bg-accent transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{t.label}</span>
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {t.formats.map((x) => FORMAT_LABEL[x] || x).join(' · ')}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            ))}

            {customAvailable && (
              <button
                onClick={() => { setIsCustom(true); setError(null); }}
                className="text-left rounded-lg border border-dashed border-primary/50 p-3 hover:bg-accent transition-colors"
              >
                <div className="flex items-center gap-2 font-medium"><Sparkles size={15} /> Describe any other document</div>
                <div className="text-sm text-muted-foreground">Draft something not in the list, using the self-hosted model.</div>
              </button>
            )}
          </div>
        )}

        {/* Template form */}
        {template && (
          <div className="flex flex-col gap-3 py-1">
            <button onClick={reset} className="text-sm text-muted-foreground hover:text-foreground self-start">&larr; Choose a different document</button>
            <div className="font-medium">{template.label}</div>
            {template.fields.map((f) => (
              <div key={f.key} className="flex flex-col gap-1">
                <Label htmlFor={`doc-${f.key}`}>{f.label}{f.required && <span className="text-destructive"> *</span>}</Label>
                <Input id={`doc-${f.key}`} value={values[f.key] || ''} placeholder={f.hint || ''}
                       onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} />
              </div>
            ))}
            {error && <div className="text-sm text-destructive">{error}</div>}
            <FormatButtons formats={activeFormats} busy={busy} onPick={generate} />
          </div>
        )}

        {/* Custom request */}
        {isCustom && (
          <div className="flex flex-col gap-3 py-1">
            <button onClick={reset} className="text-sm text-muted-foreground hover:text-foreground self-start">&larr; Back to the list</button>
            <div className="font-medium flex items-center gap-2"><Sparkles size={15} /> Describe the document</div>
            <Textarea rows={5} value={customReq} placeholder="e.g. A franchise agreement between a bakery and a franchisee for a 5-year term in Karnataka, with a 6% royalty…"
                      onChange={(e) => setCustomReq(e.target.value)} />
            {error && <div className="text-sm text-destructive">{error}</div>}
            <FormatButtons formats={activeFormats} busy={busy} onPick={generate} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function FormatButtons({ formats, busy, onPick }: { formats: string[]; busy: string | null; onPick: (f: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2 pt-1">
      {formats.map((fmt, i) => (
        <Button key={fmt} onClick={() => onPick(fmt)} disabled={!!busy}
                variant={i === 0 ? 'default' : 'secondary'} className="flex-1 min-w-[100px]">
          {busy === fmt ? <Loader2 className="animate-spin" size={16} /> : <Download size={16} />}
          <span className="ml-1">{FORMAT_LABEL[fmt] || fmt}</span>
        </Button>
      ))}
    </div>
  );
}
