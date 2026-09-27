import Link from 'next/link';
import { DOCS, GROUPS } from '../../lib/docs';

export const metadata = {
  title: 'Documentation — Bumpify',
  description: 'Guides complets : premiers pas, sécurité, XP, économie, média, IA…',
};

export default function DocsIndex() {
  return (
    <div className="container" style={{ paddingBottom: 80 }}>
      <div className="page-head">
        <h1>Documentation</h1>
        <p>{DOCS.length} guides pour maîtriser Bumpify — du premier bump aux modules avancés.</p>
      </div>

      {GROUPS.map(group => {
        const docs = DOCS.filter(d => d.group === group);
        if (!docs.length) return null;
        return (
          <section key={group} style={{ marginBottom: 40 }}>
            <h2 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-muted)', marginBottom: 14 }}>
              {group}
            </h2>
            <div className="doc-cards">
              {docs.map(doc => (
                <Link className="doc-card" href={`/docs/${doc.slug}`} key={doc.slug}>
                  <div className="emoji">{doc.emoji}</div>
                  <h3>{doc.title}</h3>
                  <p>{doc.desc}</p>
                </Link>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
