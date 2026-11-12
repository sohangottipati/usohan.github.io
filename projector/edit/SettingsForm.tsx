'use client';

// Builds a widget's settings panel from its settingsSchema.

import type { SettingsField } from '../shared/widgets/types';
import { FONT_OPTIONS } from '../shared/widgets/types';
import css from './editor.module.css';

interface Props {
  schema: SettingsField[];
  values: Record<string, any>;
  onChange(key: string, value: any): void;
}

export default function SettingsForm({ schema, values, onChange }: Props) {
  return (
    <div className={css.form}>
      {schema.map((f) => (
        <label key={f.key} className={f.type === 'toggle' ? css.fieldInline : css.field}>
          <span className={css.fieldLabel}>{f.label}</span>
          <FieldInput field={f} value={values[f.key]} onChange={(v) => onChange(f.key, v)} />
          {f.help && <span className={css.help}>{f.help}</span>}
        </label>
      ))}
    </div>
  );
}

function FieldInput({ field, value, onChange }: { field: SettingsField; value: any; onChange(v: any): void }) {
  switch (field.type) {
    case 'text':
      return field.multiline ? (
        <textarea className={css.input} rows={3} value={value ?? ''} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input className={css.input} value={value ?? ''} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />
      );
    case 'image':
      return <input className={css.input} type="url" value={value ?? ''} placeholder="https://…" onChange={(e) => onChange(e.target.value)} />;
    case 'number':
      return (
        <input
          className={css.input}
          type="number"
          value={value ?? 0}
          min={field.min}
          max={field.max}
          step={field.step ?? 1}
          onChange={(e) => {
            const n = parseFloat(e.target.value);
            if (isFinite(n)) onChange(n);
          }}
        />
      );
    case 'color':
      return (
        <span className={css.colorRow}>
          <input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff'} onChange={(e) => onChange(e.target.value)} />
          <input className={css.input} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
        </span>
      );
    case 'select':
      return (
        <select className={css.input} value={value} onChange={(e) => onChange(e.target.value)}>
          {field.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    case 'font':
      return (
        <select className={css.input} value={value} onChange={(e) => onChange(e.target.value)}>
          {FONT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    case 'toggle':
      return <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />;
  }
}
