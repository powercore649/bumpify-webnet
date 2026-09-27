import { Suspense } from 'react';
import CommandsClient from './page';

export default function CommandsLayout({ children }) {
  return (
    <Suspense fallback={<div className="container" style={{ padding: '80px 0', textAlign: 'center', color: 'var(--text-muted)' }}>Chargement des commandes…</div>}>
      <CommandsClient />
    </Suspense>
  );
}
