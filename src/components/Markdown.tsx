'use client';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/** Renders AI output. react-markdown does not render raw HTML, so model text cannot inject markup. */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="prose-legal">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}
