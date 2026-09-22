'use client';

import { useState } from 'react';
import { jsonHeaders } from '@/lib/csrf-client';

/**
 * ASK JOJO, given the prominence the directive asks for. The suggested questions
 * are the definition-of-done questions, so the first thing a person sees is the
 * list of things the system will answer about itself.
 */
const QUESTIONS = [
  'What did it do overnight?',
  'Who should we approach?',
  "What's in the pipeline?",
  'What needs my decision?',
  'What is it blocked on?',
  'Is it working?',
];

interface Answer {
  question: string;
  answer: string;
  basis: string;
  suggestions: string[];
}

export function AskJojoGtm() {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Answer | null>(null);

  async function ask(question: string) {
    if (!question.trim()) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch('/api/gtm/ask', {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ question }),
      });
      setResult((await res.json()) as Answer);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card jojo-hero">
      <div className="card-title">Ask JoJo</div>
      <form
        className="row"
        style={{ gap: 8 }}
        onSubmit={(e) => {
          e.preventDefault();
          void ask(value);
        }}
      >
        <input
          className="input"
          placeholder="Ask anything about the go-to-market engine"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button className="btn primary" disabled={busy || !value.trim()} type="submit">
          {busy ? 'Looking…' : 'Ask'}
        </button>
      </form>

      <div className="row wrap" style={{ gap: 6, marginTop: 10 }}>
        {QUESTIONS.map((q) => (
          <button
            key={q}
            className="btn tiny"
            type="button"
            disabled={busy}
            onClick={() => { setValue(q); void ask(q); }}
          >
            {q}
          </button>
        ))}
      </div>

      {result ? (
        <div style={{ marginTop: 14 }}>
          <pre className="answer">{result.answer}</pre>
          <div className="tiny faint" style={{ marginTop: 8 }}>
            <strong>Where this comes from:</strong> {result.basis}
          </div>
          {result.suggestions.length > 0 ? (
            <ul className="tiny" style={{ marginTop: 8 }}>
              {result.suggestions.map((s) => <li key={s}>{s}</li>)}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
