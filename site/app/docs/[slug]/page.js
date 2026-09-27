import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DOCS, GROUPS, getDoc, getNeighbors } from '../../../lib/docs';

export function generateStaticParams() {
  return DOCS.map(d => ({ slug: d.slug }));
}

export async function generateMetadata({ params }) {
  const doc = getDoc(params.slug);
  if (!doc) return {};
  return {
    title: `${doc.title} — Documentation Bumpify`,
    description: doc.desc,
  };
}

// Rendu inline du markdown minimal (gras, code inline) dans les blocs de texte.
function renderInline(text) {
  const parts = [];
  const regex = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0, m, key = 0;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const token = m[0];
    if (token.startsWith('**')) parts.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    else parts.push(<code key={key++}>{token.slice(1, -1)}</code>);
    last = m.index + token.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function Block({ block }) {
  switch (block.type) {
    case 'h2': return <h2>{renderInline(block.text)}</h2>;
    case 'h3': return <h3>{renderInline(block.text)}</h3>;
    case 'p': return <p>{renderInline(block.text)}</p>;
    case 'callout': return <div className="callout">{renderInline(block.text)}</div>;
    case 'ul':
      return (
        <ul>
          {block.items.map((item, i) => <li key={i}>{renderInline(item)}</li>)}
        </ul>
      );
    default: return null;
  }
}

export default function DocPage({ params }) {
  const doc = getDoc(params.slug);
  if (!doc) notFound();

  const { prev, next } = getNeighbors(doc.slug);

  return (
    <div className="container docs-layout">
      <aside className="docs-sidebar">
        {GROUPS.map(group => {
          const docs = DOCS.filter(d => d.group === group);
          if (!docs.length) return null;
          return (
            <div className="group" key={group}>
              <div className="group-title">{group}</div>
              {docs.map(d => (
                <Link href={`/docs/${d.slug}`} key={d.slug} className={d.slug === doc.slug ? 'active' : ''}>
                  {d.emoji} {d.title}
                </Link>
              ))}
            </div>
          );
        })}
      </aside>

      <article className="doc-content">
        <div className="doc-emoji">{doc.emoji}</div>
        <h1>{doc.title}</h1>
        <p className="doc-desc">{doc.desc}</p>
        <p className="doc-updated">Mis à jour le {new Date(doc.updated).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</p>

        <div className="doc-body">
          {doc.body.map((block, i) => <Block block={block} key={i} />)}
        </div>

        <nav className="doc-nav">
          {prev
            ? <Link href={`/docs/${prev.slug}`}>← {prev.emoji} {prev.title}</Link>
            : <span />}
          {next
            ? <Link href={`/docs/${next.slug}`}>{next.emoji} {next.title} →</Link>
            : <span />}
        </nav>
      </article>
    </div>
  );
}
