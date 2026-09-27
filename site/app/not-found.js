import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="container" style={{ textAlign: 'center', padding: '120px 0' }}>
      <div style={{ fontSize: 64, marginBottom: 16 }}>🌙</div>
      <h1 style={{ fontSize: 34, fontWeight: 800, marginBottom: 10 }}>Page introuvable</h1>
      <p style={{ color: 'var(--text-sub)', marginBottom: 28 }}>
        Cette page n'existe pas — mais votre serveur, lui, peut briller sur le réseau.
      </p>
      <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
        <Link className="btn btn-primary" href="/">Retour à l'accueil</Link>
        <Link className="btn btn-ghost" href="/docs">Documentation</Link>
      </div>
    </div>
  );
}
