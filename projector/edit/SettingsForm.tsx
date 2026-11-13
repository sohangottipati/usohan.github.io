'use client';

// Builds a widget's settings panel from its settingsSchema.

import { useRef, useState } from 'react';
import { fieldVisible, FONT_OPTIONS, type LocationValue, type SettingsField } from '../shared/widgets/types';
import { uploadImage } from './upload';
import css from './editor.module.css';

interface Props {
  schema: SettingsField[];
  values: Record<string, any>;
  onChange(key: string, value: any): void;
}

export default function SettingsForm({ schema, values, onChange }: Props) {
  return (
    <div className={css.form}>
      {schema
        .filter((f) => fieldVisible(f, values))
        .map((f) =>
          f.type === 'toggle' ? (
            <label key={f.key} className={css.fieldInline}>
              <input type="checkbox" checked={!!values[f.key]} onChange={(e) => onChange(f.key, e.target.checked)} />
              <span>{f.label}</span>
              {f.help && <span className={css.help}>{f.help}</span>}
            </label>
          ) : (
            // Composite fields hold buttons, so they can't live inside a <label>.
            <div key={f.key} className={css.field}>
              <span className={css.fieldLabel}>{f.label}</span>
              <FieldInput field={f} value={values[f.key]} onChange={(v) => onChange(f.key, v)} />
              {f.help && <span className={css.help}>{f.help}</span>}
            </div>
          ),
        )}
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
      return <ImageInput value={value ?? ''} onChange={onChange} />;
    case 'location':
      return <LocationInput value={value} onChange={onChange} />;
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
        <select className={css.input} value={value} onChange={(e) => onChange(e.target.value)} style={{ fontFamily: value }}>
          {FONT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value} style={{ fontFamily: o.value }}>
              {o.label}
            </option>
          ))}
        </select>
      );
    case 'toggle':
      return <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />;
  }
}

function ImageInput({ value, onChange }: { value: string; onChange(v: string): void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <input className={css.input} type="url" value={value} placeholder="https://… or upload" onChange={(e) => onChange(e.target.value)} />
      <span className={css.row}>
        <button type="button" disabled={busy} onClick={() => fileRef.current?.click()}>
          {busy ? 'Uploading…' : 'Upload image'}
        </button>
        {value && (
          <button type="button" onClick={() => onChange('')}>
            Clear
          </button>
        )}
      </span>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        hidden
        onChange={async (e) => {
          const file = e.target.files && e.target.files[0];
          e.target.value = '';
          if (!file) return;
          setBusy(true);
          setError(null);
          try {
            onChange(await uploadImage(file));
          } catch (err: any) {
            setError(err.message);
          } finally {
            setBusy(false);
          }
        }}
      />
      {error && <span className={css.errorText}>{error}</span>}
    </>
  );
}

interface GeoResult {
  id: number;
  name: string;
  admin1?: string;
  country?: string;
  country_code?: string;
  latitude: number;
  longitude: number;
}

function LocationInput({ value, onChange }: { value: LocationValue | undefined; onChange(v: LocationValue): void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeoResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search() {
    if (!query.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch('https://geocoding-api.open-meteo.com/v1/search?count=6&language=en&format=json&name=' + encodeURIComponent(query.trim()));
      const j = await r.json();
      setResults(j.results || []);
    } catch (e) {
      setError('Place search failed. Check your connection.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {value && (
        <span className={css.muted}>
          {value.name} <span className={css.help} style={{ display: 'inline' }}>({value.lat.toFixed(2)}, {value.lon.toFixed(2)})</span>
        </span>
      )}
      <form
        className={css.row}
        onSubmit={(e) => {
          e.preventDefault();
          search();
        }}
      >
        <input className={css.input} value={query} placeholder="Search a city" onChange={(e) => setQuery(e.target.value)} />
        <button type="submit" disabled={busy || !query.trim()}>
          {busy ? '…' : 'Find'}
        </button>
      </form>
      {error && <span className={css.errorText}>{error}</span>}
      {results && (
        <ul className={css.pickList}>
          {results.length === 0 && <li className={css.muted}>No matches</li>}
          {results.map((r) => {
            const region = r.country_code === 'US' && r.admin1 ? r.admin1 : r.country || r.admin1 || '';
            const label = region ? `${r.name}, ${region}` : r.name;
            return (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => {
                    onChange({ name: label, lat: +r.latitude.toFixed(4), lon: +r.longitude.toFixed(4) });
                    setResults(null);
                    setQuery('');
                  }}
                >
                  {label}
                  {r.admin1 && r.country_code !== 'US' ? <span className={css.layerType}>{r.admin1}</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
