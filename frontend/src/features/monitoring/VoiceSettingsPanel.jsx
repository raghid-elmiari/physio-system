import { useEffect, useState } from "react";

/** Mute / rate / volume / language / voice controls for the voice coach. Settings persist per device. */
export default function VoiceSettingsPanel({ s }) {
  const [voices, setVoices] = useState([]);
  const { voice, updateVoice, listVoices } = s;

  useEffect(() => {
    let cancelled = false;
    listVoices().then((v) => !cancelled && setVoices(v));
    return () => {
      cancelled = true;
    };
  }, [listVoices]);

  const langs = [...new Set(voices.map((v) => v.lang))].sort();
  const forLang = voices.filter((v) => v.lang === voice.lang || v.lang.startsWith(voice.lang.split("-")[0]));

  return (
    <section className="card">
      <div className="card-head">
        <h2>Voice coach</h2>
        <label className="switch">
          <input type="checkbox" checked={voice.enabled} onChange={(e) => updateVoice({ enabled: e.target.checked })} />
          {voice.enabled ? "On" : "Muted"}
        </label>
      </div>
      {!s.voiceSupported && <div className="alert warning small">This browser has no text-to-speech. Feedback is shown on screen only.</div>}
      {s.voiceSupported && voice.enabled && (
        <div className="stack" style={{ gap: 10 }}>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="v-rate">Speed: {voice.rate.toFixed(1)}×</label>
            <input id="v-rate" type="range" min="0.6" max="1.6" step="0.1" value={voice.rate} onChange={(e) => updateVoice({ rate: Number(e.target.value) })} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="v-vol">Volume: {Math.round(voice.volume * 100)}%</label>
            <input id="v-vol" type="range" min="0.2" max="1" step="0.1" value={voice.volume} onChange={(e) => updateVoice({ volume: Number(e.target.value) })} />
          </div>
          {langs.length > 0 && (
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="v-lang">Language</label>
              <select id="v-lang" className="input" value={voice.lang} onChange={(e) => updateVoice({ lang: e.target.value, voiceId: null })}>
                {!langs.includes(voice.lang) && <option value={voice.lang}>{voice.lang}</option>}
                {langs.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
              <span className="help">Coaching phrases are currently written in English.</span>
            </div>
          )}
          {forLang.length > 0 && (
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="v-voice">Voice</label>
              <select id="v-voice" className="input" value={voice.voiceId || ""} onChange={(e) => updateVoice({ voiceId: e.target.value || null })}>
                <option value="">Default (on-device if available)</option>
                {forLang.map((v) => <option key={v.id} value={v.id}>{v.name}{v.local ? "" : " (online)"}</option>)}
              </select>
            </div>
          )}
        </div>
      )}
      {!voice.enabled && <p className="small muted">Spoken feedback is off; messages still appear on screen.</p>}
    </section>
  );
}
